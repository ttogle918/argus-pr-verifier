import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedView, viewFromHash } from '../../frontend/js/router.js';

const idle = { run: { status: 'idle', final: null } };
const running = { run: { status: 'running', final: null } };
const done = { run: { status: 'complete', final: {} } };

test('allowedView gates views on run state', () => {
  assert.equal(allowedView('start', idle), true);
  assert.equal(allowedView('run', idle), false);
  assert.equal(allowedView('run', running), true);
  assert.equal(allowedView('verify', running), false);
  assert.equal(allowedView('verify', done), true);
  assert.equal(allowedView('decide', { run: { status: 'complete', final: null } }), false);
});

test('viewFromHash returns null for non-route hashes', () => {
  assert.equal(viewFromHash('#main', idle), null);
  assert.equal(viewFromHash('', idle), null);
  assert.equal(viewFromHash('#', idle), null);
  assert.equal(viewFromHash('#/', idle), 'start');
});

test('viewFromHash resolves routes and falls back to start', () => {
  assert.equal(viewFromHash('#/run', running), 'run');
  assert.equal(viewFromHash('#/run', idle), 'start');
  assert.equal(viewFromHash('#/verify', done), 'verify');
  assert.equal(viewFromHash('#/bogus', done), 'start');
});
