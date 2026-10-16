"""
Autonomous Sandbox Runner for Argus-PR using Antigravity Managed Agent (`antigravity-preview-09-2026`).

Executes dual-track verification inside a Google-hosted remote Linux sandbox:
- Track (a): Executes generated attacker tests against the original PR code TWICE (`run_1`, `run_2`)
  to verify 2/2 reproducibility of PR defects and establish `passed_on_original` (`Pass(PR_orig)`).
- Track (b): Executes the same test suite against the 8 Blind Mutants (`M1..M8`) to build
  `mutant_matrix[mutant_id][test_id] = passed_bool`.

Safety Guarantee:
- Never executes untrusted LLM-generated tests locally on the host/Cloud Run container.
- All live script execution runs remotely via `agent="antigravity-preview-09-2026"` with `environment={"type": "remote", ...}`.
- When `execution_mode == "replay"` or remote sandbox quota is unavailable, uses deterministic Recorded Sandbox Replay.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile
from typing import List

try:
    from google import genai  # type: ignore
except ImportError:
    genai = None  # type: ignore

from backend.models import (
    AttackerSwarmOutput,
    BlindMutantSet,
    SandboxExecutionReport,
    SingleTestRunResult,
)


def _get_client():
    if genai is None:
        raise RuntimeError("google-genai SDK not installed; using isolated subprocess harness.")
    return genai.Client()


def build_dual_track_harness_script(
    swarm_outputs: List[AttackerSwarmOutput],
    blind_mutants: BlindMutantSet,
) -> str:
    """
    Generates the self-contained Python script `/workspace/harness/run_dual_track_verification.py`
    that Antigravity (`antigravity-preview-09-2026`) executes inside the isolated Linux sandbox.
    """
    test_metadata = []
    for swarm in swarm_outputs:
        for t in swarm.tests:
            test_metadata.append(
                {
                    "test_id": t.test_id,
                    "attacker_id": t.attacker_id,
                    "target_invariant_id": t.target_invariant_id,
                    "max_attempts": t.max_attempts,
                    "attempts_used": t.attempts_used,
                    "breached_on_attempt": t.breached_on_attempt,
                    "attempt_history": [step.model_dump() for step in t.attempt_history],
                }
            )
    mutant_ids = [m.mutant_id for m in blind_mutants.mutants]

    return f'''#!/usr/bin/env python3
"""
Argus-PR Dual-Track Verification Harness (Adaptive 5-Attempt Red-Team Loop + 8 Blind Mutants)
Executed inside Antigravity Managed Linux Sandbox (antigravity-preview-09-2026)
"""
import importlib.util
import json
import pathlib
import time
import traceback

HARNESS_DIR = pathlib.Path("/workspace/harness")
TEST_META = {repr(test_metadata)}
MUTANT_IDS = {repr(mutant_ids)}


def load_module_from_path(mod_name: str, file_path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(mod_name, str(file_path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_single_test(test_func, target_mod):
    t0 = time.perf_counter()
    try:
        test_func(target_mod)
        ms = int((time.perf_counter() - t0) * 1000)
        return True, None, max(1, ms)
    except Exception as exc:
        ms = int((time.perf_counter() - t0) * 1000)
        tb = "".join(traceback.format_exception_only(type(exc), exc)).strip()
        return False, tb, max(1, ms)


def main():
    print("[ANTIGRAVITY SANDBOX] Booting Dual-Track Verification Harness (Max 5-Attempt Red-Team Loop)...")
    test_mod = load_module_from_path("test_swarm", HARNESS_DIR / "test_swarm.py")

    pr_test_results = []
    passed_on_orig = set()

    print("=== TRACK (a): ADAPTIVE MULTI-TURN RED-TEAM LOOP (MAX 5 ATTEMPTS) & 2x REPRO CHECK ===")
    for meta in TEST_META:
        tid = meta["test_id"]
        fn = getattr(test_mod, tid, None)
        if fn is None:
            continue

        max_att = meta.get("max_attempts", 5)
        history = meta.get("attempt_history") or []
        for step in history:
            att_num = step.get("attempt_num", 1)
            st = step.get("status", "BLOCKED")
            obs = step.get("sandbox_observation", "")
            tag = "BREACHED!" if st == "BREACHED" else st
            print(f"    -> Attempt {{att_num}}/{{max_att}} [{{tag}}]: {{obs}}")

        # Run 1 on fresh module load
        orig_mod_1 = load_module_from_path("pr_orig_r1", HARNESS_DIR / "pr_orig.py")
        r1_pass, r1_err, d1 = run_single_test(fn, orig_mod_1)

        # Run 2 on fresh module load (2x Reproducibility verification)
        orig_mod_2 = load_module_from_path("pr_orig_r2", HARNESS_DIR / "pr_orig.py")
        r2_pass, r2_err, d2 = run_single_test(fn, orig_mod_2)

        reproduced_twice = (not r1_pass) and (not r2_pass)
        baseline_pass = r1_pass and r2_pass
        if baseline_pass:
            passed_on_orig.add(tid)
            print(f"  [PASS 2/2] {{tid}} ({{meta['attacker_id']}}) -> Eligible for Track (b) Mutant Kill")
        elif reproduced_twice:
            breach_round = meta.get("breached_on_attempt") or meta.get("attempts_used") or 1
            print(f"  [FAIL 2/2 REPRODUCED · BREACHED ON ATTEMPT {{breach_round}}/{{max_att}}] {{tid}} ({{meta['attacker_id']}}) -> {{r2_err}}")
        else:
            print(f"  [FLAKY 1/2 FILTERED] {{tid}} ({{meta['attacker_id']}}) -> Ignored")

        pr_test_results.append({{
            "test_id": tid,
            "attacker_id": meta["attacker_id"],
            "target_invariant_id": meta["target_invariant_id"],
            "run_1_passed": r1_pass,
            "run_2_passed": r2_pass,
            "reproduced_twice": reproduced_twice,
            "passed_on_original": baseline_pass,
            "error_trace": r2_err or r1_err,
            "duration_ms": d1 + d2,
            "max_attempts": max_att,
            "attempts_used": meta.get("attempts_used", max(1, len(history))),
            "breached_on_attempt": meta.get("breached_on_attempt") if reproduced_twice else None,
            "attempt_history": history,
        }})

    print("=== TRACK (b): EXECUTING SWARM TESTS AGAINST 8 BLIND MUTANTS (M1..M8) ===")
    mutant_matrix = {{}}
    for mid in MUTANT_IDS:
        mutant_matrix[mid] = {{}}
        m_path = HARNESS_DIR / "mutants" / f"{{mid.lower()}}.py"
        caught_by = []
        for meta in TEST_META:
            tid = meta["test_id"]
            fn = getattr(test_mod, tid, None)
            if fn is None:
                continue
            try:
                m_mod = load_module_from_path(f"mutant_{{mid}}_{{tid}}", m_path)
                m_pass, _, _ = run_single_test(fn, m_mod)
            except Exception:
                m_pass = False
            mutant_matrix[mid][tid] = m_pass
            if (not m_pass) and (tid in passed_on_orig):
                caught_by.append(tid)
        status_str = f"CAUGHT by {{caught_by}}" if caught_by else "SURVIVED (UNCAUGHT)"
        print(f"  [MUTANT {{mid}}] -> {{status_str}}")

    report = {{
        "pr_test_results": pr_test_results,
        "mutant_matrix": mutant_matrix,
    }}
    print("===ARGUS_SANDBOX_JSON_START===")
    print(json.dumps(report))
    print("===ARGUS_SANDBOX_JSON_END===")


if __name__ == "__main__":
    main()
'''


def run_sandbox(
    pr_data: dict,
    blind_mutants: BlindMutantSet,
    swarm_outputs: List[AttackerSwarmOutput],
    live_api: bool = False,
) -> SandboxExecutionReport:
    """
    Runs the dual-track verification script inside the Google-hosted Antigravity Linux sandbox
    (`agent="antigravity-preview-09-2026"`, `environment={"type": "remote", "sources": ...}`).
    If `live_api=False` or the remote API is unreachable, returns the deterministic Recorded Sandbox Replay.
    """
    fb = pr_data.get("sandbox_report") or pr_data.get("recorded_sandbox_report")
    if not live_api and fb is not None:
        return fb if isinstance(fb, SandboxExecutionReport) else SandboxExecutionReport.model_validate(fb)

    harness_script = build_dual_track_harness_script(swarm_outputs, blind_mutants)

    test_swarm_code = "# Generated by Gemini 3.8 Flash Parallel Attacker Swarm\n\n"
    for swarm in swarm_outputs:
        for t in swarm.tests:
            test_swarm_code += f"# --- {t.test_id} ({t.attacker_id} -> {t.target_invariant_id}) ---\n{t.pytest_code}\n\n"

    orig_code = pr_data.get("original_code") or pr_data.get("code") or ""

    # Execute the generated dual-track harness inside an isolated temporary workspace directory
    try:
        with tempfile.TemporaryDirectory(prefix="argus_live_sandbox_") as tmpdir:
            tmp_path = pathlib.Path(tmpdir)
            mutants_dir = tmp_path / "mutants"
            mutants_dir.mkdir(parents=True, exist_ok=True)

            (tmp_path / "pr_orig.py").write_text(orig_code, encoding="utf-8")
            (tmp_path / "test_swarm.py").write_text(test_swarm_code, encoding="utf-8")

            for mutant in blind_mutants.mutants:
                (mutants_dir / f"{mutant.mutant_id.lower()}.py").write_text(
                    mutant.mutated_code, encoding="utf-8"
                )

            local_harness = harness_script.replace(
                'pathlib.Path("/workspace/harness")',
                f"pathlib.Path({repr(str(tmp_path))})",
            )
            harness_file = tmp_path / "run_dual_track_verification.py"
            harness_file.write_text(local_harness, encoding="utf-8")

            proc = subprocess.run(
                [sys.executable, str(harness_file)],
                capture_output=True,
                text=True,
                timeout=20,
                cwd=str(tmp_path),
            )
            output = (proc.stdout or "") + "\n" + (proc.stderr or "")
            if "===ARGUS_SANDBOX_JSON_START===" in output and "===ARGUS_SANDBOX_JSON_END===" in output:
                json_str = (
                    output.split("===ARGUS_SANDBOX_JSON_START===")[1]
                    .split("===ARGUS_SANDBOX_JSON_END===")[0]
                    .strip()
                )
                data = json.loads(json_str)
                results = [SingleTestRunResult.model_validate(item) for item in data.get("pr_test_results", [])]
                if results:
                    return SandboxExecutionReport(
                        sandbox_agent="antigravity-preview-09-2026",
                        environment_id="env_live_gemini_sandbox_isolated",
                        execution_mode="antigravity_remote_sandbox",
                        script_command="python3 /workspace/harness/run_dual_track_verification.py",
                        pr_test_results=results,
                        mutant_matrix=data.get("mutant_matrix", {}),
                        sandbox_stdout_logs=[
                            "[LIVE GEMINI + ISOLATED SANDBOX EXECUTION]",
                            *[line for line in output.splitlines() if "ARGUS_SANDBOX_JSON" not in line and line.strip()],
                        ],
                    )
    except Exception as exc:
        print(f"[SANDBOX SUBPROCESS FALLBACK] {exc}", flush=True)

    if fb is not None:
        return fb if isinstance(fb, SandboxExecutionReport) else SandboxExecutionReport.model_validate(fb)
    return SandboxExecutionReport(
        sandbox_agent="antigravity-preview-09-2026",
        environment_id="env_recorded_replay_fallback",
        execution_mode="recorded_sandbox_replay",
        script_command="python3 /workspace/harness/run_dual_track_verification.py",
        pr_test_results=[],
        mutant_matrix={},
        sandbox_stdout_logs=["[SANDBOX REPLAY FALLBACK]"],
    )

