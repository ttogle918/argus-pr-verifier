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

test('replay: mutant and scoring lines move from track A to track B in order', () => {
  const events = loadFixture('checkout-race-phase2');
  const ctx = {};
  const logsOf = (out) => out.filter(([, e]) => e.stage === '_log').map(([, e]) => e.entry.text);
  const a = logsOf(expandEvent(events.find((e) => e.stage === 'sandbox_track_a'), { mode: 'replay', ctx }));
  const b = logsOf(expandEvent(events.find((e) => e.stage === 'sandbox_track_b'), { mode: 'replay', ctx }));
  assert.ok(a.every((t) => !/Running against|Deterministic Scoring/.test(t)));
  assert.equal(b.length, 10);
  assert.ok(b[0].includes('TRACK (b)'));
  for (let i = 1; i <= 8; i++) assert.ok(b[i].includes(`Running against M${i}`), b[i]);
  assert.ok(b[9].includes('Deterministic Scoring'));
});

test('live wording: track A holds no mutant lines, track B gets header, mutants, scoring once', () => {
  const pass = ['  [PASS 2/2] t1 (security) -> Eligible for Track (b) Mutant Kill', '  [PASS 2/2] t2 (race) -> Eligible for Track (b) Mutant Kill'];
  const mutants = ['  [MUTANT M1] -> CAUGHT by t1', '  [MUTANT M2] -> SURVIVED (UNCAUGHT)'];
  const head = '=== TRACK (b): EXECUTING SWARM TESTS AGAINST 2 BLIND MUTANTS (M1..M2) ===';
  const scoring = 'Deterministic Scoring: 1/2 caught';
  const aLines = ['booting sandbox', '=== TRACK (a): ADAPTIVE MULTI-TURN RED-TEAM LOOP ===', '    -> Attempt 2/5 [BREACHED]: x',
    ...pass, '  [FAIL 2/2 REPRODUCED · BREACHED ON ATTEMPT 3/5] t3 (security) -> AssertionError',
    '  [FLAKY 1/2 FILTERED] t4 (race) -> Ignored', ...mutants, scoring];
  const bLines = [head, ...mutants, ...pass, scoring];
  const ctx = {};
  const logsOf = (out) => out.filter(([, e]) => e.stage === '_log').map(([, e]) => e.entry);
  const a = logsOf(expandEvent({ stage: 'sandbox_track_a', terminal_logs: aLines }, { mode: 'live', ctx }));
  const b = logsOf(expandEvent({ stage: 'sandbox_track_b', terminal_logs: bLines }, { mode: 'live', ctx }));
  assert.ok(a.every((e) => !/\[MUTANT|Scoring/.test(e.text)));
  assert.equal(a[0].track, 'SYS');
  assert.equal(a[1].track, 'A');
  assert.deepEqual(b.map((e) => e.text), [head, ...mutants, scoring]);
});
