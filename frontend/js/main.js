import { createStore } from './store.js';
import { initialState } from './state.js';
import { api } from './api.js';
import { createController } from './controller.js';
import { initRouter } from './router.js';
import * as header from './views/header.js';
import * as start from './views/start.js';
import * as runView from './views/run.js';
import * as verify from './views/verify.js';
import * as decide from './views/decide.js';
import * as importOverlay from './overlays/import.js';
import * as diffOverlay from './overlays/diff.js';
import * as runDetails from './overlays/run-details.js';
import * as mutantOverlay from './overlays/mutant.js';
import * as exportOverlay from './overlays/export.js';
import { t, getLang, onLangChange } from './i18n.js';

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.appendChild(a); // Firefox ignores clicks on detached anchors
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const store = createStore(initialState());
const actions = createController({ store, api, download: downloadText });
const byId = (id) => document.getElementById(id);

const MOUNTS = [
  ['app-header', header], ['view-start', start], ['view-run', runView], ['view-verify', verify], ['view-decide', decide],
  ['overlay-import', importOverlay], ['overlay-diff', diffOverlay], ['overlay-run-details', runDetails],
  ['overlay-mutant', mutantOverlay], ['overlay-export', exportOverlay],
];
const SECTION_LABEL = { start: 'Start', run: 'Run', verify: 'Verify', decide: 'Decide' };

// Copy that lives in index.html rather than in a module.
function applyStaticCopy() {
  document.documentElement.lang = getLang();
  document.querySelector('.skip-link').textContent = t('Skip to content');
  for (const [v, label] of Object.entries(SECTION_LABEL)) byId(`view-${v}`).setAttribute('aria-label', t(label));
}

// Views render most copy once at mount, so a language change mounts every view again on fresh roots
// (dropping the old listeners) with a store whose subscriptions can be released.
let releaseViews = () => {};
function mountViews() {
  const subs = [];
  const scopedStore = { ...store, subscribe: (fn) => { const off = store.subscribe(fn); subs.push(off); return off; } };
  const ctx = { store: scopedStore, actions };
  for (const [id, view] of MOUNTS) {
    const old = byId(id);
    const fresh = old.cloneNode(false);
    old.replaceWith(fresh);
    view.mount(fresh, ctx);
  }
  releaseViews = () => subs.forEach((off) => off());
}

applyStaticCopy();
mountViews();
onLangChange((lang) => {
  if (store.getState().overlay) actions.closeOverlay();
  releaseViews();
  mountViews();
  applyStaticCopy();
  document.querySelector(`[data-lang="${lang}"]`)?.focus();
});

let lastView = null;
store.subscribe((s) => {
  if (s.view === lastView) return;
  const firstLoad = lastView === null;
  lastView = s.view;
  for (const v of ['start', 'run', 'verify', 'decide']) byId(`view-${v}`).hidden = s.view !== v;
  window.scrollTo(0, 0);
  if (!firstLoad) byId(`view-${s.view}`).focus({ preventScroll: true });
});
for (const v of ['start', 'run', 'verify', 'decide']) byId(`view-${v}`).tabIndex = -1;
byId('view-start').hidden = false;

initRouter(store, actions);
actions.loadPrs();
window.__argus = { store, actions }; // debugging + E2E hook
