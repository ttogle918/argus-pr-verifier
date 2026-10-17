import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './helpers.js';
import { createStore } from '../../frontend/js/store.js';
import { initialState } from '../../frontend/js/state.js';
import { createController } from '../../frontend/js/controller.js';

const PHASE2 = loadFixture('checkout-race-phase2');
const FINAL = PHASE2.at(-1).final_response;

function setup(overrides = {}) {
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
    store, api, sleep: async () => {}, now: () => '2026-10-17T00:00:00Z',
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
