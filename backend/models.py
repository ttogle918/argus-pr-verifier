from __future__ import annotations

from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class GuardrailResult(BaseModel):
    is_safe: bool = Field(description="False if prompt injection, instruction override, or malicious exfiltration is detected in the PR diff/comments.")
    risk_level: Literal["SAFE", "SUSPICIOUS", "BLOCKED"] = Field(description="Classification of untrusted PR input safety.")
    detected_threats: List[str] = Field(default_factory=list, description="Specific suspicious strings, prompt injection attempts, or hidden instructions found.")
    sanitized_summary: str = Field(description="Brief explanation from gemini-3.5-flash-lite guardrail check.")
    latency_ms: int = Field(default=85, description="Execution time in milliseconds.")


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


class FullVerificationRunResponse(BaseModel):
    run_id: str
    pr_id: str
    pr_title: str
    repo_name: str
    author: str
    phase_mode: Literal["phase1_mvp", "phase2_full"] = "phase2_full"
    guardrail: GuardrailResult
    invariant_plan: InvariantExtractionPlan
    swarm_outputs: List[AttackerSwarmOutput]
    sandbox_report: SandboxExecutionReport
    deterministic_score: DeterministicScoreReport
    one_card_summary: OneCardExecutiveSummary
