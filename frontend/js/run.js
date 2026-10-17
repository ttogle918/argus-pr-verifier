import { STAGES, initialRun } from './state.js';
import { classifyTest } from './derive.js';

const SCOPE_LABEL = { SINGLE_FILE_UNIT: 'single file', SPARSE_PACKAGE_TREE: 'sparse package', LIVE_SERVER_DAEMON: 'live server' };

const setStage = (run, key, value) => ({ ...run, stages: { ...run.stages, [key]: value } });
const meta = (run, key, value) => ({ ...run, stageMeta: { ...run.stageMeta, [key]: value } });
const activeStage = (run) => STAGES.find((k) => run.stages[k] === 'active') ?? null;
const sysLog = (run, text, tone = null) => ({ ...run, logs: [...run.logs, { ts: '', track: 'SYS', text, tone }] });
const nextSeq = (run) => (run.lastBeam?.seq ?? 0) + 1;

function toMutant(m, status) {
  return {
    id: m.mutant_id, category: m.category, title: m.title, description: m.description, diff: m.diff_snippet,
    severity: m.severity, status, caughtBy: m.caught_by_test_ids ?? [], caughtByAttackers: m.caught_by_attackers ?? [],
  };
}

function buildTests(swarmOutputs, prev = {}) {
  const tests = {};
  const order = [];
  for (const s of swarmOutputs) {
    for (const t of s.tests) {
      const old = prev[t.test_id];
      order.push(t.test_id);
      tests[t.test_id] = {
        id: t.test_id, attackerId: s.attacker_id, invariantId: t.target_invariant_id, description: t.description,
        outcome: old?.outcome ?? 'pending', attemptsUsed: t.attempts_used, maxAttempts: t.max_attempts,
        breachedOnAttempt: t.breached_on_attempt, attemptHistory: t.attempt_history ?? [],
        errorTrace: old?.errorTrace ?? null, kills: old?.kills ?? [],
      };
    }
  }
  return { tests, order };
}

function addKills(tests, evaluations) {
  const out = { ...tests };
  for (const m of evaluations) {
    for (const id of m.caught_by_test_ids ?? []) {
      if (out[id]) out[id] = { ...out[id], kills: [...new Set([...out[id].kills, m.mutant_id])] };
    }
  }
  return out;
}

function sandboxAMeta(tests) {
  const v = Object.values(tests);
  return `${v.filter((t) => t.outcome === 'breach').length} breached · ${v.filter((t) => t.outcome === 'flaky').length} flaky`;
}

function applyFinal(run, final, calibrationId) {
  const phase = final.phase_mode ?? run.phase;
  let { tests, order } = buildTests(final.swarm_outputs ?? []);
  for (const r of final.sandbox_report?.pr_test_results ?? []) {
    if (tests[r.test_id]) tests[r.test_id] = { ...tests[r.test_id], outcome: classifyTest(r, phase), errorTrace: r.error_trace ?? null };
  }
  const evals = final.deterministic_score?.mutant_evaluations ?? [];
  tests = addKills(tests, evals);
  return {
    ...run, final, prTitle: final.pr_title || run.prTitle,
    score: final.deterministic_score, oneCard: final.one_card_summary,
    matrix: final.sandbox_report?.mutant_matrix ?? null, tests, testOrder: order,
    mutants: evals.map((m) => toMutant(m, m.caught ? 'caught' : 'survived')),
    calibrationIds: calibrationId ? [...new Set([...run.calibrationIds, calibrationId])] : run.calibrationIds,
  };
}

export function reduceRunEvent(run, evt) {
  switch (evt.stage) {
    case '_start': {
      const base = initialRun();
      return {
        ...base, status: 'running', prId: evt.prId, prTitle: evt.prTitle, repoName: evt.repoName, author: evt.author,
        phase: evt.phase, requestedMode: evt.requestedMode, startedAt: evt.startedAt,
        stages: { ...base.stages, guardrail: 'active' },
      };
    }
    case 'guardrail_start':
      return setStage({ ...run, effectiveMode: evt.execution_mode ?? run.effectiveMode }, 'guardrail', 'active');
    case 'guardrail': {
      const g = evt.guardrail;
      let next = meta({ ...run, guardrail: g, scopeTriage: evt.scope_triage ?? run.scopeTriage }, 'guardrail', `${g.risk_level} · ${g.latency_ms} ms`);
      next = setStage(next, 'guardrail', g.is_safe ? 'done' : 'blocked');
      if (g.is_safe) next = setStage(next, 'scope_triage', 'active');
      return sysLog(next, g.is_safe ? `Guardrail passed: ${g.sanitized_summary}` : `Blocked by guardrail: ${g.sanitized_summary}`, g.is_safe ? null : 'danger');
    }
    case 'blocked': {
      const f = evt.final_response;
      return { ...run, status: 'blocked', final: f, score: f.deterministic_score, oneCard: f.one_card_summary, runId: f.run_id };
    }
    case 'scope_triage': {
      const st = evt.scope_triage;
      const next = setStage(meta({ ...run, scopeTriage: st }, 'scope_triage', `${SCOPE_LABEL[st.scope_mode] ?? st.scope_mode} · ${st.estimated_mount_size_kb} KB`), 'scope_triage', 'done');
      return sysLog(next, `Scope ${st.scope_mode} (${st.selection_source}): ${st.mounted_files.length} file(s) mounted, ${st.skipped_heavy_paths.length} heavy path(s) skipped.`);
    }
    case 'blind_dual_track_start':
      return sysLog(setStage(run, 'blind_plan', 'active'), 'Planner and bug planter started in separate sessions (store=False).');
    case 'track_1a_complete':
      return sysLog({ ...run, invariantPlan: evt.invariant_plan }, `Extracted ${evt.invariants_count} invariants.`);
    case 'swarm_attacking_start': {
      const attackers = evt.active_attackers ?? [];
      return sysLog({ ...setStage(run, 'swarm', 'active'), attackers }, `Dispatched ${attackers.length} attacker agents (up to ${evt.max_attempts} attempts each).`);
    }
    case 'invariants_extracted': {
      const mutants = (evt.sealed_mutants ?? []).map((m) => toMutant(m, 'sealed'));
      const next = setStage(meta({ ...run, invariantPlan: evt.invariant_plan ?? run.invariantPlan, mutants }, 'blind_plan', `${evt.invariants_count} invariants · ${mutants.length} sealed`), 'blind_plan', 'done');
      return sysLog(next, `Sealed ${mutants.length} planted bugs behind the information wall.`);
    }
    case 'swarm_attacking': {
      const { tests, order } = buildTests(evt.swarm_outputs ?? [], run.tests);
      // swarm_attacking_start lists every planned attacker; phase 1 drops regression here, so this list wins.
      const fromSwarm = [...new Set((evt.swarm_outputs ?? []).map((s) => s.attacker_id))];
      const attackers = fromSwarm.length ? fromSwarm : run.attackers;
      const next = setStage(meta({ ...run, attackers, tests, testOrder: order }, 'swarm', `${attackers.length} agents · ${order.length} tests`), 'swarm', 'done');
      return sysLog(next, `Swarm wrote ${order.length} tests.`);
    }
    case 'sandbox_start':
      return setStage(run, 'sandbox_a', 'active');
    case '_log':
      return { ...run, logs: [...run.logs, evt.entry] };
    case '_test_result': {
      const r = evt.result;
      const t = run.tests[r.test_id];
      if (!t) return run;
      const outcome = classifyTest(r, run.phase);
      const tests = {
        ...run.tests,
        [r.test_id]: {
          ...t, outcome, errorTrace: r.error_trace ?? null,
          attemptsUsed: r.attempts_used ?? t.attemptsUsed,
          breachedOnAttempt: r.breached_on_attempt ?? t.breachedOnAttempt,
          attemptHistory: r.attempt_history?.length ? r.attempt_history : t.attemptHistory,
        },
      };
      const tone = outcome === 'breach' ? 'danger' : outcome === 'flaky' ? 'warn' : 'muted';
      return meta({ ...run, tests, lastBeam: { seq: nextSeq(run), attackerId: t.attackerId, mutantId: null, tone } }, 'sandbox_a', sandboxAMeta(tests));
    }
    case 'sandbox_track_a': {
      const tests = evt.swarm_outputs ? buildTests(evt.swarm_outputs, run.tests).tests : run.tests;
      const mutants = run.mutants.map((m, i) => (i === 0 && m.status === 'sealed' ? { ...m, status: 'testing' } : m));
      let next = meta(meta({ ...run, tests, mutants }, 'sandbox_a', sandboxAMeta(tests)), 'sandbox_b', mutants.length ? `M1 of ${mutants.length}` : '');
      next = setStage(setStage(next, 'sandbox_a', 'done'), 'sandbox_b', 'active');
      return next;
    }
    case '_mutant_result': {
      const m = evt.evaluation;
      const idx = run.mutants.findIndex((x) => x.id === m.mutant_id);
      if (idx === -1) return run;
      const mutants = run.mutants.map((x, i) => {
        if (i === idx) return { ...x, status: m.caught ? 'caught' : 'survived', caughtBy: m.caught_by_test_ids ?? [], caughtByAttackers: m.caught_by_attackers ?? [] };
        if (i === idx + 1 && x.status === 'sealed') return { ...x, status: 'testing' };
        return x;
      });
      const lastBeam = m.caught
        ? { seq: nextSeq(run), attackerId: m.caught_by_attackers?.[0] ?? null, mutantId: m.mutant_id, tone: 'ok' }
        : run.lastBeam;
      return meta({ ...run, mutants, tests: addKills(run.tests, [m]), lastBeam }, 'sandbox_b', `M${idx + 1} of ${mutants.length}`);
    }
    case 'sandbox_track_b':
      return setStage(setStage({ ...run, matrix: evt.mutant_matrix ?? run.matrix }, 'sandbox_b', 'done'), 'one_card', 'active');
    case 'deterministic_scoring':
      return meta({ ...run, score: evt.deterministic_score }, 'one_card', evt.deterministic_score.detection_score_label);
    case 'one_card_start':
      return setStage(run, 'one_card', 'active');
    case 'one_card_synthesis':
      return { ...run, oneCard: evt.one_card_summary, final: evt.final_response ?? run.final };
    case 'done': {
      const f = evt.final_response ?? run.final;
      if (run.status === 'blocked') return { ...run, final: f, runId: evt.run_id ?? run.runId, finishedAt: evt.receivedAt ?? null };
      return setStage({
        ...run, status: 'complete', final: f, runId: evt.run_id ?? run.runId, finishedAt: evt.receivedAt ?? null,
        score: f?.deterministic_score ?? run.score, oneCard: f?.one_card_summary ?? run.oneCard,
        matrix: f?.sandbox_report?.mutant_matrix ?? run.matrix,
      }, 'one_card', 'done');
    }
    case '_error': {
      const stage = activeStage(run);
      let next = { ...run, status: 'error', error: { message: evt.message, stage } };
      if (stage) next = setStage(next, stage, 'error');
      return sysLog(next, `Run stopped: ${evt.message}`, 'danger');
    }
    case '_replace_final':
      return applyFinal(run, evt.final, evt.calibrationId);
    default:
      return run;
  }
}
