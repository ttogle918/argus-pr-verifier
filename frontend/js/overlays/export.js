import { html, raw, esc, setHtml, on, $, $$ } from '../dom.js';
import { icon } from '../icons.js';
import { createOverlay } from '../overlay-shell.js';
import { showToast } from '../toast.js';
import { t } from '../i18n.js';

const CI_PATH = '.github/workflows/argus-security-regression.yml';
const TABS = [['tests', 'Regression tests'], ['patch', 'Patch diff'], ['ci', 'CI workflow']];

export function diffLineClass(line) {
  if (/^(\+\+\+|---|@@)/.test(line)) return 'code__line--meta';
  if (line.startsWith('+')) return 'code__line--add';
  if (line.startsWith('-')) return 'code__line--del';
  return '';
}

export function bundleFile(bundle, tab) {
  if (tab === 'patch') {
    const diff = bundle.production_patch_diff ?? '';
    const m = /^\+\+\+ (?:b\/)?(.+)$/m.exec(diff);
    return { label: 'Patch diff', path: m ? `${m[1]} · ${bundle.patch_id}` : bundle.patch_id, content: diff, diff: true, proven: false };
  }
  if (tab === 'ci') {
    return { label: 'CI workflow', path: CI_PATH, content: bundle.ci_workflow_snippet ?? '', diff: false, proven: false };
  }
  const f = bundle.regression_test_file ?? {};
  return { label: 'Regression tests', path: f.file_path ?? '', content: f.pytest_content ?? '', diff: false, proven: true };
}

export function mount(root, ctx) {
  const { store, actions } = ctx;
  const { body, onOpen } = createOverlay(root, { name: 'export', title: t('Verified PR bundle'), variant: 'modal', ctx });
  let tab = 'tests';
  let lastSig = null;
  let focusTab = null;

  function render(state) {
    const { bundle, run } = state;
    const intro = html`<p class="export-sub">${t('The verified patch, plus regression tests pinned from the proven exploits, plus a CI gate that runs them on every push.')}</p>`;
    const footer = html`<div class="export-foot"><button type="button" class="btn" data-close>${t('Close')}</button></div>`;
    if (bundle.status === 'running' || bundle.status === 'idle') {
      return html`<div class="export">${intro}
        <div class="status-box status-box--ai" role="status">${icon('spinner', { size: 16 })}<span>${t('Building the verified PR bundle…')}</span></div>
        ${footer}</div>`;
    }
    if (bundle.status === 'error') {
      return html`<div class="export">${intro}
        <div class="status-box status-box--danger" role="alert">${icon('alert', { size: 16 })}<span>${t("Couldn't build the bundle: {message}", { message: bundle.error ? t(bundle.error) : t('unknown error') })}</span>
          <button type="button" class="btn" data-act="retry">${t('Retry')}</button></div>
        ${footer}</div>`;
    }
    const b = bundle.data;
    const s = run.score;
    const file = bundleFile(b, tab);
    const proven = (b.regression_test_file?.source_test_ids ?? []).length;
    const dl = (k, v) => html`<div class="export-facts__item"><dt>${k}</dt><dd class="mono">${v}</dd></div>`;
    return html`<div class="export">
      ${intro}
      <dl class="export-facts">
        ${dl(t('Branch'), b.branch_name)}
        ${dl(t('Patch'), b.patch_id)}
        ${dl(t('Pinned from'), t('{n} proven exploits', { n: proven }))}
        ${dl(t('After patch'), s ? t('{defects} defects · {caught}/{total} caught', { defects: s.confirmed_pr_failures_count, caught: s.planted_bugs_caught, total: s.planted_bugs_total }) : t('n/a'))}
      </dl>
      <p class="mono export-commit">${b.commit_Title ?? b.commit_title ?? ''}</p>
      <div class="tabs export-tabs" role="tablist" aria-label="${t('Bundle files')}">
        ${TABS.map(([k, label]) => html`<button type="button" class="tab" role="tab" id="export-tab-${k}" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}" aria-controls="export-panel" data-testid="export-tab" data-tab="${k}">${t(label)}</button>`)}
      </div>
      <div class="export-panel" id="export-panel" role="tabpanel" aria-labelledby="export-tab-${tab}">
        <div class="export-file">
          <code class="mono export-path">${file.path}</code>
          <div class="export-file__tools">
            ${file.proven ? html`<span class="chip">${t('TIER: PROVEN')}</span>` : ''}
            <button type="button" class="btn" data-testid="export-copy" data-act="copy">${icon('copy', { size: 15 })}${t('Copy')}</button>
          </div>
        </div>
        <pre class="code export-code" data-testid="export-code" tabindex="0">${file.diff
          ? raw(file.content.split('\n').map((l) => `<span class="code__line ${diffLineClass(l)}">${esc(l)}\n</span>`).join(''))
          : file.content}</pre>
      </div>
      ${footer}
    </div>`;
  }

  function update(state) {
    const { bundle, run } = state;
    const sig = [bundle.status, bundle.data, bundle.error, run.score, tab];
    if (lastSig && sig.length === lastSig.length && sig.every((v, i) => Object.is(v, lastSig[i]))) {
      if (focusTab) $(`[data-tab="${focusTab}"]`, body)?.focus();
      focusTab = null;
      return;
    }
    lastSig = sig;
    const saved = body.contains(document.activeElement) ? document.activeElement?.dataset?.tab : null;
    const target = focusTab || saved;
    focusTab = null;
    setHtml(body, render(state));
    if (target) $(`[data-tab="${target}"]`, body)?.focus();
  }

  const selectTab = (k) => {
    tab = k;
    update(store.getState());
  };

  on(body, 'click', '[data-testid="export-tab"]', (e, el) => selectTab(el.dataset.tab));
  body.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('[role="tab"]');
    if (!el || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const tabs = $$('[role="tab"]', body);
    const i = tabs.indexOf(el);
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i + tabs.length - 1) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else n = tabs.length - 1;
    focusTab = tabs[n].dataset.tab;
    selectTab(focusTab);
  });
  on(body, 'click', '[data-act="retry"]', () => actions.exportBundle());
  on(body, 'click', '[data-act="copy"]', async () => {
    const { bundle } = store.getState();
    if (!bundle.data) return;
    const file = bundleFile(bundle.data, tab);
    const ok = await actions.copyText(file.content);
    showToast(ok ? t('Copied {label}', { label: t(file.label) }) : t("Couldn't copy"), ok ? 'ok' : 'danger');
  });

  onOpen(() => { tab = 'tests'; lastSig = null; update(store.getState()); });
  store.subscribe(update);
  update(store.getState());
}
