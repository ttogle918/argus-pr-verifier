import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, replay, START } from './helpers.js';
import { reduceRunEvent } from '../../frontend/js/run.js';
import { initialRun } from '../../frontend/js/state.js';
import {
  classifyTest, matrixModel, parseSandboxLog, sceneModel, verdictInfo, riskTone,
  fixPrompt, reportPayload, runCounts, phaseLabels, formatElapsed,
} from '../../frontend/js/derive.js';

const r = (r1, r2) => ({ run_1_passed: r1, run_2_passed: r2 });

test('classifyTest follows scoring.py', () => {
  assert.equal(classifyTest(r(true, true), 'phase2_full'), 'held');
  assert.equal(classifyTest(r(false, false), 'phase2_full'), 'breach');
  assert.equal(classifyTest(r(false, true), 'phase2_full'), 'flaky');
  assert.equal(classifyTest(r(false, true), 'phase1_mvp'), 'breach');
  assert.equal(classifyTest(r(true, false), 'phase1_mvp'), 'flaky');
});

test('matrixModel reproduces the recorded matrix', () => {
  const final = loadFixture('checkout-race-phase2').at(-1).final_response;
  const m = matrixModel(final, [], 'phase2_full');
  const cells = m.groups.flatMap((g) => g.rows.flatMap((row) => row.cells));
  assert.equal(m.columns.length, 8);
  assert.equal(cells.length, 80);
  assert.equal(cells.filter((c) => c.state === 'caught').length, 7);
  assert.equal(cells.filter((c) => c.state === 'invalid').length, 24);
  assert.equal(m.columns[7].verdict, 'survived');
  const rows = m.groups.flatMap((g) => g.rows);
  assert.equal(rows.find((x) => x.testId === 'test_edge_float_rounding_jitter').validity, 'flaky');
  assert.equal(rows.find((x) => x.testId === 'test_sec_negative_refund_wallet_inflation').validity, 'defect');
});

test('parseSandboxLog extracts time and tone', () => {
  const p = (s) => parseSandboxLog(`[antigravity-sandbox:2026-10-16T11:40:07Z] ${s}`, 'B');
  assert.deepEqual(p('  Running against M1 (hmac_bypass) -> test_x FAILED -> KILLED'),
    { ts: '11:40:07', track: 'B', text: '  Running against M1 (hmac_bypass) -> test_x FAILED -> KILLED', tone: 'ok' });
  assert.equal(p('  test_y ... FAILED (run 1/2)').tone, 'danger');
  assert.equal(p('  REPRO RETRY: t ... PASSED (run 2/2) [FLAKY FILTERED OUT]').tone, 'warn');
  assert.equal(p('  Running against M8 -> all 7 tests passed -> SURVIVED (UNCAUGHT)').tone, 'warn');
  assert.equal(p('TRACK (b): Spawning 8 shadow mutant containers M1..M8...').tone, null);
  assert.equal(parseSandboxLog('plain line', 'SYS').ts, '');
});

test('sceneModel walks idle → sealed → attacking → revealing → final', () => {
  const events = loadFixture('checkout-race-phase2');
  assert.equal(sceneModel(initialRun()).stage, 'idle');
  assert.equal(sceneModel(replay(events, START, { stopAfter: 'invariants_extracted' })).stage, 'sealed');
  assert.equal(sceneModel(replay(events, START, { stopAfter: 'sandbox_track_a' })).stage, 'attacking');
  const partial = replay(events, START, { stopAfter: 'sandbox_track_a' });
  const one = reduceRunEvent(partial, { stage: '_mutant_result', evaluation: events.find((e) => e.stage === 'sandbox_track_b').mutant_evaluations[0] });
  assert.equal(sceneModel(one).stage, 'revealing');
  const done = replay(events);
  const model = sceneModel(done);
  assert.equal(model.stage, 'final');
  assert.equal(model.mutants.filter((m) => m.status === 'caught').length, 7);
  assert.equal(model.summary, '7 of 8 hidden mutants caught. M8 survived.');
  assert.equal(sceneModel(replay(loadFixture('prompt-injection-blocked'))).stage, 'blocked');
  assert.equal(sceneModel({ ...done, status: 'error' }).dimmed, true);
});

test('labels, counts, prompt and report', () => {
  const done = replay(loadFixture('checkout-race-phase2'));
  assert.deepEqual(verdictInfo('REJECT_RECOMMENDED'), { label: 'Reject recommended', tone: 'danger', icon: 'breach' });
  assert.equal(riskTone('MODERATE'), 'warn');
  assert.deepEqual(runCounts(done), { breach: 2, flaky: 1, held: 7, pending: 0, total: 10, caught: 7, survived: 1, sealed: 0, testing: 0, mutantsTotal: 8 });
  assert.equal(phaseLabels('phase1_mvp').repro, '1 run');
  const prompt = fixPrompt(done.final);
  assert.ok(prompt.includes('test_sec_negative_refund_wallet_inflation'));
  assert.ok(prompt.includes('7 of 8 planted bugs caught'));
  const report = reportPayload(done.final, null, '2026-10-17T00:00:00Z');
  assert.equal(report.language, 'en');
  assert.equal(report.verification_run.run_id, done.final.run_id);
  assert.equal(formatElapsed('2026-10-17T00:00:00Z', Date.parse('2026-10-17T00:01:05Z')), '01:05');
});
