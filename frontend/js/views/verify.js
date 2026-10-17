import { html, setHtml, on, prefersReducedMotion } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { matrixModel, ATTACKER_LABEL, ATTACKER_ICON, formatElapsed } from '../derive.js';

const CAT_ABBR = { security: 'SEC', edge_cases: 'EDGE', edge: 'EDGE', state: 'STATE', regression: 'REG' };
const CAT_LONG = { security: 'Security', edge_cases: 'Edge case', edge: 'Edge case', state: 'State', regression: 'Regression' };
const SEV_ABBR = { CRITICAL: 'CRIT', HIGH: 'HIGH', MEDIUM: 'MED' };

// Cell fill motion plays once per run id.
let lastAnimatedRunId = null;

const cssEscape = (v) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'));
const abbr = (c) => CAT_ABBR[c] ?? String(c).toUpperCase().slice(0, 5);
const sevClass = (s) => (s === 'CRITICAL' ? 'sev--crit' : s === 'HIGH' ? 'sev--high' : 'sev--med');

// Selected mutant: explicit choice, else the first survivor, else the first column.
export function effectiveSelection(columns, selected) {
  if (selected && columns.some((c) => c.id === selected)) return selected;
  return (columns.find((c) => c.verdict === 'survived') ?? columns[0])?.id ?? null;
}

function cellInner(state) {
  if (state === 'caught') return icon('check', { size: 16 });
  if (state === 'invalid') return icon('invalid', { size: 14 });
  return html`<span class="vcell__dash"></span>`;
}

function rowMeta(row, phase) {
  const p1 = phase === 'phase1_mvp';
  const id = row.invariantId;
  if (row.validity === 'defect') return { text: p1 ? t('{id} · defect, failed on PR', { id }) : t('{id} · defect, failed 2/2 on PR', { id }), cls: 'meta--danger' };
  if (row.validity === 'flaky') return { text: p1 ? t('{id} · flaky, failed on PR', { id }) : t('{id} · flaky, failed 1/2 on PR', { id }), cls: 'meta--warn' };
  return { text: p1 ? t('{id} · held on PR', { id }) : t('{id} · held 2/2 on PR', { id }), cls: '' };
}

function matrixHtml(model, sel, phase, animate) {
  const { columns, groups } = model;
  const tpl = `minmax(300px, 2.2fr) repeat(${columns.length}, minmax(60px, 1fr))`;
  const isSel = (id) => (id === sel ? ' is-sel' : '');
  const head = columns.map((c) => html`
    <div role="columnheader" class="vcol${isSel(c.id)}${c.calibration ? ' is-cal' : ''}">
      <button type="button" class="vcol__btn" data-testid="matrix-col" data-mutant-id="${c.id}" aria-pressed="${c.id === sel ? 'true' : 'false'}">
        <span class="vcol__id">${c.id}</span>
        <span class="vcol__cat">${t(abbr(c.category))}</span>
        <span class="vcol__sev ${sevClass(c.severity)}">${SEV_ABBR[c.severity] ?? c.severity}</span>
        ${c.calibration ? html`<span class="vcol__cal">${t('CAL')}</span>` : ''}
      </button>
    </div>`);
  const body = groups.map((g) => html`
    <div role="row" class="vrow vrow--group">
      <div role="rowheader" class="vgroup">${icon(ATTACKER_ICON[g.attackerId] ?? 'info', { size: 14 })}${t(ATTACKER_LABEL[g.attackerId] ?? g.attackerId)}</div>
    </div>
    ${g.rows.map((r) => {
      const meta = rowMeta(r, phase);
      return html`
      <div role="row" class="vrow" style="grid-template-columns: ${tpl}" data-testid="matrix-row" data-test-id="${r.testId}" data-validity="${r.validity}">
        <div role="rowheader" class="vtest">
          <code class="vtest__id${r.validity === 'valid' ? '' : ' is-muted'}">${r.testId}</code>
          <span class="vtest__meta ${meta.cls}">${meta.text}</span>
        </div>
        ${r.cells.map((cell, ci) => {
          const col = columns[ci];
          const survCol = col.verdict === 'survived' && cell.state === 'survived';
          return html`
          <div role="cell" class="vcellwrap${isSel(col.id)}">
            <div class="vcell vcell--${cell.state}${survCol ? ' vcell--survcol' : ''}" data-testid="matrix-cell" data-mutant-id="${cell.mutantId}" data-state="${cell.state}" style="transition-delay: ${ci * 20}ms">
              ${cellInner(cell.state)}
              <span class="visually-hidden">${t('{test} on {mutant}: {state}', { test: r.testId, mutant: cell.mutantId, state: t(cell.state) })}</span>
            </div>
          </div>`;
        })}
      </div>`;
    })}`);
  const foot = columns.map((c) => html`
    <div role="cell" class="vfoot${isSel(c.id)}">
      <span class="vverdict vverdict--${c.verdict}" data-testid="mutant-verdict" data-mutant-id="${c.id}" data-verdict="${c.verdict}">${c.verdict === 'caught' ? icon('check', { size: 13 }) : icon('eyeClosed', { size: 10 })}${c.verdict === 'caught' ? t('Caught') : t('Survived')}</span>
    </div>`);
  return html`
    <div class="vmatrix-scroll panel">
      <div role="table" aria-label="${t('Attack tests by planted mutant')}" class="vmatrix" data-testid="matrix" data-fill="${animate ? 'pre' : 'done'}" style="min-width: ${300 + columns.length * 60}px">
        <div role="rowgroup"><div role="row" class="vrow vrow--head" style="grid-template-columns: ${tpl}">
          <div role="columnheader" class="vhead">${t('Attack test')}</div>${head}</div></div>
        <div role="rowgroup">${body}</div>
        <div role="rowgroup"><div role="row" class="vrow vrow--foot" style="grid-template-columns: ${tpl}">
          <div role="rowheader" class="vhead vhead--foot">${t('Mutant verdict')}</div>${foot}</div></div>
      </div>
    </div>`;
}

function asideHtml(run, model, sel) {
  const col = model.columns.find((c) => c.id === sel);
  if (!col) return '';
  const testAttacker = new Map();
  model.groups.forEach((g) => g.rows.forEach((r) => testAttacker.set(r.testId, g.attackerId)));
  const allRows = model.groups.flatMap((g) => g.rows);
  const validCount = allRows.filter((r) => r.validity === 'valid').length;
  const excluded = allRows.filter((r) => r.validity !== 'valid');
  const caught = col.verdict === 'caught';
  const p1 = run.phase === 'phase1_mvp';
  const diffLines = String(col.diff ?? '').split('\n').filter((l) => l.length);
  const lineCls = (l) => (l.startsWith('+') ? 'code__line code__line--add' : l.startsWith('-') ? 'code__line code__line--del' : 'code__line code__line--meta');
  const by = col.caughtBy.length
    ? html`<ul class="vby">${col.caughtBy.map((tid) => html`<li><code>${tid}</code> <span class="vby__who">(${ATTACKER_LABEL[testAttacker.get(tid)] ? t(ATTACKER_LABEL[testAttacker.get(tid)]) : t('Calibration')})</span></li>`)}</ul>`
    : html`<p class="vby vby--none">${t('None. All {n} valid tests passed on this mutant.', { n: validCount })}</p>`;
  let why = '';
  if (!caught && col.calibration) {
    why = html`<div class="status-box status-box--warn vwhy">${icon('warn', { size: 16 })}<span>${t('Calibration mutant: you set its outcome.')}</span></div>`;
  } else if (!caught && run.oneCard?.blind_spot_explanation) {
    why = html`<div class="vwhy vwhy--box"><span class="vwhy__head">${icon('warn', { size: 16 })}${t('Why it survived')}</span><p>${run.oneCard.blind_spot_explanation}</p></div>`;
  }
  const exclHtml = excluded.length ? html`
    <div class="vexcl">
      <span class="label-caps">${excluded.length === 1 ? t('{n} test excluded from scoring', { n: 1 }) : t('{n} tests excluded from scoring', { n: excluded.length })}</span>
      <p>${t('They failed on the original PR, so a failure on a mutant proves nothing.')}</p>
      <ul>${excluded.map((r) => html`<li><span class="vchip vchip--${r.validity}">${r.validity === 'defect' ? t('DEFECT') : t('FLAKY')}${p1 ? '' : r.validity === 'defect' ? ' 2/2' : ' 1/2'}</span><code>${r.testId}</code></li>`)}</ul>
    </div>` : '';
  return html`
    <div class="vaside__top">
      <span class="vaside__id">${col.id}</span>
      <span class="vverdict vverdict--${col.verdict}">${caught ? icon('check', { size: 13 }) : icon('eyeClosed', { size: 10 })}${caught ? t('Caught') : t('Survived')}</span>
      <span class="vaside__cat">${t(CAT_LONG[col.category] ?? col.category)} · ${col.severity}</span>
      ${col.calibration ? html`<span class="vcol__cal vcol__cal--inline">${t('CALIBRATION')}</span>` : ''}
    </div>
    <h2 class="vaside__title">${col.title}</h2>
    <p class="vaside__desc">${col.description}</p>
    <div class="vsec"><span class="label-caps">${t('Planted change')}</span>
      <pre class="code vcode">${diffLines.map((l) => html`<span class="${lineCls(l)}">${l}\n</span>`)}</pre></div>
    <div class="vsec"><span class="label-caps">${t('Caught by')}</span>${by}</div>
    ${why}
    ${exclHtml}
    <div class="vaside__actions">
      <button type="button" class="btn" data-testid="open-mutant-form">${t('+ Plant calibration mutant')}</button>
      <button type="button" class="btn btn--primary btn--lg" data-testid="continue-decide">${t('Continue to decision')}${icon('arrowRight', { size: 16 })}</button>
    </div>`;
}

function headerHtml(run, model) {
  const cols = model.columns;
  const total = cols.length;
  const caught = cols.filter((c) => c.verdict === 'caught').length;
  const survivedIds = cols.filter((c) => c.verdict === 'survived').map((c) => c.id);
  const pct = total ? Math.round((caught / total) * 1000) / 10 : 0;
  const s = run.score;
  const testsRun = s?.total_tests_generated ?? model.groups.reduce((n, g) => n + g.rows.length, 0);
  const valid = s?.valid_baseline_tests ?? model.groups.reduce((n, g) => n + g.rows.filter((r) => r.validity === 'valid').length, 0);
  const f = run.final;
  const elapsed = run.startedAt && run.finishedAt ? ` · ${t('completed in {time}', { time: formatElapsed(run.startedAt, run.finishedAt) })}` : '';
  return html`
    <section class="vhero">
      <div class="vhero__text">
        <h1>${t('Verification matrix')}</h1>
        <p class="vhero__lede">${t('Every valid attack test was run against each hidden mutant. A mutant counts as caught only when a test passes on the PR and fails on the mutant.')}</p>
        <code class="vhero__formula">Caught(m) ⇔ ∃ test: Pass(test, PR) ∧ Fail(test, m)</code>
        <p class="vhero__meta mono">${run.prTitle || f.pr_title} · ${run.repoName || f.repo_name} · ${run.runId}${elapsed}</p>
      </div>
      <div class="vscore panel">
        <div class="vscore__num">
          <div class="vscore__big mono"><span class="vscore__n" data-testid="score-big">${caught}/${total}</span></div>
          <span class="vscore__cap">${t('planted bugs caught')}</span>
        </div>
        <dl class="vscore__dl">
          <div><dt>${t('Detection')}</dt><dd class="mono">${pct}%</dd></div>
          <div><dt>${t('Tests')}</dt><dd class="mono">${t('{run} run · {valid} valid', { run: testsRun, valid })}</dd></div>
          <div><dt>${t('Survived')}</dt><dd class="mono vscore__surv">${survivedIds.length ? html`${icon('eyeClosed', { size: 12 })}${survivedIds.join(', ')}` : t('None')}</dd></div>
        </dl>
      </div>
    </section>
    <ul class="vlegend" aria-label="${t('Legend')}">
      <li><span class="vsw vcell vcell--caught">${icon('check', { size: 14 })}</span><strong>${t('Caught')}</strong> ${t('passed on PR, failed on mutant')}</li>
      <li><span class="vsw vcell vcell--survived"><span class="vcell__dash"></span></span><strong>${t('Survived')}</strong> ${t('test passed on mutant too')}</li>
      <li><span class="vsw vcell vcell--invalid">${icon('invalid', { size: 13 })}</span><strong>${t('Invalid')}</strong> ${t('test failed on the PR, excluded')}</li>
    </ul>`;
}

export function mount(root, ctx) {
  const { store, actions } = ctx;
  setHtml(root, html`<div class="page verify">
    <div class="verify__empty" hidden>
      <div class="empty-state"><p>${t('Run a verification first.')}</p><button type="button" class="btn btn--primary" data-act="start">${t('Go to Start')}</button></div>
    </div>
    <div class="verify__main" hidden>
      <div class="verify__head"></div>
      <section class="verify__body">
        <div class="verify__matrix"></div>
        <aside class="vaside panel" aria-label="${t('Selected mutant')}" data-testid="mutant-detail"></aside>
      </section>
    </div></div>`);
  const emptyEl = root.querySelector('.verify__empty');
  const mainEl = root.querySelector('.verify__main');
  const headEl = root.querySelector('.verify__head');
  const matrixEl = root.querySelector('.verify__matrix');
  const asideEl = root.querySelector('.vaside');

  let last = {};
  let pendingFocus = null;
  let fillPending = false; // matrix rendered in its pre-fill state, waiting until Verify is on screen

  // Start the fill only once #view-verify is visible; the double rAF lets the pre-fill state paint first.
  function startFill(state) {
    if (!fillPending || state.view !== 'verify') return;
    fillPending = false;
    lastAnimatedRunId = state.run.runId;
    const m = matrixEl.querySelector('.vmatrix');
    requestAnimationFrame(() => requestAnimationFrame(() => { if (m) m.dataset.fill = 'done'; }));
  }

  on(root, 'click', '[data-act="start"]', () => actions.navigate('start'));
  on(root, 'click', '[data-testid="matrix-col"]', (e, el) => actions.selectMutant(el.dataset.mutantId));
  on(root, 'click', '[data-testid="open-mutant-form"]', () => actions.openOverlay('mutant'));
  on(root, 'click', '[data-testid="continue-decide"]', () => actions.navigate('decide'));
  root.addEventListener('keydown', (e) => {
    const btn = e.target.closest?.('[data-testid="matrix-col"]');
    if (!btn || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const btns = Array.from(root.querySelectorAll('[data-testid="matrix-col"]'));
    const i = btns.indexOf(btn);
    const next = btns[e.key === 'ArrowRight' ? Math.min(i + 1, btns.length - 1) : Math.max(i - 1, 0)];
    if (!next) return;
    e.preventDefault();
    pendingFocus = next.dataset.mutantId;
    actions.selectMutant(next.dataset.mutantId);
  });

  const update = (state) => {
    const run = state.run;
    if (!run.final) {
      emptyEl.hidden = false; mainEl.hidden = true; last = {}; fillPending = false;
      return;
    }
    emptyEl.hidden = true; mainEl.hidden = false;
    const dataChanged = last.final !== run.final || last.cal !== run.calibrationIds || last.phase !== run.phase || last.oneCard !== run.oneCard;
    const model = dataChanged || !last.model ? matrixModel(run.final, run.calibrationIds, run.phase) : last.model;
    const sel = effectiveSelection(model.columns, state.ui.selectedMutant);
    if (!dataChanged && last.sel === sel) { pendingFocus = null; startFill(state); return; }

    const focusedId = pendingFocus ?? (root.contains(document.activeElement)
      ? document.activeElement.closest?.('[data-testid="matrix-col"]')?.dataset.mutantId
      : null);
    if (dataChanged) {
      fillPending = run.runId !== lastAnimatedRunId && !prefersReducedMotion();
      setHtml(headEl, headerHtml(run, model));
      setHtml(matrixEl, matrixHtml(model, sel, run.phase, fillPending));
    } else {
      // Selection only: patch in place so the matrix neither re-animates nor loses focus.
      matrixEl.querySelectorAll('[data-testid="matrix-col"]').forEach((b) => {
        b.setAttribute('aria-pressed', b.dataset.mutantId === sel ? 'true' : 'false');
      });
      const ids = model.columns.map((c) => c.id);
      matrixEl.querySelectorAll('.vcol, .vfoot').forEach((el, i) => el.classList.toggle('is-sel', ids[i % ids.length] === sel));
      matrixEl.querySelectorAll('.vcellwrap').forEach((el) => {
        el.classList.toggle('is-sel', el.firstElementChild.dataset.mutantId === sel);
      });
    }
    setHtml(asideEl, asideHtml(run, model, sel));
    if (focusedId) matrixEl.querySelector(`[data-testid="matrix-col"][data-mutant-id="${cssEscape(focusedId)}"]`)?.focus();
    pendingFocus = null;
    startFill(state);
    last = { model, sel, final: run.final, cal: run.calibrationIds, phase: run.phase, oneCard: run.oneCard };
  };
  store.subscribe(update);
  update(store.getState());
}
