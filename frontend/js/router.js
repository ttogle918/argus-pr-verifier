const VIEWS = ['start', 'run', 'verify', 'decide'];

// verify/decide need a finished (non-blocked) run; run needs any run.
export function allowedView(view, state) {
  if (view === 'start') return true;
  if (view === 'run') return state.run.status !== 'idle';
  return state.run.status === 'complete' && !!state.run.final;
}

// Target view for a location hash, or null when the hash is not a route (e.g. the skip link's #main).
export function viewFromHash(hash, state) {
  if (!/^#\//.test(hash)) return null;
  const view = hash.slice(2) || 'start';
  return VIEWS.includes(view) && allowedView(view, state) ? view : 'start';
}

// How the store subscriber syncs the URL: replace a non-route hash (empty, or the skip link's #main),
// push only when the view itself changed, otherwise leave the URL alone (a pending hashchange may own it).
export function historyAction(hash, view, lastView) {
  if (hash === `#/${view}`) return null;
  if (!/^#\//.test(hash)) return 'replace';
  return view !== lastView ? 'push' : null;
}

export function initRouter(store, actions) {
  let lastView = store.getState().view;
  const fromHash = () => {
    const target = viewFromHash(location.hash, store.getState());
    if (target === null) return;
    // Fix the URL first so the subscriber sees a matching hash and does not push during back/forward.
    if (`#/${target}` !== location.hash) history.replaceState(null, '', `#/${target}`);
    if (store.getState().view !== target) actions.navigate(target);
  };
  window.addEventListener('hashchange', fromHash);
  store.subscribe((s) => {
    const action = historyAction(location.hash, s.view, lastView);
    lastView = s.view;
    if (action === 'push') history.pushState(null, '', `#/${s.view}`);
    else if (action === 'replace') history.replaceState(null, '', `#/${s.view}`);
  });
  fromHash();
}
