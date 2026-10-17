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

export function initRouter(store, actions) {
  const fromHash = () => {
    const target = viewFromHash(location.hash, store.getState());
    if (target === null) return;
    if (store.getState().view !== target) actions.navigate(target);
    if (`#/${target}` !== location.hash) history.replaceState(null, '', `#/${target}`);
  };
  window.addEventListener('hashchange', fromHash);
  store.subscribe((s) => {
    if (location.hash !== `#/${s.view}`) history.pushState(null, '', `#/${s.view}`);
  });
  fromHash();
}
