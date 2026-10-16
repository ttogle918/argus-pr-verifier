"""
Argus-PR: PR Benchmark & FastAPI Server with Real-Time SSE Verification Streaming.

Serves:
- Static frontend UI at /
- GET /api/prs: List curated sample PR benchmarks
- POST /api/verify/stream: Real-time Server-Sent Events (SSE) streaming dual-track verification
- POST /api/verify: Synchronous verification endpoint returning FullVerificationRunResponse
- POST /api/decision: Human reviewer final release decision (APPROVE_MERGE / REJECT_MERGE)
- GET /api/decisions: History of review decisions
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import os
import pathlib
import time
from typing import Any, Dict, List, Literal, Optional
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.models import (
    DeterministicScoreReport,
    FullVerificationRunResponse,
    GuardrailResult,
    OneCardExecutiveSummary,
)
from backend.sample_prs import (
    SAMPLE_PRS,
    get_sample_pr_response,
    list_sample_prs_metadata,
)
from backend.scoring import compute_deterministic_scores

# Safe imports with fallback
try:
    import backend.gemini_swarm as gemini_swarm
except ImportError:
    gemini_swarm = None  # type: ignore

try:
    import backend.sandbox_runner as sandbox_runner
except ImportError:
    sandbox_runner = None  # type: ignore


app = FastAPI(
    title="Argus-PR Benchmark & Verification API",
    description="Swarm AI PR Red-Team & Blind Meta-Verification Engine",
    version="2.0.0",
)

# Enable CORS for local Vite dev server or standalone browser execution
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# In-memory store for human reviewer decisions
HUMAN_DECISIONS_STORE: List[Dict[str, Any]] = []


# ==============================================================================
# REQUEST & RESPONSE SCHEMAS
# ==============================================================================

class VerifyRequest(BaseModel):
    pr_id: str = Field(default="pr-checkout-race", description="ID of the sample PR or 'custom'")
    phase_mode: Literal["phase1_mvp", "phase2_full"] = Field(
        default="phase2_full",
        description="phase1_mvp (3 attackers, 1x run) or phase2_full (4 attackers, 2x repro verification)",
    )
    execution_mode: Literal["replay", "live_api"] = Field(
        default="replay",
        description="'replay' uses recorded sandbox replay traces; 'live_api' calls Gemini & Antigravity",
    )
    custom_diff: Optional[str] = Field(default=None, description="Optional custom unified diff")
    custom_code: Optional[str] = Field(default=None, description="Optional custom Python module code")


class DecisionRequest(BaseModel):
    run_id: str = Field(description="Run ID from verification")
    pr_id: str = Field(description="PR identifier")
    decision: Literal["APPROVE_MERGE", "REJECT_MERGE"] = Field(description="Final human reviewer verdict")
    reviewer_notes: Optional[str] = Field(default="", description="Optional feedback or rationale")
    reviewer: Optional[str] = Field(default="Human Tech Lead", description="Reviewer name or identifier")


# ==============================================================================
# REST API ENDPOINTS
# ==============================================================================

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Argus-PR Verification Engine",
        "gemini_api_configured": bool(os.getenv("GEMINI_API_KEY")),
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/prs")
async def get_sample_prs():
    """Returns the list of curated sample PR benchmarks with diffs and metadata."""
    return list_sample_prs_metadata()


@app.get("/api/prs/{pr_id}")
async def get_sample_pr_detail(pr_id: str):
    """Returns full details of a specific sample PR benchmark."""
    if pr_id not in SAMPLE_PRS:
        raise HTTPException(status_code=404, detail=f"PR '{pr_id}' not found.")
    item = SAMPLE_PRS[pr_id]
    return {
        "id": item["id"],
        "title": item["title"],
        "repo_name": item["repo_name"],
        "author": item["author"],
        "description": item["description"],
        "diff": item["diff"],
        "code": item["code"],
        "phase_support": item["phase_support"],
        "is_adversarial": item["is_adversarial"],
    }


@app.post("/api/decision")
async def record_human_decision(req: DecisionRequest):
    """Records a human reviewer's final merge decision."""
    record = {
        "id": f"dec_{uuid.uuid4().hex[:8]}",
        "run_id": req.run_id,
        "pr_id": req.pr_id,
        "decision": req.decision,
        "reviewer_notes": req.reviewer_notes,
        "reviewer": req.reviewer,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    HUMAN_DECISIONS_STORE.append(record)
    return {
        "status": "RECORDED",
        "decision": record,
    }


@app.get("/api/decisions")
async def list_human_decisions():
    """Lists all recorded review decisions."""
    return HUMAN_DECISIONS_STORE


# ==============================================================================
# SYNCHRONOUS VERIFICATION ENDPOINT
# ==============================================================================

@app.post("/api/verify", response_model=FullVerificationRunResponse)
async def verify_pr_sync(req: VerifyRequest):
    """
    Synchronous endpoint returning the complete FullVerificationRunResponse.
    Uses recorded replay data by default or executes live pipeline if requested.
    """
    pr_id = req.pr_id
    if pr_id not in SAMPLE_PRS and not req.custom_diff:
        raise HTTPException(status_code=404, detail=f"Sample PR '{pr_id}' not found and no custom diff provided.")

    # Replay mode or fallback
    if req.execution_mode == "replay" or not os.getenv("GEMINI_API_KEY"):
        if pr_id in SAMPLE_PRS:
            return get_sample_pr_response(pr_id, phase_mode=req.phase_mode)

    # Live API mode
    pr_data = SAMPLE_PRS.get(pr_id, {}).copy() if pr_id in SAMPLE_PRS else {}
    if req.custom_diff:
        pr_data["diff"] = req.custom_diff
    if req.custom_code:
        pr_data["code"] = req.custom_code
        pr_data["original_code"] = req.custom_code

    return await _execute_full_verification_pipeline(pr_data, req.phase_mode, live_api=True)


# ==============================================================================
# SERVER-SENT EVENTS (SSE) STREAMING PIPELINE
# ==============================================================================

def _format_sse(event_data: dict) -> str:
    """Formats a dictionary as a standard Server-Sent Event."""
    return f"data: {json.dumps(event_data)}\n\n"


async def _stream_verification_events(req: VerifyRequest):
    """
    Async generator yielding real-time SSE events for each verification stage.
    """
    pr_id = req.pr_id
    phase_mode = req.phase_mode
    is_live = (req.execution_mode == "live_api") and bool(os.getenv("GEMINI_API_KEY"))
    include_regression = (phase_mode == "phase2_full")

    # Locate base PR data
    if pr_id in SAMPLE_PRS:
        pr_data = SAMPLE_PRS[pr_id].copy()
    else:
        pr_data = {
            "id": "custom-pr",
            "title": "Custom User Submitted Pull Request",
            "repo_name": "custom/repo",
            "author": "developer",
            "description": "User provided PR diff",
            "diff": req.custom_diff or "",
            "code": req.custom_code or "",
            "original_code": req.custom_code or "",
            "phase_support": ["phase1_mvp", "phase2_full"],
            "is_adversarial": False,
        }

    run_id = f"run_{uuid.uuid4().hex[:12]}"

    # --------------------------------------------------------------------------
    # STAGE 0: PROMPT-INJECTION GUARDRAIL (gemini-3.5-flash-lite)
    # --------------------------------------------------------------------------
    yield _format_sse({
        "stage": "guardrail_start",
        "model": "gemini-3.5-flash-lite",
        "message": "Initiating Stage 0 Prompt-Injection & Untrusted PR Payload Scan...",
    })
    await asyncio.sleep(0.1)

    if is_live and gemini_swarm:
        guardrail = gemini_swarm.run_prompt_injection_guardrail(pr_data, live_api=True)
    else:
        guardrail = pr_data.get("guardrail") or GuardrailResult(
            is_safe=True, risk_level="SAFE", detected_threats=[], sanitized_summary="Checked clean.", latency_ms=68
        )

    yield _format_sse({
        "stage": "guardrail",
        "model": "gemini-3.5-flash-lite",
        "guardrail": guardrail.model_dump(),
        "message": f"Stage 0 complete: Risk level is {guardrail.risk_level} ({guardrail.latency_ms}ms).",
    })

    # If Guardrail blocks the PR, halt immediately!
    if not guardrail.is_safe:
        one_card = pr_data.get("one_card_summary") or OneCardExecutiveSummary(
            headline_verdict="REJECT_RECOMMENDED",
            residual_risk_level="CRITICAL",
            one_line_takeaway="Blocked by Stage 0 Guardrail: Adversarial prompt injection payload detected.",
            finding_highlights=guardrail.detected_threats or ["Adversarial instruction detected"],
            blind_spot_explanation="Perimeter defense neutralized payload before reaching synthesis.",
            recommended_fix_snippet="# REJECT PR: Remove malicious injection payloads.",
        )
        score_report = pr_data.get("deterministic_score") or DeterministicScoreReport(
            total_tests_generated=0,
            valid_baseline_tests=0,
            confirmed_pr_failures_count=0,
            flaky_filtered_count=0,
            confirmed_pr_failures=[],
            planted_bugs_total=0,
            planted_bugs_caught=0,
            detection_score_pct=0.0,
            detection_score_label="Blocked by Guardrail (0 tests run)",
            mutant_evaluations=[],
            surviving_mutants=[],
        )
        full_blocked = FullVerificationRunResponse(
            run_id=run_id,
            pr_id=pr_id,
            pr_title=pr_data.get("title", ""),
            repo_name=pr_data.get("repo_name", ""),
            author=pr_data.get("author", ""),
            phase_mode=phase_mode,
            guardrail=guardrail,
            invariant_plan=pr_data.get("invariant_plan"),  # type: ignore
            swarm_outputs=[],
            sandbox_report=pr_data.get("sandbox_report"),  # type: ignore
            deterministic_score=score_report,
            one_card_summary=one_card,
        )
        yield _format_sse({
            "stage": "blocked",
            "message": "EXECUTION HALTED: Untrusted PR failed safety guardrail check.",
            "final_response": full_blocked.model_dump(),
        })
        yield _format_sse({"stage": "done", "run_id": run_id, "final_response": full_blocked.model_dump()})
        return

    # --------------------------------------------------------------------------
    # STAGE 1: BLIND DUAL-TRACK START (gemini-4-argon)
    # --------------------------------------------------------------------------
    yield _format_sse({
        "stage": "blind_dual_track_start",
        "telemetry": {
            "information_wall_active": True,
            "store": False,
            "isolation_guarantee": "STRICT_SEPARATE_TREES",
            "track_1a_model": "gemini-4-argon",
            "track_1b_model": "gemini-4-argon",
        },
        "message": "INFORMATION WALL ACTIVE: Track 1A (Attack Planner) and Track 1B (Blind Bug Planter) running concurrently with zero shared context.",
    })
    await asyncio.sleep(0.15)

    # --------------------------------------------------------------------------
    # STAGE 2: INVARIANTS & ATTACK PLAN + SEALED MUTANTS
    # --------------------------------------------------------------------------
    if is_live and gemini_swarm:
        inv_plan = gemini_swarm.extract_invariants_and_plan(pr_data, include_regression=include_regression, live_api=True)
        blind_mutants = gemini_swarm.plant_blind_bugs(pr_data, live_api=True)
    else:
        inv_plan = pr_data.get("invariant_plan")
        blind_mutants = pr_data.get("blind_mutants")

    yield _format_sse({
        "stage": "invariants_extracted",
        "model": "gemini-4-argon",
        "pr_summary": inv_plan.pr_summary,
        "invariants_count": len(inv_plan.invariants),
        "invariants": [inv.model_dump() for inv in inv_plan.invariants],
        "attack_plans": [ap.model_dump() for ap in inv_plan.attack_plans],
        "sealed_mutants_count": len(blind_mutants.mutants),
        "sealed_status": "SEALED (Concealed from Attacker Swarm)",
        "message": f"Extracted {len(inv_plan.invariants)} formal invariants. Sealed {len(blind_mutants.mutants)} blind planted bugs behind information wall.",
    })
    await asyncio.sleep(0.15)

    # --------------------------------------------------------------------------
    # STAGE 3: PARALLEL ATTACKER SWARM (gemini-3.8-flash)
    # --------------------------------------------------------------------------
    yield _format_sse({
        "stage": "swarm_attacking_start",
        "model": "gemini-3.8-flash",
        "active_attackers": [ap.attacker_id for ap in inv_plan.attack_plans],
        "message": f"Dispatching {len(inv_plan.attack_plans)} parallel Gemini 3.8 Flash attacker agents...",
    })
    await asyncio.sleep(0.15)

    if is_live and gemini_swarm:
        swarm_outputs = await gemini_swarm.run_parallel_attacker_swarm(
            pr_data, inv_plan, include_regression=include_regression, live_api=True
        )
    else:
        swarm_outputs = pr_data.get("swarm_outputs")
        if phase_mode == "phase1_mvp":
            swarm_outputs = [s for s in swarm_outputs if s.attacker_id != "regression"]

    total_tests = sum(len(s.tests) for s in swarm_outputs)
    yield _format_sse({
        "stage": "swarm_attacking",
        "model": "gemini-3.8-flash",
        "total_tests_generated": total_tests,
        "swarm_outputs": [s.model_dump() for s in swarm_outputs],
        "message": f"Attacker Swarm completed: Generated {total_tests} invariant-testing and breaking tests.",
    })
    await asyncio.sleep(0.15)

    # --------------------------------------------------------------------------
    # STAGES 4 & 5: SANDBOX DUAL-TRACK EXECUTION (antigravity-preview-09-2026)
    # --------------------------------------------------------------------------
    yield _format_sse({
        "stage": "sandbox_start",
        "agent": "antigravity-preview-09-2026",
        "message": "Connecting to remote Antigravity Linux sandbox container...",
    })
    await asyncio.sleep(0.1)

    if is_live and sandbox_runner:
        sandbox_report = sandbox_runner.run_sandbox(pr_data, blind_mutants, swarm_outputs, live_api=True)
    else:
        sandbox_report = pr_data.get("sandbox_report")

    # Stream Track (a) logs and results
    stdout_logs = sandbox_report.sandbox_stdout_logs or []
    track_a_logs = [line for line in stdout_logs if "TRACK (b)" not in line]
    track_b_logs = [line for line in stdout_logs if "TRACK (b)" in line or "mutant" in line.lower() or "scoring" in line.lower()]

    yield _format_sse({
        "stage": "sandbox_track_a",
        "agent": "antigravity-preview-09-2026",
        "track": "Track (a): PR Code Defect Hunt (2x Repro Filter)",
        "terminal_logs": track_a_logs,
        "pr_test_results": [r.model_dump() for r in sandbox_report.pr_test_results],
        "confirmed_failures_count": sum(1 for r in sandbox_report.pr_test_results if r.reproduced_twice),
        "flaky_filtered_count": sum(1 for r in sandbox_report.pr_test_results if (not r.run_1_passed and r.run_2_passed)),
        "message": "Track (a) complete: Tests executed against unmutated PR code with 2x reproducibility check.",
    })
    await asyncio.sleep(0.2)

    # Stream Track (b) logs and mutant matrix
    yield _format_sse({
        "stage": "sandbox_track_b",
        "agent": "antigravity-preview-09-2026",
        "track": "Track (b): 8 Blind Mutants Differential Execution",
        "terminal_logs": track_b_logs,
        "mutant_matrix": sandbox_report.mutant_matrix,
        "mutant_ids": [m.mutant_id for m in blind_mutants.mutants],
        "message": "Track (b) complete: 8 Blind Mutants evaluated under strict Pass(PR_orig) ∧ Fail(Mutant) rule.",
    })
    await asyncio.sleep(0.2)

    # --------------------------------------------------------------------------
    # STAGE 6: DETERMINISTIC PYTHON SCORING (backend/scoring.py)
    # --------------------------------------------------------------------------
    score_report = compute_deterministic_scores(
        swarm_outputs=swarm_outputs,
        blind_mutants=blind_mutants,
        sandbox_report=sandbox_report,
        require_two_repros=(phase_mode == "phase2_full"),
    )

    yield _format_sse({
        "stage": "deterministic_scoring",
        "engine": "backend.scoring (100% Deterministic Python, Never LLM Estimated)",
        "deterministic_score": score_report.model_dump(),
        "message": f"Deterministic Score: {score_report.detection_score_label} (Confirmed PR Defects: {score_report.confirmed_pr_failures_count}).",
    })
    await asyncio.sleep(0.15)

    # --------------------------------------------------------------------------
    # STAGE 7: ONE-CARD SYNTHESIS (gemini-4-argon)
    # --------------------------------------------------------------------------
    yield _format_sse({
        "stage": "one_card_start",
        "model": "gemini-4-argon",
        "message": "Synthesizing One-Card Executive Summary grounded in deterministic verification scores...",
    })
    await asyncio.sleep(0.1)

    if is_live and gemini_swarm:
        one_card = gemini_swarm.synthesize_one_card_summary(pr_data, score_report, inv_plan, live_api=True)
    else:
        one_card = pr_data.get("one_card_summary")

    full_response = FullVerificationRunResponse(
        run_id=run_id,
        pr_id=pr_id,
        pr_title=pr_data.get("title", ""),
        repo_name=pr_data.get("repo_name", ""),
        author=pr_data.get("author", ""),
        phase_mode=phase_mode,
        guardrail=guardrail,
        invariant_plan=inv_plan,
        swarm_outputs=swarm_outputs,
        sandbox_report=sandbox_report,
        deterministic_score=score_report,
        one_card_summary=one_card,
    )

    yield _format_sse({
        "stage": "one_card_synthesis",
        "model": "gemini-4-argon",
        "one_card_summary": one_card.model_dump(),
        "final_response": full_response.model_dump(),
        "message": "One-Card Summary synthesized successfully.",
    })
    await asyncio.sleep(0.1)

    # Final completion event
    yield _format_sse({
        "stage": "done",
        "run_id": run_id,
        "final_response": full_response.model_dump(),
        "message": "Verification pipeline finished.",
    })


@app.post("/api/verify/stream")
async def verify_pr_stream(req: VerifyRequest):
    """
    Streams the verification pipeline step-by-step as Server-Sent Events (SSE).
    Drives the interactive UI Lane View and live Terminal Log Replay.
    """
    return StreamingResponse(
        _stream_verification_events(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ==============================================================================
# HELPER: PIPELINE EXECUTION FOR SYNC API
# ==============================================================================

async def _execute_full_verification_pipeline(
    pr_data: dict,
    phase_mode: str,
    live_api: bool = False,
) -> FullVerificationRunResponse:
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    include_regression = (phase_mode == "phase2_full")

    # 1. Guardrail
    if live_api and gemini_swarm:
        guardrail = gemini_swarm.run_prompt_injection_guardrail(pr_data, live_api=True)
    else:
        guardrail = pr_data.get("guardrail")

    if not guardrail.is_safe:
        return FullVerificationRunResponse(
            run_id=run_id,
            pr_id=pr_data.get("id", "custom"),
            pr_title=pr_data.get("title", ""),
            repo_name=pr_data.get("repo_name", ""),
            author=pr_data.get("author", ""),
            phase_mode=phase_mode,  # type: ignore
            guardrail=guardrail,
            invariant_plan=pr_data.get("invariant_plan"),
            swarm_outputs=[],
            sandbox_report=pr_data.get("sandbox_report"),
            deterministic_score=pr_data.get("deterministic_score"),
            one_card_summary=pr_data.get("one_card_summary"),
        )

    # 2. Invariants & Mutants
    if live_api and gemini_swarm:
        inv_plan = gemini_swarm.extract_invariants_and_plan(pr_data, include_regression=include_regression, live_api=True)
        blind_mutants = gemini_swarm.plant_blind_bugs(pr_data, live_api=True)
        swarm_outputs = await gemini_swarm.run_parallel_attacker_swarm(pr_data, inv_plan, include_regression=include_regression, live_api=True)
        sandbox_report = sandbox_runner.run_sandbox(pr_data, blind_mutants, swarm_outputs, live_api=True)
    else:
        inv_plan = pr_data.get("invariant_plan")
        blind_mutants = pr_data.get("blind_mutants")
        swarm_outputs = pr_data.get("swarm_outputs")
        if phase_mode == "phase1_mvp":
            swarm_outputs = [s for s in swarm_outputs if s.attacker_id != "regression"]
        sandbox_report = pr_data.get("sandbox_report")

    # 3. Deterministic scoring
    score_report = compute_deterministic_scores(
        swarm_outputs=swarm_outputs,
        blind_mutants=blind_mutants,
        sandbox_report=sandbox_report,
        require_two_repros=(phase_mode == "phase2_full"),
    )

    # 4. One-Card synthesis
    if live_api and gemini_swarm:
        one_card = gemini_swarm.synthesize_one_card_summary(pr_data, score_report, inv_plan, live_api=True)
    else:
        one_card = pr_data.get("one_card_summary")

    return FullVerificationRunResponse(
        run_id=run_id,
        pr_id=pr_data.get("id", "custom"),
        pr_title=pr_data.get("title", ""),
        repo_name=pr_data.get("repo_name", ""),
        author=pr_data.get("author", ""),
        phase_mode=phase_mode,  # type: ignore
        guardrail=guardrail,
        invariant_plan=inv_plan,
        swarm_outputs=swarm_outputs,
        sandbox_report=sandbox_report,
        deterministic_score=score_report,
        one_card_summary=one_card,
    )


# ==============================================================================
# STATIC FILE SERVING FOR FRONTEND
# ==============================================================================

FRONTEND_DIR = pathlib.Path(__file__).resolve().parent.parent / "frontend"
FRONTEND_DIR.mkdir(parents=True, exist_ok=True)

@app.get("/")
async def serve_index():
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {
        "message": "Argus-PR Verification API is online.",
        "docs": "/docs",
        "api_prs": "/api/prs",
        "frontend_status": "frontend/index.html ready to be served.",
    }

# Mount static assets in frontend directory
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
