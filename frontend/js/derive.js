export const ATTACKER_LABEL = { security: 'Security', edge_cases: 'Edge Case', state: 'State', regression: 'Regression' };
export const ATTACKER_ICON = { security: 'security', edge_cases: 'edge_cases', state: 'state', regression: 'regression' };
export const STAGE_LABEL = {
  guardrail: 'Guardrail', scope_triage: 'Scope', blind_plan: 'Blind plan', swarm: 'Swarm',
  sandbox_a: 'Sandbox A', sandbox_b: 'Sandbox B', one_card: 'Score & card',
};
export const SAMPLE_PR_IDS = [
  'pr-cisco-sandbox-bypass', 'pr-cisco-scoring-divzero', 'pr-checkout-race', 'pr-ratelimiter-offbyone', 'pr-prompt-injection-attack',
];

// Mirrors backend/scoring.py: phase 2 needs 2/2 failures; phase 1 counts the first run.
export function classifyTest(result, phase) {
  if (result.run_1_passed && result.run_2_passed) return 'held';
  if (phase === 'phase1_mvp') return result.run_1_passed ? 'flaky' : 'breach';
  return !result.run_1_passed && !result.run_2_passed ? 'breach' : 'flaky';
}

export function phaseLabels(phase) {
  return phase === 'phase1_mvp'
    ? { repro: '1 run', held: 'Held', name: 'Phase 1 · 3 attackers · 1 run' }
    : { repro: '2/2 repro', held: 'Held 2/2', name: 'Phase 2 · 4 attackers · 2× repro' };
}

export function runCounts(run) {
  const tests = Object.values(run.tests);
  const by = (o) => tests.filter((t) => t.outcome === o).length;
  const mut = (s) => run.mutants.filter((m) => m.status === s).length;
  return {
    breach: by('breach'), flaky: by('flaky'), held: by('held'), pending: by('pending'), total: tests.length,
    caught: mut('caught'), survived: mut('survived'), sealed: mut('sealed'), testing: mut('testing'), mutantsTotal: run.mutants.length,
  };
}

export function matrixModel(final, calibrationIds = [], phase = final.phase_mode) {
  const results = new Map((final.sandbox_report?.pr_test_results ?? []).map((r) => [r.test_id, r]));
  const matrix = final.sandbox_report?.mutant_matrix ?? {};
  const columns = (final.deterministic_score?.mutant_evaluations ?? []).map((m) => ({
    id: m.mutant_id, category: m.category, severity: m.severity, title: m.title, description: m.description,
    diff: m.diff_snippet, verdict: m.caught ? 'caught' : 'survived', caughtBy: m.caught_by_test_ids ?? [],
    calibration: calibrationIds.includes(m.mutant_id),
  }));
  const groups = (final.swarm_outputs ?? []).map((s) => ({
    attackerId: s.attacker_id,
    rows: s.tests.map((t) => {
      const r = results.get(t.test_id);
      const valid = !!r && r.run_1_passed && r.run_2_passed;
      const validity = valid ? 'valid' : r && classifyTest(r, phase) === 'breach' ? 'defect' : 'flaky';
      return {
        testId: t.test_id, invariantId: t.target_invariant_id, validity,
        cells: columns.map((c) => ({
          mutantId: c.id,
          state: !valid ? 'invalid' : matrix[c.id]?.[t.test_id] === false ? 'caught' : 'survived',
        })),
      };
    }),
  }));
  return { columns, groups };
}

const LOG_RE = /^\[antigravity-sandbox:\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})Z\]\s?(.*)$/;

export function parseSandboxLog(line, track) {
  const m = LOG_RE.exec(line);
  const text = (m ? m[2] : line).replace(/\s+$/, '');
  let tone = null;
  if (/SURVIVED|FLAKY/.test(text)) tone = 'warn';
  else if (/KILLED|CAUGHT by/.test(text)) tone = 'ok';
  else if (/FAILED|\[FAIL\b/.test(text)) tone = 'danger';
  return { ts: m ? m[1] : '', track, text, tone };
}

export function sceneModel(run) {
  const resolved = run.mutants.some((m) => m.status === 'caught' || m.status === 'survived');
  const tested = Object.values(run.tests).some((t) => t.outcome !== 'pending');
  let stage;
  if (run.status === 'blocked') stage = 'blocked';
  else if (run.status === 'idle') stage = 'idle';
  else if (resolved) stage = run.score ? 'final' : 'revealing';
  else if (tested) stage = 'attacking';
  else if (run.mutants.length || run.attackers.length) stage = 'sealed';
  else stage = 'idle';
  const c = runCounts(run);
  const survivors = run.mutants.filter((m) => m.status === 'survived').map((m) => m.id);
  const summary = stage === 'blocked'
    ? 'Blocked at Stage 0. No attackers were dispatched.'
    : stage === 'final'
      ? `${c.caught} of ${c.mutantsTotal} hidden mutants caught.${survivors.length ? ` ${survivors.join(', ')} survived.` : ''}`
      : stage === 'idle'
        ? 'Waiting for a run.'
        : `${c.caught} of ${c.mutantsTotal || 8} hidden mutants caught so far.`;
  return {
    stage,
    dimmed: run.status === 'error',
    attackers: run.attackers.map((id) => ({ id, label: ATTACKER_LABEL[id] ?? id })),
    mutants: run.mutants.map((m) => ({ id: m.id, status: m.status })),
    beam: run.lastBeam,
    summary,
  };
}

const VERDICT = {
  REJECT_RECOMMENDED: { label: 'Reject recommended', tone: 'danger', icon: 'breach' },
  CAUTION_REVIEW: { label: 'Review with caution', tone: 'warn', icon: 'warn' },
  APPROVE_RECOMMENDED: { label: 'Approve recommended', tone: 'ok', icon: 'check' },
};
export const verdictInfo = (v) => VERDICT[v] ?? { label: v, tone: 'muted', icon: 'info' };
export const riskTone = (level) => ({ CRITICAL: 'danger', HIGH: 'danger', MODERATE: 'warn', LOW: 'ok' }[level] ?? 'muted');

export function fixPrompt(final) {
  const failures = final.deterministic_score.confirmed_pr_failures ?? [];
  return [
    `Fix the following ${failures.length} reproducible invariant violations in ${final.repo_name} (${final.pr_title}):`,
    '',
    ...failures.map((f, i) => `${i + 1}. Test: ${f.test_id}\n   Trace: ${f.error_trace || 'Reproduced 2/2 times'}`),
    '',
    `Blind verifier score: ${final.deterministic_score.detection_score_label}`,
    `Residual risk to address: ${final.one_card_summary.blind_spot_explanation}`,
    '',
    `Recommended reference patch:\n${final.one_card_summary.recommended_fix_snippet}`,
  ].join('\n');
}

export const reportPayload = (final, decision, exportedAt) => ({
  exported_at: exportedAt, language: 'en', verification_run: final, human_decision: decision,
});

export function formatElapsed(startIso, end) {
  if (!startIso) return '00:00';
  const endMs = typeof end === 'number' ? end : Date.parse(end);
  const secs = Math.max(0, Math.floor((endMs - Date.parse(startIso)) / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}
