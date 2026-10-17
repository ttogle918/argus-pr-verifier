import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSelection } from '../../frontend/js/views/verify.js';
import { previewScore } from '../../frontend/js/overlays/mutant.js';

test('effectiveSelection prefers explicit, then first survivor, then first', () => {
  const cols = [{ id: 'M1', verdict: 'caught' }, { id: 'M2', verdict: 'survived' }];
  assert.equal(effectiveSelection(cols, 'M1'), 'M1');
  assert.equal(effectiveSelection(cols, null), 'M2');
  assert.equal(effectiveSelection(cols, 'M9'), 'M2');
  assert.equal(effectiveSelection([{ id: 'M1', verdict: 'caught' }], null), 'M1');
});

test('previewScore adds one mutant', () => {
  assert.deepEqual(previewScore(7, 8, false), { c: 7, t: 9, pct: 77.8, before: '7/8' });
  assert.equal(previewScore(7, 8, true).pct, 88.9);
});
