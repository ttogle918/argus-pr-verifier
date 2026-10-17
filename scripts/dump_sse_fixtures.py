"""Dump recorded-replay SSE streams to JSON fixtures for the frontend unit tests."""
import asyncio
import json
import os
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.pop("GEMINI_API_KEY", None)
# Importing backend.main initializes the SQLite DB; keep the tracked one untouched.
os.environ["ARGUS_DB_PATH"] = str(pathlib.Path(tempfile.mkdtemp()) / "fixtures.db")

from backend.main import VerifyRequest, _stream_verification_events  # noqa: E402

OUT = ROOT / "tests" / "frontend" / "fixtures"
CASES = {
    "checkout-race-phase2": VerifyRequest(pr_id="pr-checkout-race", phase_mode="phase2_full"),
    "checkout-race-phase1": VerifyRequest(pr_id="pr-checkout-race", phase_mode="phase1_mvp"),
    "prompt-injection-blocked": VerifyRequest(pr_id="pr-prompt-injection-attack", phase_mode="phase2_full"),
}


async def collect(req):
    events = []
    async for chunk in _stream_verification_events(req):
        for frame in chunk.split("\n\n"):
            if frame.startswith("data: "):
                events.append(json.loads(frame[len("data: "):]))
    return events


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, req in CASES.items():
        events = asyncio.run(collect(req))
        first = events[0]
        assert first["stage"] == "guardrail_start", first["stage"]
        assert first.get("execution_mode") == "replay", "guardrail_start must report execution_mode"
        assert events[-1]["stage"] == "done"
        (OUT / f"{name}.json").write_text(json.dumps(events, indent=1), encoding="utf-8")
        print(f"{name}: {len(events)} events")


if __name__ == "__main__":
    main()
