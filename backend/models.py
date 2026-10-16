from __future__ import annotations

from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class GuardrailResult(BaseModel):
    is_safe: bool = Field(description="False if prompt injection, instruction override, or malicious exfiltration is detected in the PR diff/comments.")
    risk_level: Literal["SAFE", "SUSPICIOUS", "BLOCKED"] = Field(description="Classification of untrusted PR input safety.")
    detected_threats: List[str] = Field(default_factory=list, description="Specific suspicious strings, prompt injection attempts, or hidden instructions found.")
    sanitized_summary: str = Field(description="Brief explanation from gemini-3.5-flash-lite guardrail check.")
    latency_ms: int = Field(default=85, description="Execution time in milliseconds.")


class ScopeTriageResult(BaseModel):
    scope_mode: Literal["SINGLE_FILE_UNIT", "SPARSE_PACKAGE_TREE", "LIVE_SERVER_DAEMON"] = Field(
        default="SINGLE_FILE_UNIT",
        description="Stage 0.5 Smart Scope Triage decision for sandbox context mounting.",
    )
    selection_source: Literal["agent_auto", "user_override"] = Field(
        default="agent_auto",
        description="Whether scope_mode was automatically selected by Stage 0.5 or overridden by the user.",
    )
    primary_target_file: str = Field(description="Primary target source file under red-team verification.")
    mounted_files: List[str] = Field(default_factory=list, description="Minimal slice of files mounted into the Antigravity sandbox.")
    skipped_heavy_paths: List[str] = Field(
        default_factory=list,
        description="Heavy lockfiles, datasets, or docs skipped to optimize sandbox spin-up and token footprint.",
    )
    estimated_mount_size_kb: float = Field(default=8.4, description="Total mounted payload size in KB.")
    rationale: str = Field(description="Explanation of why single-file, sparse-package, or live-server daemon mode was chosen.")


class RedTeamAttemptStep(BaseModel):
    attempt_num: int = Field(description="Attempt number within the 5-turn cap (1..5).")
    attack_hypothesis: str = Field(description="Bypass hypothesis or mutation strategy for this turn.")
    payload_snippet: str = Field(description="Adversarial payload or function call injected in this turn.")
    sandbox_observation: str = Field(description="Target's defensive block response or exception trace observed in sandbox.")
    status: Literal["BLOCKED", "BREACHED", "DEFENDED"] = Field(description="Outcome of this attempt turn.")


class InvariantItem(BaseModel):
    id: str = Field(description="Unique ID like INV-1, INV-2")
    category: Literal["security", "edge_cases", "state", "regression"] = Field(description="Primary attacker category responsible for testing this invariant.")
    title: str = Field(description="Short title of the invariant the PR must preserve.")
    formal_assertion: str = Field(description="Concrete invariant condition or property that must hold.")
    target_function: str = Field(description="Function or class method in the PR under test.")


class AttackVectorPlan(BaseModel):
    attacker_id: Literal["security", "edge_cases", "state", "regression"]
    attacker_name: str
    focus_invariants: List[str] = Field(description="List of Invariant IDs targeted by this attacker.")
    strategy: str = Field(description="How this Gemini 3.8 Flash agent will try to break the PR and assert invariants.")


class InvariantExtractionPlan(BaseModel):
    pr_summary: str
    invariants: List[InvariantItem]
    attack_plans: List[AttackVectorPlan]


class PlantedBugMutant(BaseModel):
    mutant_id: str = Field(description="e.g., M1, M2 ... M8")
    category: Literal["security", "edge_cases", "state", "regression"]
    title: str = Field(description="Short name of the planted bug, e.g. 'Off-by-one refund limit bypass'")
    description: str = Field(description="What subtle bug was planted in the shadow copy.")
    diff_snippet: str = Field(description="Unified diff or code change showing the planted bug.")
    mutated_code: str = Field(description="Full mutated Python module code with this single bug planted.")
    severity: Literal["CRITICAL", "HIGH", "MEDIUM"] = "HIGH"


class BlindMutantSet(BaseModel):
    mutants: List[PlantedBugMutant] = Field(description="8 subtly planted bugs created by the isolated Blind Bug Planter call.")


class GeneratedTestCase(BaseModel):
    test_id: str = Field(description="Unique function name, e.g., test_sec_negative_refund_bypass")
    attacker_id: Literal["security", "edge_cases", "state", "regression"]
    target_invariant_id: str = Field(description="Which invariant ID this test verifies/attacks.")
    description: str = Field(description="What this breaking/verification test checks.")
    pytest_code: str = Field(description="Self-contained Python test function `def test_...(target_module):` that raises AssertionError if the invariant is violated.")
    max_attempts: int = Field(default=5, description="Hard upper bound on iterative red-team mutation attempts.")
    attempts_used: int = Field(default=1, description="Number of iterative observe-mutate-attack turns executed.")
    breached_on_attempt: Optional[int] = Field(default=None, description="Turn number (1..5) on which the defense was breached, or None if defended.")
    attempt_history: List[RedTeamAttemptStep] = Field(default_factory=list, description="Turn-by-turn Observe-Mutate-Attack trace (up to 5 attempts).")


class AttackerSwarmOutput(BaseModel):
    attacker_id: Literal["security", "edge_cases", "state", "regression"]
    tests: List[GeneratedTestCase]


class SingleTestRunResult(BaseModel):
    test_id: str
    attacker_id: str
    target_invariant_id: str
    run_1_passed: bool
    run_2_passed: bool
    reproduced_twice: bool = Field(description="True ONLY if both run_1 and run_2 failed (2/2 reproducible failure on PR code).")
    passed_on_original: bool = Field(description="True if test passed cleanly on original PR code (eligible to count for mutant kills).")
    error_trace: Optional[str] = None
    duration_ms: int = 42
    max_attempts: int = Field(default=5, description="Hard upper bound on iterative red-team mutation attempts.")
    attempts_used: int = Field(default=1, description="Number of iterative observe-mutate-attack turns executed.")
    breached_on_attempt: Optional[int] = Field(default=None, description="Turn number (1..5) on which the defense was breached, or None if defended.")
    attempt_history: List[RedTeamAttemptStep] = Field(default_factory=list, description="Turn-by-turn Observe-Mutate-Attack trace (up to 5 attempts).")


class MutantKillEvaluation(BaseModel):
    mutant_id: str
    title: str
    category: str
    description: str
    diff_snippet: str
    severity: str
    caught: bool = Field(description="True ONLY IF at least one test PASSED on original PR and FAILED on this mutant.")
    caught_by_test_ids: List[str] = Field(default_factory=list, description="Tests that satisfied Pass(PR_orig) AND Fail(Mutant).")
    caught_by_attackers: List[str] = Field(default_factory=list)
    raw_failed_test_ids: List[str] = Field(default_factory=list, description="All tests that failed on this mutant before filtering.")


class SandboxExecutionReport(BaseModel):
    sandbox_agent: str = "antigravity-preview-09-2026"
    environment_id: str
    execution_mode: Literal["antigravity_remote_sandbox", "recorded_sandbox_replay"]
    script_command: str = "python /workspace/harness/run_dual_track_verification.py"
    pr_test_results: List[SingleTestRunResult]
    mutant_matrix: Dict[str, Dict[str, bool]] = Field(
        description="Mapping of mutant_id -> {test_id: passed_bool} from Track (b) sandbox execution."
    )
    sandbox_stdout_logs: List[str] = Field(default_factory=list)


class DeterministicScoreReport(BaseModel):
    total_tests_generated: int
    valid_baseline_tests: int = Field(description="Number of tests that passed on the original PR code (Pass(PR_orig)).")
    confirmed_pr_failures_count: int = Field(description="Failures on PR code that reproduced 2/2 times.")
    flaky_filtered_count: int = Field(description="Failures that only failed 1/2 times and were filtered out.")
    confirmed_pr_failures: List[SingleTestRunResult]
    planted_bugs_total: int = Field(description="K: Total planted bugs (e.g., 8)")
    planted_bugs_caught: int = Field(description="M: Planted bugs caught where Pass(PR_orig) AND Fail(Mutant) (e.g., 7)")
    detection_score_pct: float = Field(description="Deterministic M/K * 100 percentage")
    detection_score_label: str = Field(description="e.g., '7 of 8 planted bugs caught (87.5%)'")
    mutant_evaluations: List[MutantKillEvaluation]
    surviving_mutants: List[MutantKillEvaluation]


class OneCardExecutiveSummary(BaseModel):
    headline_verdict: Literal["REJECT_RECOMMENDED", "CAUTION_REVIEW", "APPROVE_RECOMMENDED"]
    residual_risk_level: Literal["CRITICAL", "HIGH", "MODERATE", "LOW"]
    one_line_takeaway: str
    finding_highlights: List[str]
    blind_spot_explanation: str = Field(description="Argon's explanation of why surviving mutants escaped and what residual risk remains.")
    recommended_fix_snippet: str


class PatchAttemptStep(BaseModel):
    attempt_num: int = Field(description="Attempt number within max_patch_attempts (1..5)")
    patch_id: str = Field(description="Patch candidate ID (e.g., 'patch_3802_att1', 'patch_3802_att2')")
    candidate_diff_summary: str = Field(description="Summary of the code changes attempted in this turn")
    gate_1_ast_syntax: bool = Field(description="Whether AST/syntax/type check passed")
    gate_2_semgrep_clean: bool = Field(description="Whether static analysis produced 0 new warnings")
    gate_3_dast_regression_blocked: bool = Field(description="Whether pinned PROVEN DAST/sandbox attacks were blocked")
    gate_4_mutant_kill_preserved: bool = Field(description="Whether unit tests passed and Blind Mutant kill rate was preserved")
    counterexample_feedback: Optional[str] = Field(default=None, description="Exact counterexample error trace/reproduction payload passed to next patch_node turn on failure")
    status: Literal["FAILED_COUNTEREXAMPLE", "VERIFIED"]


class SelfHealingPatchReport(BaseModel):
    patch_session_id: str
    final_patch_id: str
    max_patch_attempts: int = 5
    attempts_used: int
    verified_on_attempt: int
    final_status: Literal["VERIFIED", "FAILED"]
    attempt_history: List[PatchAttemptStep]


class PinnedRegressionTestFile(BaseModel):
    file_path: str = Field(description="e.g., 'tests/security/test_argus_regression_pr_412.py'")
    source_test_ids: List[str] = Field(description="List of 2/2 reproduced PROVEN attack test IDs")
    evidence_tier: Literal["PROVEN"] = "PROVEN"
    linked_patch_id: str
    pytest_content: str = Field(description="Complete pytest regression suite where exploit blocked = test PASS")


class VerifiedPRBundleResponse(BaseModel):
    bundle_id: str
    pr_id: str
    repo_name: str
    branch_name: str = Field(description="e.g., 'fix/argus-verified-patch-3802'")
    commit_Title: str
    patch_id: str
    production_patch_diff: str
    regression_test_file: PinnedRegressionTestFile
    ci_workflow_snippet: str = Field(description="GitHub Actions YAML snippet running the pinned regression test on every commit")
    verification_badge_summary: str = Field(description="e.g., '4-Gate VERIFIED (Attempt 2/5) · 0 Confirmed Defects · 7/8 Blind Mutants Killed (87.5%)'")


class AuthPersona(BaseModel):
    persona_id: str = Field(description="'persona_victim_tenant_a', 'persona_attacker_tenant_b', or 'persona_anon'")
    role: Literal["OWNER_VICTIM", "CROSS_TENANT_ATTACKER", "ANONYMOUS"]
    tenant_id: str
    headers_injected: Dict[str, str] = Field(default_factory=dict)


class AuthZMatrixRow(BaseModel):
    endpoint: str
    target_resource_id: str
    owner_baseline_status: int
    cross_tenant_attacker_status: int
    anonymous_status: int
    bola_vulnerable_2x: bool
    verdict: Literal["PROVEN_BOLA_BYPASS", "ENFORCED_ISOLATION"]


class FullVerificationRunResponse(BaseModel):
    run_id: str
    pr_id: str
    pr_title: str
    repo_name: str
    author: str
    phase_mode: Literal["phase1_mvp", "phase2_full"] = "phase2_full"
    guardrail: GuardrailResult
    scope_triage: Optional[ScopeTriageResult] = None
    invariant_plan: InvariantExtractionPlan
    swarm_outputs: List[AttackerSwarmOutput]
    sandbox_report: SandboxExecutionReport
    deterministic_score: DeterministicScoreReport
    one_card_summary: OneCardExecutiveSummary
    self_healing_patch: Optional[SelfHealingPatchReport] = None

