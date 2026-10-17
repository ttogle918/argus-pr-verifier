"""
Lightweight SQLite persistence engine for Argus-PR (`backend/argus_pr.db`).

Designed to be self-contained, zero-dependency (uses Python built-in `sqlite3`),
and small enough to commit directly into Git and package into Cloud Run containers.

Persists:
1. `pr_benchmarks` — Curated sample PRs + imported GitHub PRs + user custom PRs
2. `verification_runs` — Historical blind verification runs & deterministic M/K scores
3. `human_decisions` — Final human tech-lead merge decisions (APPROVE_MERGE / REJECT_MERGE)
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import pathlib
import sqlite3
from typing import Any, Dict, List, Optional

DB_PATH = pathlib.Path(os.environ.get("ARGUS_DB_PATH") or pathlib.Path(__file__).resolve().parent / "argus_pr.db")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(sample_prs: Optional[Dict[str, dict]] = None) -> None:
    """Creates SQLite tables if they do not exist and seeds initial benchmark records."""
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS pr_benchmarks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                author TEXT NOT NULL,
                description TEXT NOT NULL,
                diff TEXT NOT NULL,
                code TEXT NOT NULL,
                is_adversarial INTEGER NOT NULL DEFAULT 0,
                is_builtin INTEGER NOT NULL DEFAULT 0,
                scope_triage_json TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS verification_runs (
                run_id TEXT PRIMARY KEY,
                pr_id TEXT NOT NULL,
                pr_title TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                phase_mode TEXT NOT NULL,
                scope_mode TEXT NOT NULL,
                headline_verdict TEXT NOT NULL,
                confirmed_pr_failures_count INTEGER NOT NULL DEFAULT 0,
                planted_bugs_caught INTEGER NOT NULL DEFAULT 0,
                planted_bugs_total INTEGER NOT NULL DEFAULT 0,
                detection_score_pct REAL NOT NULL DEFAULT 0.0,
                detection_score_label TEXT NOT NULL,
                response_json TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS human_decisions (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                pr_id TEXT NOT NULL,
                decision TEXT NOT NULL,
                reviewer_notes TEXT NOT NULL DEFAULT '',
                reviewer TEXT NOT NULL DEFAULT 'Human Tech Lead',
                recorded_at TEXT NOT NULL
            );
            """
        )

        now_iso = datetime.now(timezone.utc).isoformat()

        if sample_prs:
            for pr_id, item in sample_prs.items():
                scope_triage = item.get("scope_triage")
                scope_json = (
                    json.dumps(scope_triage.model_dump())
                    if hasattr(scope_triage, "model_dump")
                    else (json.dumps(scope_triage) if isinstance(scope_triage, dict) else None)
                )
                conn.execute(
                    """
                    INSERT OR REPLACE INTO pr_benchmarks (
                        id, title, repo_name, author, description, diff, code,
                        is_adversarial, is_builtin, scope_triage_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, COALESCE(
                        (SELECT created_at FROM pr_benchmarks WHERE id = ?), ?
                    ))
                    """,
                    (
                        pr_id,
                        item.get("title", ""),
                        item.get("repo_name", ""),
                        item.get("author", ""),
                        item.get("description", ""),
                        item.get("diff", ""),
                        item.get("code", ""),
                        1 if item.get("is_adversarial") else 0,
                        scope_json,
                        pr_id,
                        now_iso,
                    ),
                )

        # Seed initial human review audit trail if empty
        cur = conn.execute("SELECT COUNT(*) AS cnt FROM human_decisions")
        row = cur.fetchone()
        if row and row["cnt"] == 0:
            seed_decisions = [
                (
                    "dec_seed_cisco03",
                    "run_seed_cisco_pr3",
                    "pr-cisco-sandbox-bypass",
                    "REJECT_MERGE",
                    "Blocked merge: Attacker Swarm breached check_command_safety() on Attempt 2/5 via escaped quote pipeline injection and python3 -c RCE.",
                    "Security Lead (Seed Audit)",
                    "2026-10-16T03:15:00+00:00",
                ),
                (
                    "dec_seed_cisco06",
                    "run_seed_cisco_pr6",
                    "pr-cisco-scoring-divzero",
                    "REJECT_MERGE",
                    "Hold merge until ZeroDivisionError guard on line_overlap_Count and precision/recall clamping [0.0, 1.0] are applied.",
                    "Benchmark Maintainer (Seed Audit)",
                    "2026-10-16T03:20:00+00:00",
                ),
            ]
            conn.executemany(
                """
                INSERT INTO human_decisions (
                    id, run_id, pr_id, decision, reviewer_notes, reviewer, recorded_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                seed_decisions,
            )
        conn.commit()


def save_custom_pr(entry: dict, is_builtin: bool = False) -> None:
    """Saves an imported GitHub PR or custom PR into SQLite."""
    now_iso = datetime.now(timezone.utc).isoformat()
    scope_triage = entry.get("scope_triage")
    scope_json = (
        json.dumps(scope_triage.model_dump())
        if hasattr(scope_triage, "model_dump")
        else (json.dumps(scope_triage) if isinstance(scope_triage, dict) else None)
    )
    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO pr_benchmarks (
                id, title, repo_name, author, description, diff, code,
                is_adversarial, is_builtin, scope_triage_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry["id"],
                entry.get("title", ""),
                entry.get("repo_name", ""),
                entry.get("author", ""),
                entry.get("description", ""),
                entry.get("diff", ""),
                entry.get("code", ""),
                1 if entry.get("is_adversarial") else 0,
                1 if is_builtin else 0,
                scope_json,
                now_iso,
            ),
        )
        conn.commit()


def load_saved_custom_prs() -> List[Dict[str, Any]]:
    """Loads non-builtin custom/GitHub PRs persisted in SQLite across restarts."""
    if not DB_PATH.exists():
        return []
    with get_connection() as conn:
        cur = conn.execute(
            "SELECT * FROM pr_benchmarks WHERE is_builtin = 0 ORDER BY created_at DESC"
        )
        rows = [dict(r) for r in cur.fetchall()]
    return rows


def save_verification_run(full_response: Any) -> None:
    """Persists a completed FullVerificationRunResponse into SQLite."""
    payload = (
        full_response.model_dump()
        if hasattr(full_response, "model_dump")
        else full_response
    )
    score = payload.get("deterministic_score") or {}
    one_card = payload.get("one_card_summary") or {}
    scope = payload.get("scope_triage") or {}
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO verification_runs (
                run_id, pr_id, pr_title, repo_name, phase_mode, scope_mode,
                headline_verdict, confirmed_pr_failures_count,
                planted_bugs_caught, planted_bugs_total,
                detection_score_pct, detection_score_label,
                response_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.get("run_id", "run_unknown"),
                payload.get("pr_id", ""),
                payload.get("pr_title", ""),
                payload.get("repo_name", ""),
                payload.get("phase_mode", "phase2_full"),
                scope.get("scope_mode", "SINGLE_FILE_UNIT"),
                one_card.get("headline_verdict", "CAUTION_REVIEW"),
                int(score.get("confirmed_pr_failures_count", 0)),
                int(score.get("planted_bugs_caught", 0)),
                int(score.get("planted_bugs_total", 0)),
                float(score.get("detection_score_pct", 0.0)),
                str(score.get("detection_score_label", "")),
                json.dumps(payload),
                now_iso,
            ),
        )
        conn.commit()


def list_verification_runs(limit: int = 25) -> List[Dict[str, Any]]:
    """Lists recent verification runs stored in SQLite (excluding heavy response_json)."""
    if not DB_PATH.exists():
        return []
    with get_connection() as conn:
        cur = conn.execute(
            """
            SELECT run_id, pr_id, pr_title, repo_name, phase_mode, scope_mode,
                   headline_verdict, confirmed_pr_failures_count,
                   planted_bugs_caught, planted_bugs_total,
                   detection_score_pct, detection_score_label, created_at
            FROM verification_runs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [dict(r) for r in cur.fetchall()]


def save_human_decision(record: Dict[str, Any]) -> None:
    """Persists a human reviewer decision (APPROVE_MERGE / REJECT_MERGE) into SQLite."""
    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO human_decisions (
                id, run_id, pr_id, decision, reviewer_notes, reviewer, recorded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["id"],
                record["run_id"],
                record["pr_id"],
                record["decision"],
                record.get("reviewer_notes") or "",
                record.get("reviewer") or "Human Tech Lead",
                record["recorded_at"],
            ),
        )
        conn.commit()


def list_human_decisions_from_db() -> List[Dict[str, Any]]:
    """Returns all human reviewer decisions ordered newest-first."""
    if not DB_PATH.exists():
        return []
    with get_connection() as conn:
        cur = conn.execute(
            "SELECT id, run_id, pr_id, decision, reviewer_notes, reviewer, recorded_at "
            "FROM human_decisions ORDER BY recorded_at DESC"
        )
        return [dict(r) for r in cur.fetchall()]
