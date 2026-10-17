import { html, setHtml, on, $ } from '../dom.js';
import { icon } from '../icons.js';
import { createScene2D } from '../scene/scene2d.js';
import { sceneModel } from '../derive.js';
import { initialRun } from '../state.js';

const PHASES = [
  { value: 'phase2_full', label: 'Phase 2 · 4 attackers · 2× repro' },
  { value: 'phase1_mvp', label: 'Phase 1 · 3 attackers · 1 run' },
];
const MODES = [
  { value: 'replay', label: 'Recorded replay' },
  { value: 'live_api', label: 'Live Gemini API' },
];
const SCOPES = [
  { value: 'auto', label: 'Auto (smart triage)' },
  { value: 'single_file', label: 'Single file' },
  { value: 'sparse_package', label: 'Sparse package' },
  { value: 'server_daemon', label: 'Live server daemon' },
];
const MODE_NOTE = {
  replay: 'Replay streams recorded sandbox traces through the same pipeline. Every screen marks the run as a replay.',
  live_api: 'Live calls Gemini and the Antigravity sandbox. Without an API key on the server, the run falls back to replay and says so.',
};

const pill = (name, testid, o) => html`
  <label class="choice"><input type="radio" name="${name}" value="${o.value}" data-testid="${testid}" data-value="${o.value}">${o.label}</label>`;

function prRows(state) {
  if (state.prsStatus === 'loading') {
    return html`<div class="start-skeletons" aria-busy="true">${[0, 1, 2].map(() => html`<div class="pr-option pr-option--skeleton"></div>`)}</div>`;
  }
  if (state.prsStatus === 'error') {
    return html`<div class="status-box status-box--danger" role="alert">${icon('alert', { size: 16 })}<span>Couldn't load sample pull requests.</span>
      <button type="button" class="btn" data-retry>Retry</button></div>`;
  }
  return html`${state.prs.map((pr) => html`
    <label class="pr-option" data-testid="pr-option" data-pr-id="${pr.id}">
      <input type="radio" name="pr" value="${pr.id}">
      <span class="pr-option__text">
        <span class="pr-option__title">${pr.title}</span>
        <span class="pr-option__meta mono">${pr.repo_name} · ${pr.author}</span>
      </span>
      ${pr.is_adversarial ? html`<span class="chip chip--danger">${icon('warn', { size: 12 })}Injection sample</span>` : ''}
    </label>`)}`;
}

export function mount(root, ctx) {
  const { store, actions } = ctx;
  setHtml(root, html`
  <div class="page start">
    <section class="start-hero">
      <div class="start-main">
        <div class="start-intro">
          <p class="eyebrow">Pre-merge red-teaming for AI-written pull requests</p>
          <h1 class="start-title">Break the PR before it breaks production.</h1>
          <p class="start-lead">An attacker swarm writes tests designed to break your pull request. Eight bugs are hidden in a sealed copy the attackers never see, so you also learn how far to trust those tests.</p>
        </div>
        <fieldset class="start-fieldset"><legend class="label-caps">Pull request</legend>
          <div class="start-prs" data-prs></div>
        </fieldset>
        <div class="start-options">
          <fieldset class="start-fieldset"><legend class="label-caps">Attack depth</legend>
            <div class="start-pills">${PHASES.map((o) => pill('phase', 'phase-option', o))}</div></fieldset>
          <fieldset class="start-fieldset"><legend class="label-caps">Execution</legend>
            <div class="start-pills">${MODES.map((o) => pill('mode', 'mode-option', o))}</div></fieldset>
          <div class="start-fieldset"><label class="label-caps" for="start-scope">Sandbox scope</label>
            <select class="select start-scope" id="start-scope" data-testid="scope-select">${SCOPES.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select></div>
        </div>
        <div class="start-actions-wrap">
          <div class="start-actions">
            <button type="button" class="btn btn--primary btn--lg" data-testid="run-button">${icon('play', { size: 18 })}Run verification</button>
            <button type="button" class="btn" data-testid="open-diff">${icon('code')}View PR diff</button>
            <button type="button" class="btn btn--ghost" data-testid="open-import">${icon('plus')}Import PR</button>
          </div>
          <p class="start-note" data-mode-note></p>
        </div>
      </div>
      <div class="panel start-scene">
        <div class="start-scene__head"><span class="label-caps">Hidden mutants</span><span class="mono start-scene__meta">8 to be planted · 0 caught</span></div>
        <div class="start-scene__canvas" data-scene></div>
        <p class="start-note">Eight subtle bugs go into a sealed copy of this PR. The attackers never see them. Every one their tests catch opens an eye. The ones they miss stay shut.</p>
        <ul class="start-legend">
          <li class="start-legend__item start-legend__item--sealed">${icon('eyeClosed', { size: 17 })}Sealed</li>
          <li class="start-legend__item start-legend__item--caught">${icon('eyeOpen', { size: 17 })}Caught</li>
          <li class="start-legend__item start-legend__item--survived">${icon('eyeClosed', { size: 17 })}Survived</li>
        </ul>
      </div>
    </section>
    <section aria-labelledby="how-title" class="start-how">
      <h2 class="start-how__title" id="how-title">How a run works</h2>
      <div class="start-how__grid">
        <div class="how-card"><span class="how-card__num mono">01</span><h3>Extract invariants</h3>
          <p>Gemini 4 Argon reads the diff and writes the properties the PR must keep, then plans one attack per category.</p>
          <span class="how-card__foot mono">gemini-4-argon · store=False</span></div>
        <div class="how-card"><span class="how-card__num mono">02</span><h3>Attack in parallel</h3>
          <p>Security, Edge Case, State and Regression agents write breaking tests, adapting over up to five attempts. Failures count only if they reproduce twice.</p>
          <span class="how-card__foot mono">4× gemini-3.8-flash · antigravity sandbox</span></div>
        <div class="how-card"><span class="how-card__num mono">03</span><h3>Score against hidden bugs</h3>
          <p>A test catches a planted bug only if it passes on the PR and fails on the mutant. The score is computed in Python, never estimated by a model.</p>
          <code class="how-card__foot mono">Caught(m) ⇔ Pass(PR) ∧ Fail(m)</code></div>
      </div>
    </section>
  </div>`);

  const prsEl = $('[data-prs]', root);
  const noteEl = $('[data-mode-note]', root);
  const scopeEl = $('[data-testid="scope-select"]', root);
  const scene = createScene2D($('[data-scene]', root));
  scene.update(sceneModel(initialRun()));

  on(root, 'change', 'input[name="pr"]', (e, el) => actions.selectPr(el.value));
  on(root, 'change', 'input[name="phase"]', (e, el) => actions.setOptions({ phase: el.value }));
  on(root, 'change', 'input[name="mode"]', (e, el) => actions.setOptions({ mode: el.value }));
  scopeEl.addEventListener('change', () => actions.setOptions({ scope: scopeEl.value }));
  on(root, 'click', '[data-retry]', () => actions.loadPrs());
  on(root, 'click', '[data-testid="run-button"]', () => actions.run());
  on(root, 'click', '[data-testid="open-diff"]', () => actions.openOverlay('diff'));
  on(root, 'click', '[data-testid="open-import"]', () => actions.openOverlay('import'));

  let lastPrs = null;
  let lastStatus = null;
  const update = (state) => {
    // Rebuild the list only when the data changed, so keyboard focus on a radio survives selection.
    if (state.prs !== lastPrs || state.prsStatus !== lastStatus) {
      const hadFocus = prsEl.contains(document.activeElement);
      lastPrs = state.prs;
      lastStatus = state.prsStatus;
      setHtml(prsEl, prRows(state));
      if (hadFocus) $('input[name="pr"]:checked', prsEl)?.focus();
    }
    for (const input of prsEl.querySelectorAll('input[name="pr"]')) input.checked = input.value === state.selectedPrId;
    for (const input of root.querySelectorAll('input[name="phase"]')) input.checked = input.value === state.options.phase;
    for (const input of root.querySelectorAll('input[name="mode"]')) input.checked = input.value === state.options.mode;
    if (scopeEl.value !== state.options.scope) scopeEl.value = state.options.scope;
    noteEl.textContent = MODE_NOTE[state.options.mode] ?? '';
  };
  store.subscribe(update);
  update(store.getState());
}
