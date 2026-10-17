import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, replay, START } from './helpers.js';
import { reduceRunEvent } from '../../frontend/js/run.js';

const count = (run, outcome) => Object.values(run.tests).filter((t) => t.outcome === outcome).length;

test('phase 2 replay completes with the recorded outcomes', () => {
  const run = replay(loadFixture('checkout-race-phase2'));
  assert.equal(run.status, 'complete');
  assert.equal(run.effectiveMode, 'replay');
  assert.ok(run.runId.startsWith('run_'));
  assert.deepEqual(run.attackers, ['security', 'edge_cases', 'state', 'regression']);
  assert.equal(run.testOrder.length, 10);
  assert.deepEqual([count(run, 'breach'), count(run, 'flaky'), count(run, 'held')], [2, 1, 7]);
  assert.deepEqual(run.mutants.map((m) => m.status), ['caught', 'caught', 'caught', 'caught', 'caught', 'caught', 'caught', 'survived']);
  assert.deepEqual(run.tests.test_sec_webhook_hmac_verification.kills, ['M1']);
  assert.equal(run.score.planted_bugs_caught, 7);
  assert.ok(Object.values(run.stages).every((s) => s === 'done'));
  assert.ok(run.logs.some((l) => l.track === 'SYS'));
  assert.ok(run.logs.some((l) => l.track === 'A' && l.tone === 'danger'));
  assert.ok(run.logs.some((l) => l.track === 'B' && l.tone === 'ok'));
  assert.equal(run.lastBeam.tone, 'ok');
});

test('phase 1 counts a first-run failure as a breach', () => {
  const run = replay(loadFixture('checkout-race-phase1'), { ...START, phase: 'phase1_mvp' });
  assert.equal(run.attackers.length, 3);
  assert.equal(count(run, 'breach'), 3);
});

test('guardrail block ends the run as blocked', () => {
  const run = replay(loadFixture('prompt-injection-blocked'), { ...START, prId: 'pr-prompt-injection-attack' });
  assert.equal(run.status, 'blocked');
  assert.equal(run.stages.guardrail, 'blocked');
  assert.equal(run.guardrail.detected_threats.length, 3);
  assert.equal(run.testOrder.length, 0);
  assert.ok(run.final);
});

test('mid-run error marks the active stage', () => {
  const partial = replay(loadFixture('checkout-race-phase2'), START, { stopAfter: 'sandbox_start' });
  const run = reduceRunEvent(partial, { stage: '_error', message: 'boom' });
  assert.equal(run.status, 'error');
  assert.deepEqual(run.error, { message: 'boom', stage: 'sandbox_a' });
  assert.equal(run.stages.sandbox_a, 'error');
});

test('_replace_final rebuilds mutants and tracks calibration ids', () => {
  const events = loadFixture('checkout-race-phase2');
  const final = structuredClone(events.at(-1).final_response);
  final.deterministic_score.mutant_evaluations.push({
    ...final.deterministic_score.mutant_evaluations[7], mutant_id: 'M9', title: 'Custom', caught: false,
  });
  const run = reduceRunEvent(replay(events), { stage: '_replace_final', final, calibrationId: 'M9' });
  assert.equal(run.mutants.length, 9);
  assert.deepEqual(run.calibrationIds, ['M9']);
  assert.equal(run.status, 'complete');
});

test('_replace_final adopts the response run id, phase and attackers', () => {
  const events = loadFixture('checkout-race-phase2');
  const final = structuredClone(events.at(-1).final_response);
  final.run_id = 'run_new';
  final.phase_mode = 'phase1_mvp';
  final.swarm_outputs = final.swarm_outputs.filter((s) => s.attacker_id !== 'regression');
  const run = reduceRunEvent(replay(events), { stage: '_replace_final', final });
  assert.equal(run.runId, 'run_new');
  assert.equal(run.phase, 'phase1_mvp');
  assert.deepEqual(run.attackers, ['security', 'edge_cases', 'state']);
});

test('_replace_final keeps the attacker list when the response has no swarm outputs', () => {
  const events = loadFixture('checkout-race-phase2');
  const before = replay(events);
  const final = { ...structuredClone(events.at(-1).final_response), swarm_outputs: [] };
  const run = reduceRunEvent(before, { stage: '_replace_final', final });
  assert.deepEqual(run.attackers, before.attackers);
});
