import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './helpers.js';
import { expandEvent, interleave } from '../../frontend/js/playback.js';

test('interleave alternates and keeps leftovers', () => {
  assert.deepEqual(interleave([1, 2, 3], ['a']), [1, 'a', 2, 3]);
});

test('track A expands to logs + test results, stashes track B logs', () => {
  const events = loadFixture('checkout-race-phase2');
  const a = events.find((e) => e.stage === 'sandbox_track_a');
  const ctx = {};
  const out = expandEvent(a, { mode: 'replay', ctx });
  const stages = out.map(([, e]) => e.stage);
  assert.equal(stages.filter((s) => s === '_test_result').length, 10);
  assert.equal(stages.at(-1), 'sandbox_track_a');
  assert.ok(out.filter(([, e]) => e.stage === '_log').every(([, e]) => e.entry.track !== 'B'));
  assert.equal(out.find(([, e]) => e.stage === '_log')[1].entry.track, 'SYS');
  assert.ok(ctx.trackBLogs.length > 0 && ctx.trackBLogs.every((l) => !l.includes('TRACK (a)')));
  assert.ok(ctx.trackBLogs[0].includes('Running against M1'));
  assert.ok(out.filter(([, e]) => e.stage === '_test_result').every(([d]) => d === 75));
});

test('track B uses stashed logs and emits one result per mutant', () => {
  const events = loadFixture('checkout-race-phase2');
  const ctx = {};
  expandEvent(events.find((e) => e.stage === 'sandbox_track_a'), { mode: 'replay', ctx });
  const out = expandEvent(events.find((e) => e.stage === 'sandbox_track_b'), { mode: 'replay', ctx });
  assert.equal(out.filter(([, e]) => e.stage === '_mutant_result').length, 8);
  const logs = out.filter(([, e]) => e.stage === '_log').map(([, e]) => e.entry);
  assert.ok(logs.every((l) => l.track === 'B'));
  assert.ok(logs.some((l) => l.text.includes('Running against M8')));
});

test('other events pass through without delay', () => {
  assert.deepEqual(expandEvent({ stage: 'done' }, { mode: 'replay', ctx: {} }), [[0, { stage: 'done' }]]);
});
