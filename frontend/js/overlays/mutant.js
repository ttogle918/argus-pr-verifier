import { html, setHtml } from '../dom.js';
import { icon } from '../icons.js';
import { createOverlay } from '../overlay-shell.js';
import { matrixModel } from '../derive.js';

const DEFAULT_DESC = 'Custom synthetic mutation planted by human reviewer to test swarm blind spots.';

// Pure: the score after planting one more mutant with the chosen outcome.
export function previewScore(caught, total, willCatch) {
  const c = caught + (willCatch ? 1 : 0);
  const t = total + 1;
  return { c, t, pct: Math.round((c / t) * 1000) / 10, before: `${caught}/${total}` };
}

export function mount(root, ctx) {
  const { store, actions } = ctx;
  const { body, onOpen } = createOverlay(root, { name: 'mutant', title: 'Plant a calibration mutant', variant: 'modal', ctx });
  setHtml(body, html`
    <p class="mform__lede">Add a bug of your own and see how the score moves. You choose whether a valid test catches it; no new tests run. It is tagged <strong>Calibration</strong> everywhere it appears so it is never mistaken for a swarm result.</p>
    <form class="mform" novalidate>
      <div class="field"><label class="field__label" for="m-title">Bug title</label>
        <input id="m-title" class="input" type="text" required autocomplete="off" placeholder="Negative fee bypass on partial refunds" data-testid="mutant-title">
        <p class="field__error" id="m-title-err" data-testid="mutant-title-error" hidden>${icon('alert', { size: 14 })}<span>Enter a bug title.</span></p></div>
      <div class="field"><label class="field__label" for="m-cat">Category</label>
        <select id="m-cat" class="select" data-testid="mutant-category">
          <option value="security">Security</option><option value="edge_cases">Edge case</option>
          <option value="state">State / concurrency</option><option value="regression">Regression</option></select></div>
      <div class="field"><label class="field__label" for="m-desc">Description <span class="mform__opt">(optional)</span></label>
        <textarea id="m-desc" class="textarea" rows="3"></textarea></div>
      <fieldset class="mform__outcome"><legend class="field__label">Assumed outcome</legend>
        <div class="mform__pills">
          <label class="choice" data-testid="mutant-outcome" data-value="caught"><input type="radio" name="m-outcome" value="caught">Caught by a valid test</label>
          <label class="choice" data-testid="mutant-outcome" data-value="survived"><input type="radio" name="m-outcome" value="survived" checked>Survived every test</label>
        </div></fieldset>
      <div class="mform__preview panel" data-testid="mutant-preview" aria-live="polite"></div>
      <div class="status-box status-box--danger" role="alert" hidden></div>
      <div class="mform__actions">
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary" data-testid="mutant-submit"></button>
      </div>
    </form>`);
  const form = body.querySelector('form');
  const titleEl = body.querySelector('#m-title');
  const titleErr = body.querySelector('#m-title-err');
  const clearTitleError = () => { titleEl.removeAttribute('aria-invalid'); titleEl.removeAttribute('aria-describedby'); titleErr.hidden = true; };
  const catEl = body.querySelector('#m-cat');
  const descEl = body.querySelector('#m-desc');
  const previewEl = body.querySelector('[data-testid="mutant-preview"]');
  const errEl = body.querySelector('.status-box');
  const submit = body.querySelector('[data-testid="mutant-submit"]');
  const outcome = () => form.querySelector('input[name="m-outcome"]:checked')?.value ?? 'survived';

  const counts = (state) => {
    const f = state.run.final;
    if (!f) return { caught: 0, total: 0 };
    const cols = matrixModel(f, state.run.calibrationIds, state.run.phase).columns;
    return { caught: cols.filter((c) => c.verdict === 'caught').length, total: cols.length };
  };

  const render = (state) => {
    const { caught, total } = counts(state);
    const p = previewScore(caught, total, outcome() === 'caught');
    const saving = state.mutantForm.status === 'saving';
    setHtml(previewEl, html`
      <span class="label-caps">After recalculation</span>
      <p class="mform__score mono">Score after adding: <strong>${p.c}/${p.t}</strong> (${p.pct}%) · was ${p.before}</p>
      <p class="mform__note">${icon('info', { size: 14 })}Planted as M${total + 1}. The matrix gains a dashed Calibration column.</p>`);
    submit.disabled = saving;
    submit.textContent = saving ? 'Recalculating…' : `Add M${total + 1} and recalculate`;
    const err = state.mutantForm.status === 'error' ? state.mutantForm.error : null;
    errEl.hidden = !err;
    errEl.textContent = err ? String(err) : '';
  };

  onOpen((state) => {
    form.reset();
    titleEl.value = '';
    descEl.value = DEFAULT_DESC;
    clearTitleError();
    render(state);
  });
  form.addEventListener('input', () => { clearTitleError(); render(store.getState()); });
  form.addEventListener('change', () => render(store.getState()));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (store.getState().mutantForm.status === 'saving') return;
    const title = titleEl.value.trim();
    if (!title) {
      titleEl.setAttribute('aria-invalid', 'true'); titleEl.setAttribute('aria-describedby', 'm-title-err');
      titleErr.hidden = false; titleEl.focus(); return;
    }
    actions.addMutant({ title, category: catEl.value, description: descEl.value.trim() || DEFAULT_DESC, caught: outcome() === 'caught' });
  });
  store.subscribe(render);
  render(store.getState());
}
