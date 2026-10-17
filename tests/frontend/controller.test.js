import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './helpers.js';
import { createStore } from '../../frontend/js/store.js';
import { initialState } from '../../frontend/js/state.js';
import { createController } from '../../frontend/js/controller.js';

const PHASE2 = loadFixture('checkout-race-phase2');
const FINAL = PHASE2.at(-1).final_response;

function setup(overrides = {}, { now = () => '2026-10-17T00:00:00Z' } = {}) {
  const calls = [];
  const api = {
    listPrs: async () => [{ id: 'pr-checkout-race', title: 'PR #412', repo_name: 'acme-pay/ledger-core', author: 'devin-bot[ai]' }],
    async streamVerify(body, onEvent, signal) {
      calls.push(['stream', body]);
      for (const evt of PHASE2) {
        if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        await onEvent(evt);
      }
    },
    recordDecision: async (body) => { calls.push(['decision', body]); return { status: 'RECORDED' }; },
    applyPatch: async () => ({ ...structuredClone(FINAL), pr_title: '[PATCHED] PR #412', self_healing_patch: { attempt_history: [], max_patch_attempts: 5 } }),
    addMutant: async (body) => {
      calls.push(['mutant', body]);
      const f = structuredClone(FINAL);
      f.deterministic_score.mutant_evaluations.push({ ...f.deterministic_score.mutant_evaluations[7], mutant_id: 'M9', caught: false });
      return f;
    },
    ...overrides,
  };
  const store = createStore(initialState());
  const downloads = [];
  const actions = createController({
    store, api, sleep: async () => {}, now,
    clipboard: { writeText: async () => {} }, download: (name, text) => downloads.push([name, text]),
  });
  return { store, actions, calls, downloads };
}

test('run streams the selected PR with the chosen options and completes', async () => {
  const { store, actions, calls } = setup();
  await actions.loadPrs();
  actions.setOptions({ phase: 'phase2_full', mode: 'replay', scope: 'auto' });
  await actions.run();
  assert.deepEqual(calls[0][1], { pr_id: 'pr-checkout-race', phase_mode: 'phase2_full', execution_mode: 'replay', scope_override: 'auto' });
  const s = store.getState();
  assert.equal(s.view, 'run');
  assert.equal(s.run.status, 'complete');
  assert.equal(s.run.prTitle, 'PR #412');
});

test('stop aborts into an error state', async () => {
  const { store, actions } = setup({
    async streamVerify(body, onEvent, signal) {
      await onEvent(PHASE2[0]);
      actions.stop();
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
  });
  await actions.run();
  assert.equal(store.getState().run.status, 'error');
  assert.equal(store.getState().run.error.message, 'Stopped by you.');
});

test('a stream that ends early becomes an error', async () => {
  const { store, actions } = setup({ async streamVerify(b, onEvent) { await onEvent(PHASE2[0]); } });
  await actions.run();
  assert.equal(store.getState().run.error.message, 'The stream ended before the run finished.');
});

test('decide posts the decision with a default note', async () => {
  const { store, actions, calls } = setup();
  await actions.run();
  await actions.decide('REJECT_MERGE', '');
  const body = calls.find(([k]) => k === 'decision')[1];
  assert.equal(body.decision, 'REJECT_MERGE');
  assert.equal(body.run_id, FINAL.run_id);
  assert.ok(body.reviewer_notes.length > 0);
  assert.equal(store.getState().decision.status, 'saved');
});

test('applyPatch records the before snapshot and swaps the final', async () => {
  const { store, actions } = setup();
  await actions.run();
  await actions.applyPatch();
  const s = store.getState();
  assert.deepEqual(s.patch.before, { caught: 7, total: 8, defects: 2, verdict: 'REJECT_RECOMMENDED', risk: 'HIGH' });
  assert.equal(s.patch.status, 'done');
  assert.equal(s.run.prTitle, '[PATCHED] PR #412');
});

test('addMutant sends the form, marks calibration, selects it on Verify', async () => {
  const { store, actions, calls } = setup();
  await actions.run();
  await actions.addMutant({ title: 'Neg fee', category: 'security', description: 'd', caught: false });
  assert.deepEqual(calls.find(([k]) => k === 'mutant')[1], { pr_id: FINAL.pr_id, category: 'security', title: 'Neg fee', bug_description: 'd', caught: false });
  const s = store.getState();
  assert.deepEqual(s.run.calibrationIds, ['M9']);
  assert.equal(s.ui.selectedMutant, 'M9');
  assert.equal(s.view, 'verify');
  assert.equal(s.overlay, null);
});

test('downloadReport writes the JSON report', async () => {
  const { actions, downloads } = setup();
  await actions.run();
  actions.downloadReport();
  assert.equal(downloads[0][0], `argus-pr-report-${FINAL.pr_id}.json`);
  assert.equal(JSON.parse(downloads[0][1]).language, 'en');
});

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const ticking = () => { let n = 0; return () => `2026-10-17T00:00:${String(n++).padStart(2, '0')}Z`; };

test('addMutant after applyPatch resets decision, patch and bundle, and adopts the new run id', async () => {
  const { store, actions } = setup({
    addMutant: async () => {
      const f = structuredClone(FINAL);
      f.run_id = 'run_calibrated';
      f.deterministic_score.mutant_evaluations.push({ ...f.deterministic_score.mutant_evaluations[7], mutant_id: 'M9', caught: false });
      return f;
    },
    exportBundle: async () => ({ ok: true }),
  });
  await actions.run();
  await actions.applyPatch();
  await actions.exportBundle();
  await actions.decide('APPROVE_MERGE', 'ok');
  await actions.addMutant({ title: 'Neg fee', category: 'security', description: 'd', caught: false });
  const s = store.getState();
  assert.equal(s.patch.status, 'idle');
  assert.equal(s.patch.before, null);
  assert.equal(s.bundle.status, 'idle');
  assert.equal(s.decision, null);
  assert.equal(s.run.runId, 'run_calibrated');
});

test('importing while a run is in progress is refused without registering the PR', async () => {
  const gate = deferred();
  let imported = 0;
  const { store, actions } = setup({
    async streamVerify(body, onEvent) { await onEvent(PHASE2[0]); await gate.promise; },
    importCustom: async () => { imported += 1; return { pr: { pr_id: 'pr-custom', title: 'Custom' } }; },
  });
  await actions.loadPrs();
  const running = actions.run();
  assert.equal(store.getState().run.status, 'running');
  await actions.importCustom({ title: 'Custom', repo_name: 'a/b', diff: 'x' });
  const s = store.getState();
  assert.deepEqual(s.importState, { status: 'error', message: 'A run is in progress. Stop it or wait for it to finish.' });
  assert.equal(imported, 0);
  assert.ok(!s.prs.some((p) => p.id === 'pr-custom'));
  gate.resolve();
  await running;
});

test('retry re-runs the failed run with its own PR, phase and mode', async () => {
  let fail = true;
  const { store, actions, calls } = setup({
    async streamVerify(body, onEvent) {
      calls.push(['stream', body]);
      if (fail) throw new Error('Failed to fetch');
      for (const evt of PHASE2) await onEvent(evt);
    },
  });
  await actions.loadPrs();
  actions.setOptions({ phase: 'phase1_mvp', mode: 'live_api', scope: 'auto' });
  await actions.run();
  assert.equal(store.getState().run.status, 'error');
  actions.selectPr('pr-other');
  actions.setOptions({ phase: 'phase2_full', mode: 'replay' });
  fail = false;
  await actions.retry();
  assert.deepEqual(calls.at(-1)[1], { pr_id: 'pr-checkout-race', phase_mode: 'phase1_mvp', execution_mode: 'live_api', scope_override: 'auto' });
  const s = store.getState();
  assert.equal(s.selectedPrId, 'pr-checkout-race');
  assert.deepEqual(s.options, { phase: 'phase1_mvp', mode: 'live_api', scope: 'auto' });
});

test('a patch response that arrives after a new run started is ignored', async () => {
  const gate = deferred();
  const { store, actions } = setup({
    applyPatch: async () => { await gate.promise; return { ...structuredClone(FINAL), pr_title: '[PATCHED] PR #412', self_healing_patch: { attempt_history: [] } }; },
  }, { now: ticking() });
  await actions.loadPrs();
  await actions.run();
  const patching = actions.applyPatch();
  await actions.run();
  const startedAt = store.getState().run.startedAt;
  gate.resolve();
  await patching;
  const s = store.getState();
  assert.equal(s.run.startedAt, startedAt);
  assert.equal(s.run.prTitle, 'PR #412');
  assert.equal(s.patch.status, 'idle');
});
