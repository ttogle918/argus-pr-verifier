const VIEWS = ['start', 'run', 'verify', 'decide'];

// verify/decide need a finished (non-blocked) run; run needs any run.
export function allowedView(view, state) {
  if (view === 'start') return true;
  if (view === 'run') return state.run.status !== 'idle';
  return state.run.status === 'complete' && !!state.run.final;
}

export function initRouter(store, actions) {
  const fromHash = () => {
    const view = location.hash.replace(/^#\/?/, '') || 'start';
    const target = VIEWS.includes(view) && allowedView(view, store.getState()) ? view : 'start';
    if (store.getState().view !== target) actions.navigate(target);
    if (`#/${target}` !== location.hash) history.replaceState(null, '', `#/${target}`);
  };
  window.addEventListener('hashchange', fromHash);
  store.subscribe((s) => {
    if (location.hash !== `#/${s.view}`) history.pushState(null, '', `#/${s.view}`);
  });
  fromHash();
}
