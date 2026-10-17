import { html, esc, on } from '../dom.js';
import { icon } from '../icons.js';
import { STAGES } from '../state.js';
import {
  sceneModel, runCounts, phaseLabels, ATTACKER_LABEL, ATTACKER_ICON, STAGE_LABEL, formatElapsed,
} from '../derive.js';
import { createScene2D } from '../scene/scene2d.js';

const FILTERS = [['all', 'All'], ['a', 'Track A'], ['b', 'Track B'], ['fail', 'Failures only']];
const LOG_CMD = 'antigravity-preview-09-2026 · python /workspace/harness/run_dual_track_verification.py';
const STATUS_RE = /\b(FAILED|FAIL|KILLED|CAUGHT|SURVIVED|FLAKY|CONFIRMED|BLOCKED|PASSED)\b/g;

// Write markup only when it changed, so focus and transitions survive store updates.
function patch(el, content) {
  const s = String(content);
  if (el._h !== s) { el.innerHTML = s; el._h = s; }
}
function attr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function logTextHtml(text, tone) {
  if (!tone) return esc(text);
  let out = '';
  let last = 0;
  for (const m of text.matchAll(STATUS_RE)) {
    out += esc(text.slice(last, m.index));
    out += `<span class="log-status log-status--${tone}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

const logVisible = (entry, filter) => {
  if (filter === 'a') return entry.track === 'A';
  if (filter === 'b') return entry.track === 'B';
  if (filter === 'fail') return entry.tone === 'danger' || entry.tone === 'warn';
  return true;
};

function logLineEl(entry) {
  const li = document.createElement('li');
  li.className = `log__line${entry.tone === 'ai' ? ' log__line--ai' : ''}`;
  li.dataset.testid = 'log-line';
  li.dataset.track = entry.track;
  li.innerHTML = `<span class="log__ts">${esc(entry.ts)}</span><span class="log__track">${esc(entry.track)}</span><span class="log__text">${logTextHtml(entry.text, entry.tone)}</span>`;
  return li;
}

function stageIcon(state) {
  if (state === 'done') return icon('held', { size: 16, cls: 'stage__icon stage__icon--done' });
  if (state === 'active') return icon('spinner', { size: 16, cls: 'stage__icon stage__icon--active' });
  if (state === 'blocked' || state === 'error') return icon('breach', { size: 16, cls: 'stage__icon stage__icon--bad' });
  return icon('pending', { size: 16, cls: 'stage__icon stage__icon--pending' });
}

function statusPill(run) {
  if (run.status === 'running') {
    const active = STAGES.find((k) => run.stages[k] === 'active');
    const label = active ? `${STAGE_LABEL[active]} ${run.stageMeta[active] ?? ''}`.trim() : 'Starting';
    return html`<span class="chip chip--ai run-pill">${icon('spinner', { size: 16 })}Running · ${label}</span>`;
  }
  if (run.status === 'complete') return html`<span class="chip run-pill">${icon('check', { size: 16 })}Complete</span>`;
  if (run.status === 'blocked') return html`<span class="chip chip--danger run-pill">${icon('ban', { size: 16 })}Blocked at Stage 0</span>`;
  if (run.status === 'error') return html`<span class="chip chip--danger run-pill">${icon('breach', { size: 16 })}Stopped</span>`;
  return html`<span class="chip run-pill">Idle</span>`;
}

function mutantCell(m, i) {
  const id = m?.id ?? `M${i + 1}`;
  const status = m?.status ?? 'sealed';
  const text = { caught: 'caught', testing: 'testing now', survived: 'survived', sealed: 'sealed, not tested yet' }[status];
  const glyph = status === 'caught' ? icon('check', { size: 16 })
    : status === 'testing' ? icon('spinner', { size: 16 })
      : icon('eyeClosed', { size: 11 });
  return html`<li class="mcell mcell--${status}"><div class="mcell__box" title="${id}: ${text}">${glyph}</div><span class="mcell__id">${id}</span><span class="visually-hidden">${id}: ${text}</span></li>`;
}

function laneStatus(run, tests, planned) {
  const resolved = tests.filter((t) => t.outcome !== 'pending').length;
  const kills = new Set(tests.flatMap((t) => t.kills)).size;
  const pending = tests.some((t) => t.outcome === 'pending') && run.stages.sandbox_a === 'active';
  if (!tests.length) return { text: planned ? 'Writing tests' : 'Waiting', tone: '' };
  const text = `${resolved}/${tests.length}${kills ? ` · ${kills} kill${kills > 1 ? 's' : ''}` : ''}`;
  return { text, tone: pending ? 'chip--ai' : '' };
}

function testRowHtml(run, t, labels) {
  const iconName = { breach: 'breach', flaky: 'warn', held: 'held', pending: 'pending' }[t.outcome];
  let result;
  let pips = '';
  const extras = [];
  if (t.outcome === 'breach') {
    const attempt = t.breachedOnAttempt ? ` · attempt ${t.breachedOnAttempt}/${t.maxAttempts}` : '';
    result = html`<span class="chip chip--danger">Breached · ${labels.repro}${attempt}</span>`;
    if (t.breachedOnAttempt) {
      const max = t.maxAttempts || 5;
      const cells = Array.from({ length: max }, (_, k) => {
        const n = k + 1;
        return html`<span class="pip ${n < t.breachedOnAttempt ? 'pip--used' : n === t.breachedOnAttempt ? 'pip--hit' : 'pip--empty'}"></span>`;
      });
      pips = html`<span class="pips" role="img" aria-label="Breached on attempt ${t.breachedOnAttempt} of ${max}">${cells}</span>`;
    }
  } else if (t.outcome === 'flaky') {
    result = html`<span class="chip chip--warn">Flaky · failed 1/2 · filtered out</span>`;
  } else if (t.outcome === 'held') {
    result = html`<span class="chip">${labels.held}</span>`;
    for (const k of t.kills) extras.push(html`<span class="chip chip--ok">✓ Caught ${k}</span>`);
    if (!t.kills.length && run.stages.sandbox_b === 'active') extras.push(html`<span class="chip chip--quiet">Waiting</span>`);
  } else {
    result = html`<span class="chip">Queued</span>`;
  }
  return html`
    <div class="ltest__head">${icon(iconName, { size: 16, cls: `ltest__icon ltest__icon--${t.outcome}` })}<code class="ltest__id">${t.id}</code><span class="ltest__inv">${t.invariantId}</span></div>
    <div class="ltest__result">${result}${pips}${extras}</div>`;
}

export function mount(root, ctx) {
  const { store, actions } = ctx;

  root.innerHTML = `
  <div class="page run">
    <div class="empty-state" data-role="empty" hidden>
      <h1 class="run__empty-title">No run yet.</h1>
      <p>Pick a pull request and start a run to watch the attacker swarm work.</p>
      <a class="btn btn--primary" href="#/start">Go to Start</a>
    </div>
    <div class="run__main" data-role="main" hidden>
      <section class="run__title">
        <div class="run__title-text">
          <h1 class="run__h1" data-role="title"></h1>
          <p class="run__meta mono" data-role="meta"></p>
        </div>
        <div class="run__controls">
          <div role="status" data-testid="run-status" data-role="status"></div>
          <span class="run__elapsed mono" data-role="elapsed"></span>
          <button type="button" class="btn" data-testid="stop-button" data-act="stop">Stop run</button>
          <button type="button" class="btn" data-testid="open-run-details" data-act="details">${icon('details', { size: 16 }).s}Run details</button>
        </div>
      </section>
      <div class="status-box status-box--warn run__fallback" data-testid="live-fallback-banner" data-role="fallback" hidden>
        <span class="chip chip--warn">${icon('replay', { size: 14 }).s}LIVE → REPLAY</span>
        <div>
          <h2 class="run__fallback-h">Live API isn't configured on this server, so this run uses recorded replay.</h2>
          <p>Set <code class="mono">GEMINI_API_KEY</code> on the server to call Gemini and the sandbox for real. Results below are recorded traces.</p>
        </div>
      </div>
      <ol class="stages" aria-label="Pipeline stages" data-role="stages"></ol>

      <section class="blocked panel" data-testid="blocked-panel" data-role="blocked" aria-labelledby="blocked-h" hidden>
        <div class="blocked__scene" data-role="blocked-scene"></div>
        <div class="blocked__body">
          <div class="blocked__chips">
            <span class="chip chip--danger run-pill">${icon('ban', { size: 16 }).s}Blocked at Stage 0</span>
            <span class="mono blocked__model" data-role="blocked-model"></span>
          </div>
          <h2 id="blocked-h" class="blocked__h">This PR tries to manipulate the verifier. No attacker or sandbox ran.</h2>
          <p class="mono run__meta" data-role="blocked-meta"></p>
          <ul class="blocked__threats" aria-label="Detected threats" data-role="threats"></ul>
          <div class="blocked__actions">
            <button type="button" class="btn btn--danger btn--lg" data-act="reject">Reject merge</button>
            <button type="button" class="btn btn--lg" data-act="details">View flagged lines in diff</button>
            <a class="btn btn--ghost btn--lg" href="#/start">Back to Start</a>
          </div>
          <p class="blocked__decision" role="status" data-role="decision"></p>
        </div>
      </section>

      <div class="error-panel" data-testid="error-panel" role="alert" data-role="error" hidden>
        ${icon('alert', { size: 20 }).s}
        <div class="error-panel__text">
          <h2 class="error-panel__h" data-role="error-h"></h2>
          <p data-role="error-msg"></p>
        </div>
        <button type="button" class="btn btn--primary" data-testid="retry-button" data-act="retry">${icon('state', { size: 16 }).s}Retry run</button>
        <button type="button" class="btn" data-act="open-log">Open log</button>
      </div>

      <div data-role="live">
        <section class="band">
          <div class="band__scene panel" data-role="scene-wrap">
            <div data-role="scene"></div>
            <p class="band__focus mono" data-role="focus"></p>
          </div>
          <div class="counter panel">
            <div>
              <span class="label-caps" data-role="counter-label"></span>
              <div class="counter__num mono" data-testid="caught-counter" data-role="counter"></div>
            </div>
            <ul class="mgrid" aria-label="Mutant status" data-role="mgrid"></ul>
            <p class="counter__note">Caught = passes on the PR and fails on the mutant.</p>
            <dl class="counter__stats" data-role="stats"></dl>
            <p class="counter__lock">${icon('lock', { size: 16 }).s}Mutants were planted in a separate Argon session (store=False). No attacker saw them.</p>
            <button type="button" class="btn btn--primary btn--lg" data-testid="continue-verify" data-act="verify" data-role="continue-a" hidden>See verification matrix ${icon('arrowRight', { size: 16 }).s}</button>
          </div>
        </section>

        <section class="lanes" aria-labelledby="lanes-h">
          <div class="lanes__head">
            <h2 id="lanes-h" class="lanes__h">Attacker lanes</h2>
            <ul class="legend">
              <li>${icon('breach', { size: 14, cls: 'legend__bad' }).s}Breached the PR</li>
              <li>${icon('warn', { size: 14, cls: 'legend__warn' }).s}Flaky, filtered</li>
              <li>${icon('held', { size: 14 }).s}Held on PR (valid test)</li>
              <li>${icon('check', { size: 14, cls: 'legend__ok' }).s}Caught a mutant</li>
            </ul>
          </div>
          <div class="lanes__grid" data-role="lanes"></div>
          <button type="button" class="btn btn--primary btn--lg lanes__continue" data-act="verify" data-role="continue-b" hidden>See verification matrix ${icon('arrowRight', { size: 16 }).s}</button>
        </section>
      </div>

      <section class="log panel panel--sunken" aria-labelledby="log-h" tabindex="-1" data-role="log-section">
        <div class="log__head">
          <div class="log__title">
            <h2 id="log-h" class="log__h">Sandbox log</h2>
            <span class="mono log__cmd">${LOG_CMD}</span>
          </div>
          <div role="group" aria-label="Filter log" class="log__filters" data-role="filters"></div>
        </div>
        <ol class="log__body" role="log" aria-live="polite" tabindex="0" aria-label="Sandbox log lines" data-role="log"></ol>
      </section>
    </div>
  </div>`;

  const q = (r) => root.querySelector(`[data-role="${r}"]`);
  const el = {
    empty: q('empty'), main: q('main'), title: q('title'), meta: q('meta'), status: q('status'), elapsed: q('elapsed'),
    fallback: q('fallback'), stages: q('stages'), blocked: q('blocked'), blockedScene: q('blocked-scene'),
    blockedModel: q('blocked-model'), blockedMeta: q('blocked-meta'), threats: q('threats'), decision: q('decision'),
    error: q('error'), errorH: q('error-h'), errorMsg: q('error-msg'), live: q('live'), scene: q('scene'),
    focus: q('focus'), counterLabel: q('counter-label'), counter: q('counter'), mgrid: q('mgrid'), stats: q('stats'),
    continueA: q('continue-a'), continueB: q('continue-b'), lanes: q('lanes'), filters: q('filters'), log: q('log'),
    logSection: q('log-section'),
  };
  const stopBtn = root.querySelector('[data-testid="stop-button"]');
  const rejectBtn = root.querySelector('[data-act="reject"]');

  const scene = createScene2D(el.scene);
  const blockedScene = createScene2D(el.blockedScene);

  // Stage strip skeleton: built once.
  el.stages.innerHTML = STAGES.map((s) => `<li class="stage" data-testid="stage" data-stage="${s}" data-state="pending"></li>`).join('');
  const stageEls = Array.from(el.stages.children);
  // Filter buttons: built once, only aria-pressed changes.
  el.filters.innerHTML = FILTERS.map(([v, label]) => `<button type="button" class="log__filter" data-testid="log-filter" data-filter="${v}" aria-pressed="false">${label}</button>`).join('');

  on(root, 'click', '[data-act]', (e, t) => {
    switch (t.dataset.act) {
      case 'stop': actions.stop(); break;
      case 'retry': actions.retry(); break;
      case 'details': actions.openOverlay('run-details'); break;
      case 'verify': actions.navigate('verify'); break;
      case 'reject': actions.decide('REJECT_MERGE', ''); break;
      case 'open-log':
        el.logSection.scrollIntoView({ block: 'start' });
        el.log.focus({ preventScroll: true });
        break;
      default:
    }
  });
  on(root, 'click', '[data-filter]', (e, t) => actions.setLogFilter(t.dataset.filter));

  // Elapsed timer: one interval, only while the run is running.
  let timer = null;
  let frozenEnd = null;
  let lastRun = null;
  const tick = () => {
    const run = store.getState().run;
    el.elapsed.textContent = formatElapsed(run.startedAt, run.finishedAt ?? frozenEnd ?? Date.now());
  };

  // Lanes: keyed by attacker id; rows keyed by test id.
  const laneEls = new Map();
  function ensureLane(id) {
    let lane = laneEls.get(id);
    if (lane) return lane;
    const article = document.createElement('article');
    article.className = 'lane';
    article.dataset.testid = 'lane';
    article.dataset.attackerId = id;
    article.innerHTML = `
      <header class="lane__head">
        <div class="lane__top"><h3 class="lane__name"></h3><span class="chip lane__status"></span></div>
        <div class="lane__invs"></div>
        <p class="lane__strategy"></p>
        <div class="lane__bar" aria-hidden="true"><div class="lane__fill"></div></div>
      </header>
      <ul class="lane__tests"></ul>`;
    lane = {
      article, name: article.querySelector('.lane__name'), status: article.querySelector('.lane__status'),
      invs: article.querySelector('.lane__invs'), strategy: article.querySelector('.lane__strategy'),
      fill: article.querySelector('.lane__fill'), list: article.querySelector('.lane__tests'), rows: new Map(),
    };
    laneEls.set(id, lane);
    return lane;
  }

  function updateLanes(run) {
    const labels = phaseLabels(run.phase);
    const plans = run.invariantPlan?.attack_plans ?? [];
    const wanted = run.attackers;
    attr(el.lanes, 'data-count', String(wanted.length));
    for (const [id, lane] of laneEls) {
      if (!wanted.includes(id)) { lane.article.remove(); laneEls.delete(id); }
    }
    wanted.forEach((id, idx) => {
      const lane = ensureLane(id);
      if (el.lanes.children[idx] !== lane.article) el.lanes.insertBefore(lane.article, el.lanes.children[idx] ?? null);
      const plan = plans.find((p) => p.attacker_id === id);
      const tests = run.testOrder.map((tid) => run.tests[tid]).filter((t) => t.attackerId === id);
      patch(lane.name, html`${icon(ATTACKER_ICON[id] ?? 'info', { size: 16 })}${ATTACKER_LABEL[id] ?? id}`);
      const st = laneStatus(run, tests, !!plan);
      lane.status.className = `chip lane__status ${st.tone}`.trim();
      if (lane.status.textContent !== st.text) lane.status.textContent = st.text;
      patch(lane.invs, html`${(plan?.focus_invariants ?? []).map((inv) => html`<span class="chip chip--plain">${inv}</span>`)}<span class="mono lane__model">gemini-3.8-flash</span>`);
      const strategy = plan?.strategy ?? '';
      if (lane.strategy.textContent !== strategy) lane.strategy.textContent = strategy;
      const resolved = tests.filter((t) => t.outcome !== 'pending').length;
      const pct = tests.length ? Math.round((resolved / tests.length) * 100) : 0;
      lane.fill.style.width = `${pct}%`;
      lane.fill.classList.toggle('lane__fill--active', st.tone === 'chip--ai');

      const seen = new Set();
      tests.forEach((t, ti) => {
        seen.add(t.id);
        let row = lane.rows.get(t.id);
        if (!row) {
          row = document.createElement('li');
          row.className = 'ltest';
          row.dataset.testid = 'lane-test';
          row.dataset.testId = t.id;
          lane.rows.set(t.id, row);
        }
        if (lane.list.children[ti] !== row) lane.list.insertBefore(row, lane.list.children[ti] ?? null);
        attr(row, 'data-outcome', t.outcome);
        patch(row, testRowHtml(run, t, labels));
      });
      for (const [tid, row] of lane.rows) {
        if (!seen.has(tid)) { row.remove(); lane.rows.delete(tid); }
      }
    });
  }

  // Log: append only new lines; rebuild when the filter or the run changes.
  let logCount = 0;
  let logFilter = null;
  let logRef = null;
  function updateLog(run, filter) {
    const rebuild = filter !== logFilter || run.logs.length < logCount || (logRef && run.logs[0] !== logRef);
    const body = el.log;
    const atBottom = rebuild || body.scrollHeight - body.scrollTop - body.clientHeight <= 40;
    if (rebuild) { body.textContent = ''; logCount = 0; }
    if (run.logs.length === logCount && !rebuild) return;
    const frag = document.createDocumentFragment();
    for (let i = logCount; i < run.logs.length; i++) {
      if (logVisible(run.logs[i], filter)) frag.appendChild(logLineEl(run.logs[i]));
    }
    body.appendChild(frag);
    logCount = run.logs.length;
    logFilter = filter;
    logRef = run.logs[0] ?? null;
    if (atBottom) body.scrollTop = body.scrollHeight;
  }

  function update(state) {
    const { run } = state;
    const idle = run.status === 'idle';
    el.empty.hidden = !idle;
    el.main.hidden = idle;
    if (idle) {
      if (timer) { clearInterval(timer); timer = null; }
      return;
    }

    const labels = phaseLabels(run.phase);
    if (run !== lastRun && run.startedAt !== lastRun?.startedAt) frozenEnd = null;
    lastRun = run;
    if (run.status === 'running') {
      frozenEnd = null;
      if (!timer) timer = setInterval(tick, 1000);
    } else {
      if (timer) { clearInterval(timer); timer = null; }
      if (!run.finishedAt && frozenEnd === null) frozenEnd = Date.now();
    }
    tick();

    // Title row
    if (el.title.textContent !== run.prTitle) el.title.textContent = run.prTitle;
    const meta = [run.repoName, run.author, run.runId, labels.name].filter(Boolean).join(' · ');
    if (el.meta.textContent !== meta) el.meta.textContent = meta;
    patch(el.status, statusPill(run));
    stopBtn.hidden = run.status !== 'running';
    el.fallback.hidden = !(run.requestedMode === 'live_api' && run.effectiveMode === 'replay');

    // Stage strip
    STAGES.forEach((s, i) => {
      const li = stageEls[i];
      const st = run.stages[s];
      attr(li, 'data-state', st);
      patch(li, html`<div class="stage__row">${stageIcon(st)}<span class="stage__name">${STAGE_LABEL[s]}</span></div><span class="stage__meta mono">${run.stageMeta[s] ?? ''}</span>`);
    });

    const model = sceneModel(run);
    const blocked = run.status === 'blocked';
    el.blocked.hidden = !blocked;
    el.live.hidden = blocked;
    el.log.parentElement.hidden = blocked;
    el.error.hidden = run.status !== 'error';

    if (blocked) {
      blockedScene.update(model);
      const g = run.guardrail;
      const latency = g?.latency_ms ?? run.final?.guardrail?.latency_ms;
      const modelText = `gemini-3.5-flash-lite${latency != null ? ` · ${latency} ms` : ''}`;
      if (el.blockedModel.textContent !== modelText) el.blockedModel.textContent = modelText;
      const bm = [run.prTitle, run.repoName, run.author].filter(Boolean).join(' · ');
      if (el.blockedMeta.textContent !== bm) el.blockedMeta.textContent = bm;
      const threats = g?.detected_threats ?? run.final?.guardrail?.detected_threats ?? [];
      patch(el.threats, html`${threats.map((t) => html`<li class="threat" data-testid="blocked-threat">${icon('breach', { size: 16, cls: 'threat__icon' })}<code class="threat__text">${t}</code></li>`)}`);
      const d = state.decision;
      const mine = d?.decision === 'REJECT_MERGE' ? d : null;
      rejectBtn.disabled = !!mine && mine.status !== 'error';
      const line = !mine ? ''
        : mine.status === 'saving' ? 'Saving decision…'
          : mine.status === 'saved' ? 'Merge rejected · recorded'
            : `Could not record the decision: ${mine.error ?? 'unknown error'}`;
      patch(el.decision, mine ? html`${icon(mine.status === 'error' ? 'alert' : mine.status === 'saved' ? 'check' : 'spinner', { size: 16 })}${line}` : '');
      el.decision.classList.toggle('blocked__decision--error', mine?.status === 'error');
      return;
    }

    scene.update(model);

    if (run.status === 'error') {
      const where = run.error?.stage ? STAGE_LABEL[run.error.stage] : 'the run';
      const h = `Run stopped during ${where}`;
      if (el.errorH.textContent !== h) el.errorH.textContent = h;
      const msg = run.error?.message ?? '';
      if (el.errorMsg.textContent !== msg) el.errorMsg.textContent = msg;
    }

    // Focus line under the scene: the latest beam's attacker and target.
    const beam = run.lastBeam;
    const focus = beam?.attackerId ? `${(ATTACKER_LABEL[beam.attackerId] ?? beam.attackerId).toUpperCase()}${beam.mutantId ? ` → ${beam.mutantId}` : ''}` : '';
    if (el.focus.textContent !== focus) el.focus.textContent = focus;

    // Counter panel
    const c = runCounts(run);
    const total = c.mutantsTotal || 8;
    const done = run.status === 'complete';
    const counterLabel = done ? 'Planted bugs caught' : 'Planted bugs caught so far';
    if (el.counterLabel.textContent !== counterLabel) el.counterLabel.textContent = counterLabel;
    patch(el.counter, html`<span class="counter__caught">${c.caught}</span><span class="counter__total">/${total}</span>`);
    const cells = Array.from({ length: total }, (_, i) => mutantCell(run.mutants[i], i));
    patch(el.mgrid, html`${cells}`);
    patch(el.stats, html`
      <div class="stat"><dt>${icon('breach', { size: 16, cls: 'stat__bad' })}Confirmed defects (${labels.repro})</dt><dd class="stat__bad">${c.breach}</dd></div>
      ${run.phase === 'phase1_mvp' ? '' : html`<div class="stat"><dt>${icon('warn', { size: 16, cls: 'stat__warn' })}Flaky, filtered out (1/2)</dt><dd class="stat__warn">${c.flaky}</dd></div>`}
      <div class="stat"><dt>${icon('held', { size: 16 })}Valid baseline tests</dt><dd>${c.held}<span class="stat__of"> / ${c.total}</span></dd></div>`);
    el.continueA.hidden = !done;
    el.continueB.hidden = !done;

    updateLanes(run);
    updateLog(run, state.ui.logFilter);
    for (const b of el.filters.children) attr(b, 'aria-pressed', String(b.dataset.filter === state.ui.logFilter));
  }

  store.subscribe(update);
  update(store.getState());
}
