import { html, setHtml, on } from '../dom.js';
import { icon, ARGUS_LOGO } from '../icons.js';
import { allowedView } from '../router.js';
import { SAMPLE_PR_IDS } from '../derive.js';

const NAV = [
  ['start', '1', 'Start'],
  ['run', '2', 'Run'],
  ['verify', '3', 'Verify'],
  ['decide', '4', 'Decide'],
];

const MODE_TEXT = { replay: 'RECORDED REPLAY', live_api: 'LIVE' };

// The header describes what is in view: on Start it echoes the current selection,
// elsewhere it reports the run that is actually being shown.
function modeChip(state) {
  const { run, options, view } = state;
  const showRun = run.status !== 'idle' && view !== 'start';
  if (!showRun) {
    const mode = options.mode;
    return html`<span class="chip" data-testid="mode-chip">${icon(mode === 'live_api' ? 'info' : 'replay', { size: 14 })}${MODE_TEXT[mode] ?? mode}</span>`;
  }
  if (run.requestedMode === 'live_api' && run.effectiveMode === 'replay') {
    return html`<span class="chip chip--warn" data-testid="mode-chip">${icon('warn', { size: 14 })}LIVE &rarr; REPLAY</span>`;
  }
  const mode = run.effectiveMode ?? run.requestedMode;
  return html`<span class="chip" data-testid="mode-chip">${icon(mode === 'live_api' ? 'info' : 'replay', { size: 14 })}${MODE_TEXT[mode] ?? mode}</span>`;
}

function sampleChip(state) {
  const { run, selectedPrId, view } = state;
  const prId = run.status !== 'idle' && view !== 'start' ? run.prId : selectedPrId;
  if (!SAMPLE_PR_IDS.includes(prId)) return '';
  return html`<span class="chip chip--dashed" data-testid="sample-chip">${icon('info', { size: 14 })}SAMPLE DATA</span>`;
}

export function mount(root, ctx) {
  on(root, 'click', '.nav-link[aria-disabled="true"]', (e) => e.preventDefault());

  let last = null;
  const update = (state) => {
    const links = NAV.map(([view, num, label]) => {
      const current = state.view === view;
      const disabled = !allowedView(view, state);
      return html`<a class="nav-link" href="#/${view}" data-testid="nav-${view}"
        ${current ? html`aria-current="page"` : ''}
        ${disabled ? html`aria-disabled="true" tabindex="-1"` : ''}><span class="mono nav-link__num">${num}</span>${label}</a>`;
    });
    const markup = html`
      <div class="app-header__brand">${ARGUS_LOGO}<span class="app-header__name">Argus-PR</span></div>
      <nav class="app-header__nav" aria-label="Workflow">${links}</nav>
      <div class="app-header__chips">${modeChip(state)}${sampleChip(state)}</div>`;
    // Re-rendering destroys the focused nav link; only touch the DOM when the output changed.
    const str = String(markup.s);
    if (str === last) return;
    last = str;
    setHtml(root, markup);
  };

  ctx.store.subscribe(update);
  update(ctx.store.getState());
}
