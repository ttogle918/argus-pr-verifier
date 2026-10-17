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
const ctx = { store, actions };
const byId = (id) => document.getElementById(id);

header.mount(byId('app-header'), ctx);
start.mount(byId('view-start'), ctx);
runView.mount(byId('view-run'), ctx);
verify.mount(byId('view-verify'), ctx);
decide.mount(byId('view-decide'), ctx);
importOverlay.mount(byId('overlay-import'), ctx);
diffOverlay.mount(byId('overlay-diff'), ctx);
runDetails.mount(byId('overlay-run-details'), ctx);
mutantOverlay.mount(byId('overlay-mutant'), ctx);
exportOverlay.mount(byId('overlay-export'), ctx);

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
