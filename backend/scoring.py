"""
Deterministic Score Calculator for Argus-PR Blind Meta-Verification.

Enforces three strict rules:
1. All detection scores (M/K) and failure counts are computed deterministically in Python,
   never estimated by an LLM.
2. Track (a) PR Failures: A PR test failure is confirmed ONLY if it fails 2/2 times (in 2x repro mode)
   or 1/1 in Phase 1 mode. Flaky failures (failed once, passed once) are filtered out.
3. Track (b) Blind Mutant Detection: A planted bug (mutant m_i) is counted as CAUGHT (KILLED)
   by test t_j ONLY IF:
       Pass(t_j, PR_original) == True  AND  Fail(t_j, Mutant m_i) == True
   Tests that already failed on the original PR code (or crashed everywhere) are strictly
   excluded from mutant detection calculation.
"""

from __future__ import annotations

from typing import Dict, List
from backend.models import (
    AttackerSwarmOutput,
    BlindMutantSet,
    DeterministicScoreReport,
    MutantKillEvaluation,
    SandboxExecutionReport,
    SingleTestRunResult,
)


def compute_deterministic_scores(
    swarm_outputs: List[AttackerSwarmOutput],
    blind_mutants: BlindMutantSet,
    sandbox_report: SandboxExecutionReport,
    require_two_repros: bool = True,
) -> DeterministicScoreReport:
    # Map test_id -> attacker_id
    test_to_attacker: Dict[str, str] = {}
    for swarm in swarm_outputs:
        for t in swarm.tests:
            test_to_attacker[t.test_id] = swarm.attacker_id

    # 1. Analyze Track (a): Original PR Code Execution Results
    passed_on_orig_set = set()
    confirmed_pr_failures: List[SingleTestRunResult] = []
    flaky_filtered_count = 0

    for res in sandbox_report.pr_test_results:
        # Strict Baseline Pass: passed both runs on original PR code
        if res.run_1_passed and res.run_2_passed:
            passed_on_orig_set.add(res.test_id)
        else:
            # Check if it failed reproducibly
            if require_two_repros:
                if (not res.run_1_passed) and (not res.run_2_passed):
                    confirmed_pr_failures.append(res)
                else:
                    flaky_filtered_count += 1
            else:
                if not res.run_1_passed:
                    confirmed_pr_failures.append(res)

    # 2. Analyze Track (b): 8 Blind Mutants Execution Results
    # Rule: Caught(m_i) <==> exists t_j in T such that Pass(t_j, PR_orig) AND Fail(t_j, m_i)
    mutant_evaluations: List[MutantKillEvaluation] = []
    surviving_mutants: List[MutantKillEvaluation] = []
    caught_count = 0

    for mutant in blind_mutants.mutants:
        per_test_outcomes = sandbox_report.mutant_matrix.get(mutant.mutant_id, {})
        raw_failed_tests: List[str] = []
        valid_catching_tests: List[str] = []
        catching_attackers: List[str] = []

        for test_id, passed_on_mutant in per_test_outcomes.items():
            if not passed_on_mutant:
                raw_failed_tests.append(test_id)
                # CRITICAL CHECK: Did this test PASS on the original PR code?
                if test_id in passed_on_orig_set:
                    valid_catching_tests.append(test_id)
                    attacker = test_to_attacker.get(test_id, "unknown")
                    if attacker not in catching_attackers:
                        catching_attackers.append(attacker)

        is_caught = len(valid_catching_tests) > 0
        if is_caught:
            caught_count += 1

        eval_item = MutantKillEvaluation(
            mutant_id=mutant.mutant_id,
            title=mutant.title,
            category=mutant.category,
            description=mutant.description,
            diff_snippet=mutant.diff_snippet,
            severity=mutant.severity,
            caught=is_caught,
            caught_by_test_ids=valid_catching_tests,
            caught_by_attackers=catching_attackers,
            raw_failed_test_ids=raw_failed_tests,
        )
        mutant_evaluations.append(eval_item)
        if not is_caught:
            surviving_mutants.append(eval_item)

    total_planted = len(blind_mutants.mutants)
    score_pct = round((caught_count / total_planted) * 100.0, 1) if total_planted > 0 else 0.0
    score_label = f"{caught_count} of {total_planted} planted bugs caught ({score_pct}%)"

    return DeterministicScoreReport(
        total_tests_generated=len(sandbox_report.pr_test_results),
        valid_baseline_tests=len(passed_on_orig_set),
        confirmed_pr_failures_count=len(confirmed_pr_failures),
        flaky_filtered_count=flaky_filtered_count,
        confirmed_pr_failures=confirmed_pr_failures,
        planted_bugs_total=total_planted,
        planted_bugs_caught=caught_count,
        detection_score_pct=score_pct,
        detection_score_label=score_label,
        mutant_evaluations=mutant_evaluations,
        surviving_mutants=surviving_mutants,
    )
