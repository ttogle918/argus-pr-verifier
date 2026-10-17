import { html, raw, esc, on } from '../dom.js';
import { icon } from '../icons.js';
import { createOverlay } from '../overlay-shell.js';
import { t } from '../i18n.js';

const ROLE = {
  OWNER_VICTIM: { label: 'A · Owner', attacker: false },
  CROSS_TENANT_ATTACKER: { label: 'B · Cross-tenant attacker', attacker: true },
  ANONYMOUS: { label: 'Anonymous', attacker: false },
};
const CATEGORY = { security: 'security', edge_cases: 'edge case', state: 'state', regression: 'regression' };
const SCOPE_MODE = { SINGLE_FILE_UNIT: 'SINGLE_FILE_UNIT', SPARSE_PACKAGE_TREE: 'SPARSE_PACKAGE_TREE', LIVE_SERVER_DAEMON: 'LIVE_SERVER_DAEMON' };

function patch(el, content) {
  const s = String(content);
  if (el._h !== s) { el.innerHTML = s; el._h = s; }
}

const unavailable = (what) => html`<p class="rd__empty">${t('{what} will appear here once the run reaches this stage.', { what: t(what) })}</p>`;

function diffHtml(diff) {
  if (!diff) return unavailable('The diff');
  const lines = String(diff).replace(/\n$/, '').split('\n').map((line) => {
    const cls = line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---') ? 'code__line--meta'
      : line.startsWith('+') ? 'code__line--add'
        : line.startsWith('-') ? 'code__line--del' : '';
    return `<span class="code__line ${cls}">${esc(line)}\n</span>`;
  }).join('');
  return html`<pre class="code rd__diff" tabindex="0" aria-label="${t('Pull request diff')}">${raw(lines)}</pre>`;
}

function guardrailHtml(g) {
  if (!g) return unavailable('The guardrail result');
  const blocked = !g.is_safe || g.risk_level === 'BLOCKED';
  const tone = blocked ? 'chip--danger' : g.risk_level === 'SUSPICIOUS' ? 'chip--warn' : '';
  const glyph = blocked ? 'ban' : g.risk_level === 'SUSPICIOUS' ? 'warn' : 'check';
  return html`
    <div class="rd__card">
      <span class="chip rd__risk ${tone}">${icon(glyph, { size: 14 })}${g.risk_level}</span>
      <span class="rd__card-text">${g.sanitized_summary}</span>
      <span class="mono rd__faint">gemini-3.5-flash-lite · ${g.latency_ms} ms</span>
    </div>
    ${g.detected_threats?.length ? html`<ul class="rd__threats" aria-label="${t('Detected threats')}">${g.detected_threats.map((t) => html`<li>${icon('breach', { size: 16, cls: 'rd__threat-icon' })}<code>${t}</code></li>`)}</ul>` : ''}`;
}

function scopeHtml(s) {
  if (!s) return unavailable('The scope decision');
  const n = s.mounted_files?.length ?? 0;
  const cells = [
    [t('Mode'), html`<span class="mono">${SCOPE_MODE[s.scope_mode] ?? s.scope_mode}</span>`],
    [t('Chosen by'), s.selection_source === 'user_override' ? t('You (override)') : t('Agent (auto)')],
    [t('Target'), html`<span class="mono rd__break">${s.primary_target_file}</span>`],
    [t('Mounted'), html`<span class="mono">${t(n === 1 ? '{n} file' : '{n} files', { n })} · ${s.estimated_mount_size_kb} KB</span>`],
  ];
  const skipped = s.skipped_heavy_paths ?? [];
  return html`
    <dl class="rd__grid">${cells.map(([k, v]) => html`<div class="rd__cell"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
    <p class="rd__muted">${s.rationale}</p>
    ${skipped.length ? html`<div class="rd__skipped"><span class="rd__muted">${t('Skipped')}</span>${skipped.map((p) => html`<span class="chip rd__struck">${p}</span>`)}</div>` : ''}`;
}

function personaHtml(p) {
  const role = ROLE[p.role] ?? { label: p.role, attacker: false };
  const hasAuth = Object.keys(p.headers_injected ?? {}).some((k) => k.toLowerCase() === 'authorization');
  return html`<li class="persona${role.attacker ? ' persona--attacker' : ''}">
    <span class="persona__role">${role.attacker ? icon('security', { size: 14 }) : ''}${t(role.label)}</span>
    <span class="mono persona__meta">${p.tenant_id} · ${hasAuth ? t('Bearer token') : t('no headers')}</span>
  </li>`;
}

function rowHtml(r) {
  const bypass = r.verdict === 'PROVEN_BOLA_BYPASS';
  const attacker = r.bola_vulnerable_2x
    ? html`<span class="chip chip--danger rd__allowed">${r.cross_tenant_attacker_status} <span>${t('allowed')}</span></span>`
    : html`${r.cross_tenant_attacker_status}`;
  const verdict = bypass
    ? html`<span class="rd__verdict rd__verdict--bad">${icon('breach', { size: 14 })}${t('BOLA bypass · 2/2')}</span>`
    : html`<span class="rd__verdict">${icon('check', { size: 14 })}${t('Isolated')}</span>`;
  return html`<tr class="${bypass ? 'rd__row--bad' : ''}" data-testid="dast-row" data-verdict="${r.verdict}">
    <th scope="row"><span class="rd__break">${r.endpoint}</span><span class="rd__rid">${r.target_resource_id}</span></th>
    <td>${r.owner_baseline_status}</td><td>${attacker}</td><td>${r.anonymous_status}</td><td>${verdict}</td>
  </tr>`;
}

function dastResultHtml(rep) {
  const rows = rep.authz_matrix ?? [];
  const any = rows.some((r) => r.verdict === 'PROVEN_BOLA_BYPASS');
  return html`
    <p class="mono rd__faint rd__break">${rep.run_id} · ${rep.network_isolation} · GET ${rep.healthcheck_url} ${rep.healthcheck_latency_ms} ms</p>
    <ul class="personas" aria-label="${t('Personas')}">${(rep.personas_minted ?? []).map(personaHtml)}</ul>
    <div class="rd__table-wrap">
      <table class="rd__table">
        <thead><tr><th scope="col">${t('Endpoint')}</th><th scope="col" class="rd__c">${t('Owner')}</th><th scope="col" class="rd__c">${t('Attacker')}</th><th scope="col" class="rd__c">${t('Anon')}</th><th scope="col">${t('Verdict')}</th></tr></thead>
        <tbody>${rows.map(rowHtml)}</tbody>
      </table>
    </div>
    ${any ? html`<p class="rd__summary">${t("Tenant B reached tenant A's resource and it reproduced on both runs.")}</p>` : ''}`;
}

function invariantsHtml(plan) {
  if (!plan) return unavailable('The invariants');
  const list = plan.invariants ?? [];
  return html`
    <div class="rd__head">
      <h3 class="rd__h" id="rd-inv-h">${t('Invariants · {n}', { n: list.length })}</h3>
      <span class="mono rd__faint">gemini-4-argon · store=False</span>
    </div>
    <p class="rd__muted">${plan.pr_summary}</p>
    <ol class="rd__invs">${list.map((v) => html`<li class="inv" data-testid="invariant-item">
      <span class="mono inv__id">${v.id}</span>
      <div class="inv__body">
        <div class="inv__top"><span class="inv__title">${v.title}</span><span class="mono rd__faint">${CATEGORY[v.category] ? t(CATEGORY[v.category]) : v.category} · ${v.target_function}()</span></div>
        <code class="inv__assert">${v.formal_assertion}</code>
      </div>
    </li>`)}</ol>`;
}

export function mount(root, ctx) {
  const { store, actions } = ctx;
  const { body } = createOverlay(root, { name: 'run-details', title: t('Run details'), variant: 'drawer', ctx });

  body.innerHTML = `
    <div class="rd">
      <p class="mono rd__meta" data-role="meta"></p>
      <nav class="rd__nav" aria-label="${t('Sections')}">
        <a href="#rd-diff">${t('PR diff')}</a><a href="#rd-guard">${t('Guardrail')}</a><a href="#rd-scope">${t('Scope & Live DAST')}</a><a href="#rd-inv">${t('Invariants')}</a>
      </nav>
      <div class="rd__sections">
        <section id="rd-diff" aria-labelledby="rd-diff-h">
          <div class="rd__head"><h3 class="rd__h" id="rd-diff-h">${t('PR diff')}</h3></div>
          <div data-role="diff"></div>
        </section>
        <section id="rd-guard" aria-labelledby="rd-guard-h">
          <div class="rd__head"><h3 class="rd__h" id="rd-guard-h">${t('Stage 0 · Prompt-injection guardrail')}</h3></div>
          <div data-role="guard"></div>
        </section>
        <section id="rd-scope" aria-labelledby="rd-scope-h">
          <div class="rd__head"><h3 class="rd__h" id="rd-scope-h">${t('Stage 0.5 · Sandbox scope')}</h3></div>
          <div data-role="scope"></div>
          <div class="dast">
            <div class="dast__head">
              <div class="dast__text">
                <h4 class="dast__h">${t('Live DAST · multi-persona BOLA check')}</h4>
                <p class="rd__muted">${t('Boots the server in an isolated network and replays each endpoint as three identities.')}</p>
              </div>
              <button type="button" class="btn" data-testid="dast-run" data-act="dast">${icon('lock', { size: 16 }).s}<span data-role="dast-label">${t('Run BOLA check')}</span></button>
            </div>
            <div data-role="dast-status" role="status"></div>
            <div data-role="dast-result"></div>
          </div>
        </section>
        <section id="rd-inv" aria-labelledby="rd-inv-h" data-role="inv"></section>
      </div>
    </div>`;

  const q = (r) => body.querySelector(`[data-role="${r}"]`);
  const el = {
    meta: q('meta'), diff: q('diff'), guard: q('guard'), scope: q('scope'), inv: q('inv'),
    dastLabel: q('dast-label'), dastStatus: q('dast-status'), dastResult: q('dast-result'),
  };
  const dastBtn = body.querySelector('[data-testid="dast-run"]');

  on(body, 'click', '[data-act="dast"]', () => actions.runLiveDast());
  // Section links scroll inside the drawer; they must not touch the location hash (the router owns it).
  on(body, 'click', '.rd__nav a', (e, a) => {
    e.preventDefault();
    const target = body.querySelector(a.getAttribute('href'));
    target?.scrollIntoView({ block: 'start' });
  });

  const update = (state) => {
    const { run, dast } = state;
    const meta = [run.prTitle, run.repoName, run.runId].filter(Boolean).join(' · ') || t('No run yet');
    if (el.meta.textContent !== meta) el.meta.textContent = meta;

    const pr = state.prs.find((p) => p.id === run.prId);
    patch(el.diff, diffHtml(pr?.diff));
    patch(el.guard, guardrailHtml(run.guardrail));
    patch(el.scope, scopeHtml(run.scopeTriage));
    patch(el.inv, invariantsHtml(run.invariantPlan));

    const label = dast.status === 'done' ? t('Run again') : t('Run BOLA check');
    if (el.dastLabel.textContent !== label) el.dastLabel.textContent = label;
    dastBtn.disabled = dast.status === 'running';
    patch(el.dastStatus, dast.status === 'running'
      ? html`<div class="status-box status-box--ai">${icon('spinner', { size: 16 })}${t('Minting 3 personas and replaying endpoints…')}</div>`
      : dast.status === 'error'
        ? html`<div class="status-box status-box--danger" role="alert">${icon('alert', { size: 16 })}${dast.error ? t(dast.error) : t('The Live DAST check failed.')}</div>`
        : '');
    patch(el.dastResult, dast.status === 'done' && dast.report ? dastResultHtml(dast.report) : '');
  };

  store.subscribe(update);
  update(store.getState());
}
