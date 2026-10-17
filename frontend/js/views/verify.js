import { html, setHtml, on, prefersReducedMotion } from '../dom.js';
import { icon } from '../icons.js';
import { matrixModel, ATTACKER_LABEL, ATTACKER_ICON, formatElapsed } from '../derive.js';

const CAT_ABBR = { security: 'SEC', edge_cases: 'EDGE', edge: 'EDGE', state: 'STATE', regression: 'REG' };
const CAT_LONG = { security: 'Security', edge_cases: 'Edge case', edge: 'Edge case', state: 'State', regression: 'Regression' };
const SEV_ABBR = { CRITICAL: 'CRIT', HIGH: 'HIGH', MEDIUM: 'MED' };

// Cell fill motion plays once per run id.
let lastAnimatedRunId = null;

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
  if (row.validity === 'defect') return { text: `${row.invariantId} · defect, failed ${p1 ? 'on PR' : '2/2 on PR'}`, cls: 'meta--danger' };
  if (row.validity === 'flaky') return { text: `${row.invariantId} · flaky, failed ${p1 ? 'on PR' : '1/2 on PR'}`, cls: 'meta--warn' };
  return { text: `${row.invariantId} · held ${p1 ? 'on PR' : '2/2 on PR'}`, cls: '' };
}

function matrixHtml(model, sel, phase, animate) {
  const { columns, groups } = model;
  const tpl = `minmax(300px, 2.2fr) repeat(${columns.length}, minmax(60px, 1fr))`;
  const isSel = (id) => (id === sel ? ' is-sel' : '');
  const head = columns.map((c) => html`
    <div role="columnheader" class="vcol${isSel(c.id)}${c.calibration ? ' is-cal' : ''}">
      <button type="button" class="vcol__btn" data-testid="matrix-col" data-mutant-id="${c.id}" aria-pressed="${c.id === sel ? 'true' : 'false'}">
        <span class="vcol__id">${c.id}</span>
        <span class="vcol__cat">${abbr(c.category)}</span>
        <span class="vcol__sev ${sevClass(c.severity)}">${SEV_ABBR[c.severity] ?? c.severity}</span>
        ${c.calibration ? html`<span class="vcol__cal">CAL</span>` : ''}
      </button>
    </div>`);
  const body = groups.map((g) => html`
    <div role="row" class="vrow vrow--group">
      <div role="rowheader" class="vgroup">${icon(ATTACKER_ICON[g.attackerId] ?? 'info', { size: 14 })}${ATTACKER_LABEL[g.attackerId] ?? g.attackerId}</div>
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
              <span class="visually-hidden">${r.testId} on ${cell.mutantId}: ${cell.state}</span>
            </div>
          </div>`;
        })}
      </div>`;
    })}`);
  const foot = columns.map((c) => html`
    <div role="cell" class="vfoot${isSel(c.id)}">
      <span class="vverdict vverdict--${c.verdict}" data-testid="mutant-verdict" data-mutant-id="${c.id}" data-verdict="${c.verdict}">${c.verdict === 'caught' ? icon('check', { size: 13 }) : icon('eyeClosed', { size: 10 })}${c.verdict === 'caught' ? 'Caught' : 'Survived'}</span>
    </div>`);
  return html`
    <div class="vmatrix-scroll panel">
      <div role="table" aria-label="Attack tests by planted mutant" class="vmatrix" data-testid="matrix" data-fill="${animate ? 'pre' : 'done'}" style="min-width: ${300 + columns.length * 60}px">
        <div role="rowgroup"><div role="row" class="vrow vrow--head" style="grid-template-columns: ${tpl}">
          <div role="columnheader" class="vhead">Attack test</div>${head}</div></div>
        <div role="rowgroup">${body}</div>
        <div role="rowgroup"><div role="row" class="vrow vrow--foot" style="grid-template-columns: ${tpl}">
          <div role="rowheader" class="vhead vhead--foot">Mutant verdict</div>${foot}</div></div>
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
    ? html`<ul class="vby">${col.caughtBy.map((t) => html`<li><code>${t}</code> <span class="vby__who">(${ATTACKER_LABEL[testAttacker.get(t)] ?? 'Calibration'})</span></li>`)}</ul>`
    : html`<p class="vby vby--none">None. All ${validCount} valid tests passed on this mutant.</p>`;
  let why = '';
  if (!caught && col.calibration) {
    why = html`<div class="status-box status-box--warn vwhy">${icon('warn', { size: 16 })}<span>Calibration mutant: you set its outcome.</span></div>`;
  } else if (!caught && run.oneCard?.blind_spot_explanation) {
    why = html`<div class="vwhy vwhy--box"><span class="vwhy__head">${icon('warn', { size: 16 })}Why it survived</span><p>${run.oneCard.blind_spot_explanation}</p></div>`;
  }
  const exclHtml = excluded.length ? html`
    <div class="vexcl">
      <span class="label-caps">${excluded.length} test${excluded.length === 1 ? '' : 's'} excluded from scoring</span>
      <p>They failed on the original PR, so a failure on a mutant proves nothing.</p>
      <ul>${excluded.map((r) => html`<li><span class="vchip vchip--${r.validity}">${r.validity === 'defect' ? 'DEFECT' : 'FLAKY'}${p1 ? '' : r.validity === 'defect' ? ' 2/2' : ' 1/2'}</span><code>${r.testId}</code></li>`)}</ul>
    </div>` : '';
  return html`
    <div class="vaside__top">
      <span class="vaside__id">${col.id}</span>
      <span class="vverdict vverdict--${col.verdict}">${caught ? icon('check', { size: 13 }) : icon('eyeClosed', { size: 10 })}${caught ? 'Caught' : 'Survived'}</span>
      <span class="vaside__cat">${CAT_LONG[col.category] ?? col.category} · ${col.severity}</span>
      ${col.calibration ? html`<span class="vcol__cal vcol__cal--inline">CALIBRATION</span>` : ''}
    </div>
    <h2 class="vaside__title">${col.title}</h2>
    <p class="vaside__desc">${col.description}</p>
    <div class="vsec"><span class="label-caps">Planted change</span>
      <pre class="code vcode">${diffLines.map((l) => html`<span class="${lineCls(l)}">${l}\n</span>`)}</pre></div>
    <div class="vsec"><span class="label-caps">Caught by</span>${by}</div>
    ${why}
    ${exclHtml}
    <div class="vaside__actions">
      <button type="button" class="btn" data-testid="open-mutant-form">+ Plant calibration mutant</button>
      <button type="button" class="btn btn--primary btn--lg" data-testid="continue-decide">Continue to decision${icon('arrowRight', { size: 16 })}</button>
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
  const elapsed = run.startedAt && run.finishedAt ? ` · completed in ${formatElapsed(run.startedAt, run.finishedAt)}` : '';
  return html`
    <section class="vhero">
      <div class="vhero__text">
        <h1>Verification matrix</h1>
        <p class="vhero__lede">Every valid attack test was run against each hidden mutant. A mutant counts as caught only when a test passes on the PR and fails on the mutant.</p>
        <code class="vhero__formula">Caught(m) ⇔ ∃ test: Pass(test, PR) ∧ Fail(test, m)</code>
        <p class="vhero__meta mono">${run.prTitle || f.pr_title} · ${run.repoName || f.repo_name} · ${run.runId}${elapsed}</p>
      </div>
      <div class="vscore panel">
        <div class="vscore__num">
          <div class="vscore__big mono"><span class="vscore__n" data-testid="score-big">${caught}/${total}</span></div>
          <span class="vscore__cap">planted bugs caught</span>
        </div>
        <dl class="vscore__dl">
          <div><dt>Detection</dt><dd class="mono">${pct}%</dd></div>
          <div><dt>Tests</dt><dd class="mono">${testsRun} run · ${valid} valid</dd></div>
          <div><dt>Survived</dt><dd class="mono vscore__surv">${survivedIds.length ? html`${icon('eyeClosed', { size: 12 })}${survivedIds.join(', ')}` : 'None'}</dd></div>
        </dl>
      </div>
    </section>
    <ul class="vlegend" aria-label="Legend">
      <li><span class="vsw vcell vcell--caught">${icon('check', { size: 14 })}</span><strong>Caught</strong> passed on PR, failed on mutant</li>
      <li><span class="vsw vcell vcell--survived"><span class="vcell__dash"></span></span><strong>Survived</strong> test passed on mutant too</li>
      <li><span class="vsw vcell vcell--invalid">${icon('invalid', { size: 13 })}</span><strong>Invalid</strong> test failed on the PR, excluded</li>
    </ul>`;
}

export function mount(root, ctx) {
  const { store, actions } = ctx;
  setHtml(root, html`<div class="page verify">
    <div class="verify__empty" hidden>
      <div class="empty-state"><p>Run a verification first.</p><button type="button" class="btn btn--primary" data-act="start">Go to Start</button></div>
    </div>
    <div class="verify__main" hidden>
      <div class="verify__head"></div>
      <section class="verify__body">
        <div class="verify__matrix"></div>
        <aside class="vaside panel" aria-label="Selected mutant" data-testid="mutant-detail"></aside>
      </section>
    </div></div>`);
  const emptyEl = root.querySelector('.verify__empty');
  const mainEl = root.querySelector('.verify__main');
  const headEl = root.querySelector('.verify__head');
  const matrixEl = root.querySelector('.verify__matrix');
  const asideEl = root.querySelector('.vaside');

  let last = {};
  let pendingFocus = null;

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
      emptyEl.hidden = false; mainEl.hidden = true; last = {};
      return;
    }
    emptyEl.hidden = true; mainEl.hidden = false;
    const dataChanged = last.final !== run.final || last.cal !== run.calibrationIds || last.phase !== run.phase || last.oneCard !== run.oneCard;
    const model = dataChanged || !last.model ? matrixModel(run.final, run.calibrationIds, run.phase) : last.model;
    const sel = effectiveSelection(model.columns, state.ui.selectedMutant);
    if (!dataChanged && last.sel === sel) return;

    const focusedId = pendingFocus ?? root.contains(document.activeElement)
      ? (pendingFocus ?? document.activeElement.closest?.('[data-testid="matrix-col"]')?.dataset.mutantId)
      : null;
    if (dataChanged) {
      const animate = run.runId !== lastAnimatedRunId && !prefersReducedMotion();
      lastAnimatedRunId = run.runId;
      setHtml(headEl, headerHtml(run, model));
      setHtml(matrixEl, matrixHtml(model, sel, run.phase, animate));
      if (animate) {
        const m = matrixEl.querySelector('.vmatrix');
        requestAnimationFrame(() => requestAnimationFrame(() => { m.dataset.fill = 'done'; }));
      }
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
    if (focusedId) matrixEl.querySelector(`[data-testid="matrix-col"][data-mutant-id="${focusedId}"]`)?.focus();
    pendingFocus = null;
    last = { model, sel, final: run.final, cal: run.calibrationIds, phase: run.phase, oneCard: run.oneCard };
  };
  store.subscribe(update);
  update(store.getState());
}
