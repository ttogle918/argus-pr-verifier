import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../frontend/js/store.js';

test('setState merges objects, applies functions, notifies, unsubscribes', () => {
  const store = createStore({ a: 1, b: 1 });
  const seen = [];
  const off = store.subscribe((s) => seen.push(s.a));
  store.setState({ a: 2 });
  store.setState((s) => ({ ...s, a: s.a + 1 }));
  off();
  store.setState({ a: 9 });
  assert.deepEqual(seen, [2, 3]);
  assert.deepEqual(store.getState(), { a: 9, b: 1 });
});

test('returning the same state does not notify', () => {
  const store = createStore({ a: 1 });
  let calls = 0;
  store.subscribe(() => calls++);
  store.setState((s) => s);
  assert.equal(calls, 0);
});
