export const STAGES = ['guardrail', 'scope_triage', 'blind_plan', 'swarm', 'sandbox_a', 'sandbox_b', 'one_card'];

export function initialRun() {
  return {
    status: 'idle', runId: null, prId: null, prTitle: '', repoName: '', author: '',
    phase: 'phase2_full', requestedMode: 'replay', effectiveMode: null,
    startedAt: null, finishedAt: null, error: null,
    stages: Object.fromEntries(STAGES.map((s) => [s, 'pending'])),
    stageMeta: {},
    guardrail: null, scopeTriage: null, invariantPlan: null,
    attackers: [], tests: {}, testOrder: [], mutants: [], logs: [], lastBeam: null,
    score: null, oneCard: null, final: null, matrix: null, calibrationIds: [],
  };
}

export const idleAsync = () => ({ status: 'idle', error: null });

export function initialState() {
  return {
    prs: [], prsStatus: 'loading', selectedPrId: 'pr-checkout-race',
    options: { phase: 'phase2_full', mode: 'replay', scope: 'auto' },
    view: 'start', overlay: null, run: initialRun(), decision: null,
    patch: { ...idleAsync(), report: null, before: null },
    dast: { ...idleAsync(), report: null },
    bundle: { ...idleAsync(), data: null },
    importState: { status: 'idle', message: '' },
    mutantForm: idleAsync(),
    ui: { logFilter: 'all', selectedMutant: null },
  };
}
