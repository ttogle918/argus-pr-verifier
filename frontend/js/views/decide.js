import { html, raw, setHtml, on, $ } from '../dom.js';
import { icon } from '../icons.js';
import { showToast } from '../toast.js';
import { verdictInfo, riskTone, phaseLabels, ATTACKER_LABEL } from '../derive.js';

const SEV_RE = /^(CRITICAL|HIGH|MEDIUM|LOW):\s*/;
const SEV_CHIP = { CRITICAL: 'chip--danger', HIGH: 'chip--danger', MEDIUM: 'chip--warn', LOW: '' };
const GATES = [
  ['G1 AST', 'gate_1_ast_syntax'], ['G2 Semgrep', 'gate_2_semgrep_clean'],
  ['G3 Exploits', 'gate_3_dast_regression_blocked'], ['G4 Mutants', 'gate_4_mutant_kill_preserved'],
];
const GATE_LEGEND = [
  ['GATE 1', 'AST & types', 'The patch parses and type-checks.'],
  ['GATE 2', 'Semgrep', 'Zero new static-analysis warnings.'],
  ['GATE 3', 'Proven exploits blocked', 'Replays the proven breaches; all must fail now.'],
  ['GATE 4', 'Mutant kill rate kept', 'Tests still pass and still catch the planted bugs.'],
];

const pct = (caught, total) => (total ? `${Math.round((caught / total) * 1000) / 10}%` : '0%');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function splitFinding(text) {
  const m = SEV_RE.exec(text);
  return m ? { sev: m[1], text: text.slice(m[0].length) } : { sev: null, text };
}

function emptyView() {
  return html`<div class="page"><div class="empty-state" data-testid="decide-empty">
    ${icon('info', { size: 24 })}
    <h1 class="decide-empty__title">Nothing to decide yet</h1>
    <p>Run a verification first. The merge decision appears here once Argus-PR has scored the PR.</p>
    <button type="button" class="btn btn--primary" data-act="go-start">Go to Start</button>
  </div></div>`;
}

function skeleton() {
  return html`<div class="page decide">
    <section class="decide-head" data-region="head"></section>
    <section class="decide-scores" aria-label="Scores" data-region="scores"></section>
    <section class="decide-findings" data-region="findings"></section>
    <section class="decide-cols">
      <div class="decide-col" data-region="defects"></div>
      <div class="decide-col" data-region="risk"></div>
    </section>
    <section class="patch" data-testid="patch-section" data-region="patch" hidden></section>
    <section class="decide-gate panel" id="decide-gate" aria-labelledby="gate-h" tabindex="-1">
      <div class="decide-gate__head">
        <h2 id="gate-h">Merge decision</h2>
        <span class="decide-muted">Your decision is recorded with this run and the reviewer note.</span>
      </div>
      <div data-region="gate"></div>
      <div class="decide-gate__foot">
        <button type="button" class="btn btn--ghost" data-testid="open-export" data-act="export">${icon('package')}Export PR + pinned regression test</button>
        <button type="button" class="btn btn--ghost" data-testid="download-report" data-act="download">${icon('download')}Download JSON report</button>
      </div>
    </section>
  </div>`;
}

function headHtml(run, final) {
  const v = verdictInfo(run.oneCard.headline_verdict);
  const risk = run.oneCard.residual_risk_level;
  return html`
    <div class="decide-verdict-row">
      <span class="decide-verdict decide-verdict--${v.tone}" data-testid="verdict-chip" data-verdict="${run.oneCard.headline_verdict}">${icon(v.icon, { size: 16 })}${v.label}</span>
      <span class="decide-risk">Residual risk <strong class="mono tone-${riskTone(risk)}">${risk}</strong></span>
      <span class="mono decide-meta">${[final.pr_title, final.repo_name, final.author, final.run_id].filter(Boolean).join(' · ')}</span>
    </div>
    <h1 class="decide-takeaway">${run.oneCard.one_line_takeaway}</h1>`;
}

function scoresHtml(run, final) {
  const s = run.score;
  const evals = s.mutant_evaluations ?? [];
  const survivors = s.surviving_mutants ?? [];
  const defectNote = final.phase_mode === 'phase1_mvp'
    ? 'Failed on the first run.'
    : `Reproduced 2/2 in the sandbox.${s.flaky_filtered_count ? ` ${plural(s.flaky_filtered_count, 'flaky failure')} filtered out.` : ''}`;
  return html`
    <div class="decide-hero panel">
      <div class="decide-hero__num">
        <div class="decide-hero__score mono" data-testid="score-hero" aria-label="${s.planted_bugs_caught} of ${s.planted_bugs_total} planted bugs caught">
          <span class="decide-hero__caught">${s.planted_bugs_caught}</span><span class="decide-hero__total">/${s.planted_bugs_total}</span>
        </div>
        <span class="decide-hero__label">planted bugs caught <span class="mono decide-muted">&middot; ${pct(s.planted_bugs_caught, s.planted_bugs_total)}</span></span>
      </div>
      <div class="decide-hero__side">
        <ul class="decide-segs" aria-label="Mutant results">
          ${evals.map((m) => html`<li class="decide-seg">
            <span class="decide-seg__box decide-seg__box--${m.caught ? 'ok' : 'warn'}">${m.caught ? icon('check', { size: 16, label: 'Caught' }) : icon('eyeClosed', { size: 12, label: 'Survived' })}</span>
            <span class="decide-seg__id mono tone-${m.caught ? 'ok' : 'warn'}">${m.mutant_id}</span>
          </li>`)}
        </ul>
        <p class="decide-muted">Computed in Python from sandbox results (backend/scoring.py). No model estimates this number.</p>
        <a href="#/verify" class="decide-link" data-act="see-matrix">See the matrix</a>
      </div>
    </div>
    <div class="decide-stat panel">
      <span class="decide-stat__label">${icon('breach', { size: 16 })}Confirmed defects</span>
      <span class="decide-stat__num mono tone-danger">${s.confirmed_pr_failures_count}</span>
      <span class="decide-muted">${defectNote}</span>
    </div>
    <div class="decide-stat panel">
      <span class="decide-stat__label">${icon('eyeClosed', { size: 12 })}Surviving mutants</span>
      <span class="decide-stat__num mono ${survivors.length ? 'tone-warn' : ''}">${survivors.length}</span>
      <span class="decide-muted">${survivors.length
        ? survivors.map((m, i) => html`${i ? '; ' : ''}<span class="mono tone-warn">${m.mutant_id}</span> ${m.title}`)
        : 'None. Every planted bug was caught.'}</span>
    </div>`;
}

function findingsHtml(run) {
  const items = run.oneCard.finding_highlights ?? [];
  if (!items.length) return html``;
  return html`<h2 class="decide-h2">Findings</h2>
    <ul class="decide-findings__list">
      ${items.map((f) => {
        const p = splitFinding(f);
        return html`<li class="decide-finding" data-testid="finding">${p.sev ? html`<span class="chip ${SEV_CHIP[p.sev]}">${p.sev}</span>` : ''}<span>${p.text}</span></li>`;
      })}
    </ul>`;
}

function defectsHtml(run, final) {
  const failures = run.score.confirmed_pr_failures ?? [];
  const labels = phaseLabels(final.phase_mode);
  const sevFindings = (run.oneCard.finding_highlights ?? []).map(splitFinding).filter((p) => p.sev);
  const invs = run.invariantPlan?.invariants ?? final.invariant_plan?.invariants ?? [];
  const head = html`<h2 class="decide-h2">Confirmed defects</h2>`;
  if (!failures.length) {
    return html`${head}<div class="panel decide-card" data-testid="defect-none"><p>No reproducible defects.</p></div>`;
  }
  return html`${head}${failures.map((f, idx) => {
    const t = run.tests[f.test_id];
    const sev = sevFindings[idx]?.sev ?? null;
    const inv = invs.find((i) => i.id === f.target_invariant_id);
    const max = f.max_attempts || 5;
    const at = f.breached_on_attempt;
    return html`<article class="panel decide-card" data-testid="defect-card" data-test-id="${f.test_id}">
      <div class="decide-card__top">
        <div class="decide-card__titles">
          ${sev ? html`<span class="chip ${SEV_CHIP[sev]}">${sev}</span>` : ''}
          <h3>${t?.description || f.test_id}</h3>
        </div>
        <span class="chip">${f.target_invariant_id}${inv ? ` · ${inv.title}` : ''}</span>
      </div>
      <code class="mono decide-testid">${f.test_id}</code>
      <div class="decide-card__meta">
        <span class="chip chip--danger">${labels.repro} · breached on attempt ${at}/${max}</span>
        <span class="decide-pips" aria-hidden="true">${Array.from({ length: max }, (_, i) => {
          const n = i + 1;
          return html`<span class="decide-pip ${n < at ? 'decide-pip--past' : n === at ? 'decide-pip--hit' : ''}"></span>`;
        })}</span>
      </div>
      <ol class="decide-attempts">
        ${(f.attempt_history ?? []).map((a) => html`<li>
          <span class="mono decide-attempts__n">${a.attempt_num}</span>
          <span class="chip ${a.status === 'BREACHED' ? 'chip--danger' : ''}">${a.status}</span>
          <span class="${a.status === 'BREACHED' ? '' : 'decide-muted'}">${a.attack_hypothesis}</span>
        </li>`)}
      </ol>
      ${f.error_trace ? html`<pre class="code decide-trace" tabindex="0">${f.error_trace}</pre>` : ''}
    </article>`;
  })}`;
}

function riskHtml(run, patchStatus) {
  const survivors = run.score.surviving_mutants ?? [];
  const running = patchStatus === 'running';
  const box = survivors.length
    ? html`<div class="decide-risk-box" data-testid="residual-risk" data-state="survived">
        ${survivors.map((m) => html`<span class="decide-risk-box__head tone-warn">${icon('eyeClosed', { size: 12 })}${m.mutant_id} survived &middot; ${ATTACKER_LABEL[m.category] ?? m.category} &middot; ${m.severity}</span>`)}
        <p>${run.oneCard.blind_spot_explanation}</p>
      </div>`
    : html`<div class="decide-risk-box decide-risk-box--none" data-testid="residual-risk" data-state="none">
        <span class="decide-risk-box__head">${icon('check', { size: 14 })}No surviving mutants.</span>
      </div>`;
  return html`<h2 class="decide-h2">Residual risk</h2>
    ${box}
    <div class="panel decide-card">
      <div class="decide-fix__head">
        <h3>Recommended fix</h3>
        <span class="mono decide-model"><span class="decide-dot"></span>gemini-4-argon</span>
      </div>
      <pre class="code decide-fix" data-testid="fix-snippet" tabindex="0">${run.oneCard.recommended_fix_snippet}</pre>
      <div class="decide-actions">
        <button type="button" class="btn" data-testid="apply-patch" data-act="apply" ${raw(running ? 'disabled' : '')}>${icon('state', { size: 16 })}Apply fix &amp; re-verify</button>
        <button type="button" class="btn btn--ghost" data-testid="copy-prompt" data-act="copy-prompt">${icon('copy', { size: 16 })}Copy fix prompt</button>
        ${running ? html`<span class="chip chip--ai" role="status">${icon('spinner', { size: 14 })}Re-verifying in the sandbox&hellip;</span>` : ''}
      </div>
    </div>`;
}

function gateStatusText(step) {
  if (step.status === 'VERIFIED') return 'Verified · 4/4 gates';
  const i = GATES.findIndex(([, k]) => !step[k]);
  return i >= 0 ? `Failed at gate ${i + 1}` : 'Failed';
}

function patchHtml(state) {
  const { patch, run } = state;
  const rep = patch.report;
  const s = run.score;
  const oc = run.oneCard;
  if (patch.status === 'running') {
    return html`<h2 class="decide-h2" id="patch-h" data-testid="patch-heading" tabindex="-1">Apply fix &amp; re-verify</h2>
      <div class="status-box status-box--ai" role="status">${icon('spinner', { size: 16 })}<span>Re-verifying in the sandbox. The patch loop runs four gates per attempt and feeds each counterexample into the next one.</span></div>`;
  }
  if (patch.status === 'error') {
    return html`<h2 class="decide-h2">Patch re-verification failed</h2>
      <div class="status-box status-box--danger" role="alert">${icon('alert', { size: 16 })}<span>${patch.error || 'The patch could not be re-verified.'}</span>
        <button type="button" class="btn" data-act="retry-patch">Retry</button></div>`;
  }
  const failed = rep?.final_status === 'FAILED';
  const max = rep?.max_patch_attempts ?? 5;
  const history = rep?.attempt_history ?? [];
  const heading = !rep ? 'Fix re-verified'
    : failed ? `Patch failed after ${rep.attempts_used} attempts`
      : `Patch verified on attempt ${rep.verified_on_attempt} of ${max}`;
  const b = patch.before;
  const patchName = rep?.final_patch_id ?? 'patch';
  const row = (label, before, after) => html`<tr><th scope="row">${label}</th><td class="decide-ba__before">${before}</td><td class="decide-ba__after">${after}</td></tr>`;
  const rec = (v, r) => `${verdictInfo(v).label} · risk ${r}`;
  return html`
    <div class="patch__head">
      <div class="patch__titles">
        <p class="eyebrow">Decide &middot; apply fix &amp; re-verify</p>
        <h2 class="patch__h" id="patch-h" data-testid="patch-heading" tabindex="-1">${heading}</h2>
        ${rep ? html`<p class="mono decide-meta">${rep.patch_session_id} &middot; final patch ${rep.final_patch_id}${run.prTitle ? ` · [PATCHED] ${run.prTitle}` : ''}</p>` : ''}
      </div>
      ${rep ? html`<ol class="patch__slots" aria-label="Patch attempts">
        ${Array.from({ length: max }, (_, i) => {
          const a = history[i];
          const kind = !a ? 'unused' : a.status === 'VERIFIED' ? 'ok' : 'fail';
          return html`<li class="patch__slot"><span class="patch__slot-box patch__slot-box--${kind}">${kind === 'ok' ? icon('check', { size: 14, label: 'Verified' }) : kind === 'fail' ? icon('x', { size: 14, label: 'Failed' }) : ''}</span><span class="mono patch__slot-n">#${i + 1}</span></li>`;
        })}
      </ol>` : ''}
    </div>
    ${rep ? html`<ul class="patch__legend" aria-label="Gates">
      ${GATE_LEGEND.map(([n, t, d]) => html`<li class="panel"><span class="mono decide-faint">${n}</span><strong>${t}</strong><span class="decide-muted">${d}</span></li>`)}
    </ul>
    <div class="patch__attempts">
      ${history.map((a) => html`<article class="panel patch__attempt patch__attempt--${a.status === 'VERIFIED' ? 'ok' : 'fail'}" data-testid="patch-attempt" data-status="${a.status}">
        <div class="patch__attempt-top">
          <h3>Attempt ${a.attempt_num} <span class="mono decide-faint">${a.patch_id}</span></h3>
          <span class="chip ${a.status === 'VERIFIED' ? 'chip--ok' : 'chip--danger'}">${gateStatusText(a)}</span>
        </div>
        <p>${a.candidate_diff_summary}</p>
        <ul class="patch__gates">
          ${GATES.map(([label, key]) => html`<li class="patch__gate ${a[key] ? '' : 'patch__gate--fail'}">${a[key] ? icon('check', { size: 16, label: 'Passed' }) : icon('x', { size: 16, label: 'Failed' })}<span>${label}</span></li>`)}
        </ul>
        ${a.counterexample_feedback ? html`<div class="patch__cx">
          <span class="label-caps tone-danger">Counterexample &middot; fed into attempt ${a.attempt_num + 1}</span>
          <pre class="code decide-trace" tabindex="0">${a.counterexample_feedback}</pre>
        </div>` : ''}
      </article>`)}
    </div>` : ''}
    <h3 class="decide-h2">Before and after</h3>
    <div class="patch__table-wrap"><table class="patch__table">
      <thead><tr><th scope="col">Measure</th><th scope="col">Original PR</th><th scope="col">With ${patchName}</th></tr></thead>
      <tbody>
        ${row('Planted bugs caught', b ? `${b.caught}/${b.total} · ${pct(b.caught, b.total)}` : 'n/a', `${s.planted_bugs_caught}/${s.planted_bugs_total} · ${pct(s.planted_bugs_caught, s.planted_bugs_total)}`)}
        ${row('Confirmed defects', b ? String(b.defects) : 'n/a', String(s.confirmed_pr_failures_count))}
        ${row('Recommendation', b ? rec(b.verdict, b.risk) : 'n/a', rec(oc.headline_verdict, oc.residual_risk_level))}
      </tbody>
    </table></div>
    <div class="decide-actions">
      <button type="button" class="btn btn--primary btn--lg" data-act="export">${icon('package')}Export PR + pinned regression test</button>
      <button type="button" class="btn btn--lg" data-act="back-to-decision">Back to decision</button>
    </div>`;
}

function gateHtml(state) {
  const { run, decision } = state;
  const verdict = run.oneCard.headline_verdict;
  const defects = run.score.confirmed_pr_failures_count;
  if (!decision) {
    return html`<div class="decide-gate__form">
        <div class="field decide-gate__note">
          <label class="field__label" for="reviewer-note">Reviewer note <span class="decide-faint">(optional)</span></label>
          <input id="reviewer-note" class="input decide-input" type="text" data-testid="reviewer-note" placeholder="e.g. Patch negative refunds and the PENDING race, then add a clock-skew test for M8" autocomplete="off">
        </div>
        <div class="decide-gate__btns">
          <button type="button" class="btn btn--lg" data-testid="approve-button" data-act="approve">${icon('check', { size: 18, cls: 'tone-ok' })}Approve &amp; merge</button>
          <button type="button" class="btn btn--danger btn--lg" data-testid="reject-button" data-act="reject">${icon('x', { size: 18 })}Reject merge &amp; request fixes</button>
        </div>
      </div>
      ${verdict !== 'APPROVE_RECOMMENDED'
        ? html`<p class="decide-hint">Approving goes against the recommendation: ${plural(defects, 'confirmed defect')} still open.</p>` : ''}`;
  }
  const d = decision.decision;
  const base = html`data-testid="decision-stamp" data-decision="${d}" data-status="${decision.status}"`;
  if (decision.status === 'saving') {
    return html`<div class="decide-stamp" role="status" ${base}>${icon('spinner', { size: 16 })}<span>Recording&hellip;</span></div>`;
  }
  if (decision.status === 'error') {
    return html`<div class="decide-stamp decide-stamp--error" role="alert" ${base}>
      ${icon('alert', { size: 16 })}<span>Couldn't record the decision: ${decision.error || 'unknown error'}</span>
      <button type="button" class="btn" data-act="retry-decision">Retry</button>
      <button type="button" class="btn btn--ghost" data-testid="change-decision" data-act="change">Change decision</button>
    </div>`;
  }
  const reject = d === 'REJECT_MERGE';
  const against = !reject && verdict !== 'APPROVE_RECOMMENDED';
  return html`<div class="decide-stamp decide-stamp--${reject ? 'reject' : 'approve'}" role="status" ${base}>
    <span class="decide-stamp__text"><span aria-hidden="true">${reject ? '✕' : '✓'}</span> ${reject ? 'Merge rejected · fixes requested' : `Merge approved${against ? ' against the recommendation' : ''}`}</span>
    <span class="mono decide-muted">recorded for ${run.final.run_id}</span>
    <button type="button" class="btn decide-stamp__undo" data-testid="change-decision" data-act="change">Change decision</button>
  </div>`;
}

export function mount(root, ctx) {
  const { store, actions } = ctx;
  let mode = null;
  let regionEls = {};
  const seen = {};
  let pendingFocus = null;

  const region = (key, deps, render) => {
    const prev = seen[key];
    if (prev && prev.length === deps.length && prev.every((v, i) => Object.is(v, deps[i]))) return;
    seen[key] = deps;
    const el = regionEls[key];
    setHtml(el, render());
  };

  function update(state) {
    const run = state.run;
    const ready = !!(run.final && run.score && run.oneCard);
    const want = ready ? 'full' : 'empty';
    if (want !== mode) {
      mode = want;
      for (const k of Object.keys(seen)) delete seen[k];
      setHtml(root, ready ? skeleton() : emptyView());
      regionEls = {};
      root.querySelectorAll('[data-region]').forEach((el) => { regionEls[el.dataset.region] = el; });
    }
    if (!ready) return;
    const { final } = run;
    region('head', [run.oneCard, final], () => headHtml(run, final));
    region('scores', [run.score, final], () => scoresHtml(run, final));
    region('findings', [run.oneCard], () => findingsHtml(run));
    region('defects', [run.score, run.tests, run.invariantPlan, final], () => defectsHtml(run, final));
    region('risk', [run.score, run.oneCard, state.patch.status], () => riskHtml(run, state.patch.status));
    const patchEl = regionEls.patch;
    patchEl.hidden = state.patch.status === 'idle';
    if (state.patch.status !== 'idle') region('patch', [state.patch, run.score, run.oneCard, run.prTitle], () => patchHtml(state));
    else delete seen.patch;
    region('gate', [state.decision, final, run.oneCard], () => gateHtml(state));
    applyPendingFocus(state);
  }

  function applyPendingFocus(state) {
    if (!pendingFocus) return;
    const d = state.decision;
    let el = null;
    if (pendingFocus === 'decided') {
      if (!d || d.status === 'saving') return;
      el = $('[data-testid="change-decision"]', root) || $('[data-testid="decision-stamp"]', root);
    } else if (pendingFocus === 'note') {
      if (d) return;
      el = $('#reviewer-note', root);
    } else if (pendingFocus === 'patch') {
      if (state.patch.status === 'idle') return;
      el = $('#patch-h', root);
      if (state.patch.status === 'running') { el?.focus?.(); pendingFocus = 'patch-done'; return; }
    } else if (pendingFocus === 'patch-done') {
      if (state.patch.status === 'running') return;
      pendingFocus = null;
      const a = typeof document !== 'undefined' ? document.activeElement : null;
      if (a && a !== document.body && !regionEls.patch?.contains(a)) return;
      $('#patch-h', root)?.focus?.();
      return;
    }
    pendingFocus = null;
    el?.focus?.();
  }

  on(root, 'click', '[data-act]', (e, el) => {
    const act = el.dataset.act;
    const state = store.getState();
    switch (act) {
      case 'go-start': actions.navigate('start'); break;
      case 'see-matrix': e.preventDefault(); actions.navigate('verify'); break;
      case 'apply':
      case 'retry-patch': pendingFocus = 'patch'; actions.applyPatch(); break;
      case 'copy-prompt':
        actions.copyFixPrompt().then((ok) => showToast(ok ? 'Fix prompt copied' : "Couldn't copy", ok ? 'ok' : 'danger'));
        break;
      case 'approve':
      case 'reject': {
        const note = $('[data-testid="reviewer-note"]', root)?.value ?? '';
        pendingFocus = 'decided';
        actions.decide(act === 'approve' ? 'APPROVE_MERGE' : 'REJECT_MERGE', note);
        break;
      }
      case 'retry-decision':
        if (state.decision) { pendingFocus = 'decided'; actions.decide(state.decision.decision, state.decision.note); }
        break;
      case 'change': pendingFocus = 'note'; actions.clearDecision(); break;
      case 'export': actions.exportBundle(); break;
      case 'download': actions.downloadReport(); break;
      case 'back-to-decision': {
        const gate = $('#decide-gate', root);
        gate?.scrollIntoView({ block: 'start' });
        gate?.focus({ preventScroll: true });
        break;
      }
      default: break;
    }
  });

  store.subscribe(update);
  update(store.getState());
}
