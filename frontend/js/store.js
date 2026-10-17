export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    setState(update) {
      const next = typeof update === 'function' ? update(state) : { ...state, ...update };
      if (next === state) return;
      state = next;
      listeners.forEach((fn) => fn(state));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
