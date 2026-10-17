import { expandEvent } from './playback.js';
import { reduceRunEvent } from './run.js';
import { fixPrompt, reportPayload } from './derive.js';
import { initialState } from './state.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createController({ store, api, sleep = defaultSleep, now = () => new Date().toISOString(), clipboard = globalThis.navigator?.clipboard, download }) {
  let abort = null;
  const fresh = initialState();
  const get = () => store.getState();
  const patchState = (key, value) => store.setState((s) => ({ ...s, [key]: { ...s[key], ...value } }));
  const dispatchRun = (evt) => store.setState((s) => ({ ...s, run: reduceRunEvent(s.run, evt) }));

  function registerPr(pr) {
    const id = pr.pr_id || pr.id;
    const item = { ...pr, id };
    store.setState((s) => ({ ...s, prs: [item, ...s.prs.filter((p) => p.id !== id)], selectedPrId: id }));
  }

  async function importAndRun(request) {
    store.setState((s) => ({ ...s, importState: { status: 'loading', message: '' } }));
    try {
      const data = await request();
      registerPr(data.pr);
      store.setState((s) => ({ ...s, importState: { status: 'done', message: data.pr.title } }));
      await actions.run();
    } catch (err) {
      store.setState((s) => ({ ...s, importState: { status: 'error', message: err.message } }));
    }
  }

  const actions = {
    async loadPrs() {
      try {
        const prs = (await api.listPrs()).map((p) => ({ ...p, id: p.pr_id || p.id }));
        store.setState((s) => ({ ...s, prs, prsStatus: 'ready' }));
      } catch {
        store.setState((s) => ({ ...s, prsStatus: 'error' }));
      }
    },
    selectPr: (id) => store.setState({ selectedPrId: id }),
    setOptions: (partial) => patchState('options', partial),
    navigate: (view) => store.setState({ view }),
    openOverlay: (name) => store.setState({ overlay: { name } }),
    closeOverlay: () => store.setState({ overlay: null }),
    setLogFilter: (logFilter) => patchState('ui', { logFilter }),
    selectMutant: (selectedMutant) => patchState('ui', { selectedMutant }),

    async run() {
      if (get().run.status === 'running') return;
      const s = get();
      const pr = s.prs.find((p) => p.id === s.selectedPrId);
      const controller = new AbortController();
      abort = controller;
      const ctx = {};
      store.setState((st) => ({
        ...st, view: 'run', overlay: null, decision: null,
        patch: fresh.patch, dast: fresh.dast, bundle: fresh.bundle, mutantForm: fresh.mutantForm,
        ui: { ...st.ui, selectedMutant: null, logFilter: 'all' },
      }));
      dispatchRun({
        stage: '_start', prId: s.selectedPrId, prTitle: pr?.title ?? s.selectedPrId, repoName: pr?.repo_name ?? '',
        author: pr?.author ?? '', phase: s.options.phase, requestedMode: s.options.mode, startedAt: now(),
      });
      try {
        await api.streamVerify(
          { pr_id: s.selectedPrId, phase_mode: s.options.phase, execution_mode: s.options.mode, scope_override: s.options.scope },
          async (evt) => {
            const mode = get().run.effectiveMode ?? evt.execution_mode ?? s.options.mode;
            for (const [delay, e] of expandEvent(evt, { mode, ctx })) {
              if (delay) await sleep(delay);
              if (controller.signal.aborted) return;
              dispatchRun(e.stage === 'done' ? { ...e, receivedAt: now() } : e);
            }
          },
          controller.signal,
        );
        if (controller.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (get().run.status === 'running') dispatchRun({ stage: '_error', message: 'The stream ended before the run finished.' });
      } catch (err) {
        if (get().run.status === 'running') dispatchRun({ stage: '_error', message: err.name === 'AbortError' ? 'Stopped by you.' : err.message });
      } finally {
        if (abort === controller) abort = null;
      }
    },
    stop() { abort?.abort(); },
    retry() { return actions.run(); },

    async decide(decision, note) {
      const { final } = get().run;
      if (!final) return;
      const reviewerNotes = note?.trim() || (decision === 'REJECT_MERGE'
        ? 'Rejected: reproduced breaking tests and surviving mutant blind spots.'
        : 'Approved by human reviewer.');
      store.setState({ decision: { decision, note: reviewerNotes, at: now(), status: 'saving' } });
      try {
        await api.recordDecision({ run_id: final.run_id, pr_id: final.pr_id, decision, reviewer_notes: reviewerNotes });
        patchState('decision', { status: 'saved' });
      } catch (err) {
        patchState('decision', { status: 'error', error: err.message });
      }
    },
    clearDecision: () => store.setState({ decision: null }),

    async applyPatch() {
      const { run } = get();
      if (!run.final || get().patch.status === 'running') return;
      const before = {
        caught: run.score.planted_bugs_caught, total: run.score.planted_bugs_total,
        defects: run.score.confirmed_pr_failures_count, verdict: run.oneCard.headline_verdict, risk: run.oneCard.residual_risk_level,
      };
      store.setState((s) => ({ ...s, patch: { status: 'running', report: null, before, error: null } }));
      try {
        const final = await api.applyPatch(run.final.pr_id, run.phase);
        dispatchRun({ stage: '_replace_final', final });
        store.setState((s) => ({ ...s, decision: null, patch: { status: 'done', report: final.self_healing_patch ?? null, before, error: null } }));
      } catch (err) {
        patchState('patch', { status: 'error', error: err.message });
      }
    },

    async exportBundle() {
      const { final } = get().run;
      if (!final) return;
      store.setState((s) => ({ ...s, overlay: { name: 'export' }, bundle: { status: 'running', data: null, error: null } }));
      try {
        const data = await api.exportBundle(final.pr_id);
        store.setState((s) => ({ ...s, bundle: { status: 'done', data, error: null } }));
      } catch (err) {
        patchState('bundle', { status: 'error', error: err.message });
      }
    },

    async addMutant({ title, category, description, caught }) {
      const { run } = get();
      if (!run.final) return;
      const before = new Set(run.mutants.map((m) => m.id));
      store.setState((s) => ({ ...s, mutantForm: { status: 'saving', error: null } }));
      try {
        const final = await api.addMutant({ pr_id: run.final.pr_id, category, title, bug_description: description, caught });
        const added = (final.deterministic_score?.mutant_evaluations ?? []).map((m) => m.mutant_id).find((id) => !before.has(id)) ?? null;
        dispatchRun({ stage: '_replace_final', final, calibrationId: added });
        store.setState((s) => ({ ...s, overlay: null, view: 'verify', mutantForm: { status: 'idle', error: null }, ui: { ...s.ui, selectedMutant: added } }));
      } catch (err) {
        store.setState((s) => ({ ...s, mutantForm: { status: 'error', error: err.message } }));
      }
    },

    async runLiveDast() {
      const { run } = get();
      store.setState((s) => ({ ...s, dast: { status: 'running', report: null, error: null } }));
      try {
        const report = await api.liveDast({ repo_name: run.repoName || 'acme-pay/refund-daemon-service', patch_id: 'patch_3802_live_dast', session_patch_attempt: 2 });
        store.setState((s) => ({ ...s, dast: { status: 'done', report, error: null } }));
      } catch (err) {
        patchState('dast', { status: 'error', error: err.message });
      }
    },

    importGithub: (url) => importAndRun(() => api.importGithub(url, get().options.scope)),
    importCustom: ({ title, repo_name, diff }) => importAndRun(() => api.importCustom({
      title, repo_name, author: 'custom-dev[ai]', description: 'Custom PR submitted via the Argus-PR importer',
      diff, code: diff, scope_override: get().options.scope,
    })),
    importUpload: ({ files, title, repo_name, entry_file }) => importAndRun(() => api.importUpload({
      title, repo_name: repo_name || 'local-upload/workspace', author: 'local-developer',
      description: `Uploaded ${files.length} file(s) via the Argus-PR importer`,
      scope_override: get().options.scope, entry_file: entry_file || null,
      files: files.map((f) => ({ filename: f.filename, content_b64: f.content_b64 })),
    })),

    async copyText(text) {
      try { await clipboard.writeText(text); return true; } catch { return false; }
    },
    copyFixPrompt() {
      const { final } = get().run;
      return final ? actions.copyText(fixPrompt(final)) : Promise.resolve(false);
    },
    downloadReport() {
      const { run, decision } = get();
      if (!run.final) return;
      download(`argus-pr-report-${run.final.pr_id}.json`, JSON.stringify(reportPayload(run.final, decision, now()), null, 2));
    },
  };
  return actions;
}
