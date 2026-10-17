"""Headless end-to-end check of the redesigned frontend against a local server.

Usage: .venv/Scripts/python.exe scripts/e2e_frontend.py
Screenshots go to $ARGUS_E2E_SHOTS (default: <tmp>/argus-e2e).
"""
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import expect, sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
SHOTS = pathlib.Path(os.environ.get("ARGUS_E2E_SHOTS", pathlib.Path(tempfile.gettempdir()) / "argus-e2e"))
HANGUL = re.compile(r"[가-힣]")
RUN_TIMEOUT = 30_000


def start_server(db_path):
    env = {**os.environ, "ARGUS_DB_PATH": str(db_path)}
    env.pop("GEMINI_API_KEY", None)
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", str(PORT)],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    for _ in range(150):
        try:
            socket.create_connection(("127.0.0.1", PORT), 0.2).close()
            return proc
        except OSError:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("server did not start")


def tid(page, name):
    return page.get_by_test_id(name)


def no_hangul(page, where):
    text = page.locator("body").inner_text()
    found = HANGUL.findall(text)
    assert not found, f"Hangul on {where}: {''.join(found[:20])}"


def run_pr(page, pr_id, phase="phase2_full"):
    tid(page, "nav-start").click()
    page.locator(f'[data-testid="pr-option"][data-pr-id="{pr_id}"]').click()
    page.locator(f'[data-testid="phase-option"][data-value="{phase}"]').click()
    tid(page, "run-button").click()
    expect(page.locator("#view-run")).to_be_visible()


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    tmp = pathlib.Path(tempfile.mkdtemp())
    shutil.copy(ROOT / "backend" / "argus_pr.db", tmp / "argus.db")
    server = start_server(tmp / "argus.db")
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.on("console", lambda m: errors.append(f"{m.text} [{m.location.get('url', '')}]") if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.set_default_timeout(10_000)

            # Start
            page.goto(BASE + "/")
            expect(page).to_have_title("Argus-PR")
            expect(page.locator('[data-testid="pr-option"]')).to_have_count(5)
            expect(tid(page, "nav-verify")).to_have_attribute("aria-disabled", "true")
            no_hangul(page, "start")
            page.screenshot(path=str(SHOTS / "1-start-1440.png"), full_page=True)

            # Import overlay opens, switches tabs, closes with Escape
            tid(page, "open-import").click()
            dialog = page.locator('[data-overlay="import"]')
            expect(dialog).to_be_visible()
            page.locator('[data-testid="import-tab"][data-tab="github"]').click()
            expect(tid(page, "github-url")).to_be_visible()
            page.locator('[data-testid="import-tab"][data-tab="paste"]').click()
            tid(page, "fill-injection-sample").click()
            expect(tid(page, "paste-diff")).to_have_value(re.compile("SYSTEM OVERRIDE"))
            no_hangul(page, "import overlay")
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()

            # Phase 2 run of PR #412
            run_pr(page, "pr-checkout-race")
            expect(tid(page, "caught-counter")).to_have_text("7/8", timeout=RUN_TIMEOUT)
            expect(tid(page, "run-status")).to_contain_text("Complete", timeout=RUN_TIMEOUT)
            expect(tid(page, "mode-chip")).to_contain_text("REPLAY")
            expect(tid(page, "sample-chip")).to_be_visible()
            expect(page.locator('[data-testid="lane"]')).to_have_count(4)
            expect(page.locator('[data-testid="lane-test"]')).to_have_count(10)
            expect(page.locator('[data-testid="lane-test"][data-outcome="breach"]')).to_have_count(2)
            expect(page.locator('[data-testid="lane-test"][data-outcome="flaky"]')).to_have_count(1)
            expect(page.locator('#view-run [data-testid="scene-eye"][data-state="caught"]')).to_have_count(7)
            expect(page.locator('#view-run [data-testid="scene-eye"][data-mutant-id="M8"]').first).to_have_attribute("data-state", "survived")
            expect(page.locator('[data-testid="stage"][data-state="done"]')).to_have_count(7)
            page.locator('[data-testid="log-filter"][data-filter="b"]').click()
            assert page.locator('[data-testid="log-line"]').count() > 0
            assert page.locator('[data-testid="log-line"][data-track="A"]').count() == 0
            no_hangul(page, "run")
            page.screenshot(path=str(SHOTS / "2-run-1440.png"), full_page=True)
            page.set_viewport_size({"width": 1280, "height": 720})
            page.screenshot(path=str(SHOTS / "2-run-1280x720.png"))
            page.set_viewport_size({"width": 1440, "height": 900})

            # Run details + live DAST
            tid(page, "open-run-details").click()
            expect(page.locator('[data-overlay="run-details"]')).to_be_visible()
            expect(page.locator('[data-testid="invariant-item"]')).to_have_count(8)
            tid(page, "dast-run").click()
            expect(page.locator('[data-testid="dast-row"]')).to_have_count(3, timeout=15_000)
            expect(page.locator('[data-testid="dast-row"][data-verdict="PROVEN_BOLA_BYPASS"]')).to_have_count(1)
            page.keyboard.press("Escape")

            # Verify
            tid(page, "continue-verify").first.click()
            expect(page.locator("#view-verify")).to_be_visible()
            expect(tid(page, "score-big")).to_have_text("7/8")
            expect(page.locator('[data-testid="matrix-cell"]')).to_have_count(80)
            expect(page.locator('[data-testid="matrix-cell"][data-state="caught"]')).to_have_count(7)
            expect(page.locator('[data-testid="matrix-cell"][data-state="invalid"]')).to_have_count(24)
            expect(page.locator('[data-testid="mutant-verdict"][data-mutant-id="M8"]')).to_have_attribute("data-verdict", "survived")
            page.locator('[data-testid="matrix-col"][data-mutant-id="M3"]').click()
            expect(tid(page, "mutant-detail")).to_contain_text("Off-by-one")
            no_hangul(page, "verify")
            page.screenshot(path=str(SHOTS / "3-verify-1440.png"), full_page=True)

            # Decide: reject, change, apply patch, export, download
            tid(page, "continue-decide").click()
            expect(tid(page, "score-hero")).to_have_text("7/8")
            expect(tid(page, "verdict-chip")).to_contain_text("Reject recommended")
            expect(page.locator('[data-testid="defect-card"]')).to_have_count(2)
            expect(page.locator('[data-testid="finding"]')).to_have_count(4)
            no_hangul(page, "decide")
            page.screenshot(path=str(SHOTS / "4-decide-1440.png"), full_page=True)
            tid(page, "reject-button").click()
            expect(tid(page, "decision-stamp")).to_have_attribute("data-status", "saved")
            expect(tid(page, "decision-stamp")).to_have_attribute("data-decision", "REJECT_MERGE")
            tid(page, "change-decision").click()
            expect(tid(page, "approve-button")).to_be_visible()
            tid(page, "apply-patch").click()
            expect(page.locator('[data-testid="patch-attempt"]')).to_have_count(2, timeout=15_000)
            expect(page.locator('[data-testid="patch-attempt"][data-status="VERIFIED"]')).to_have_count(1)
            expect(tid(page, "score-hero")).to_have_text("8/8")
            tid(page, "open-export").click()
            expect(page.locator('[data-overlay="export"]')).to_be_visible()
            expect(tid(page, "export-code")).to_contain_text("def test_", timeout=15_000)
            page.locator('[data-testid="export-tab"][data-tab="ci"]').click()
            expect(tid(page, "export-code")).to_contain_text("pytest")
            page.keyboard.press("Escape")
            with page.expect_download() as dl:
                tid(page, "download-report").click()
            assert dl.value.suggested_filename == "argus-pr-report-pr-checkout-race.json"

            # Calibration mutant (add-mutant persists M9 into the server's pr-checkout-race sample for this
            # server session, so later checks avoid asserting that PR's mutant count)
            tid(page, "nav-verify").click()
            tid(page, "open-mutant-form").click()
            tid(page, "mutant-title").fill("Negative fee bypass on partial refunds")
            page.locator('[data-testid="mutant-outcome"][data-value="survived"]').click()
            tid(page, "mutant-submit").click()
            expect(page.locator('[data-testid="mutant-verdict"]')).to_have_count(9, timeout=15_000)

            # Blocked PR
            run_pr(page, "pr-prompt-injection-attack")
            expect(tid(page, "blocked-panel")).to_be_visible(timeout=RUN_TIMEOUT)
            expect(page.locator('[data-testid="blocked-threat"]')).to_have_count(3)
            expect(tid(page, "nav-verify")).to_have_attribute("aria-disabled", "true")
            page.screenshot(path=str(SHOTS / "5-blocked-1440.png"), full_page=True)

            # Phase 1
            run_pr(page, "pr-checkout-race", phase="phase1_mvp")
            expect(tid(page, "run-status")).to_contain_text("Complete", timeout=RUN_TIMEOUT)
            expect(page.locator('[data-testid="lane"]')).to_have_count(3)
            expect(page.locator('[data-testid="lane-test"][data-outcome="breach"]')).to_have_count(3)

            # Stream error + retry
            mark = len(errors)
            page.route("**/api/verify/stream", lambda route: route.abort())
            run_pr(page, "pr-ratelimiter-offbyone")
            expect(tid(page, "error-panel")).to_be_visible(timeout=RUN_TIMEOUT)
            page.unroute("**/api/verify/stream")
            errors[mark:] = [e for e in errors[mark:] if "ERR_FAILED" not in e]  # intentional abort
            tid(page, "retry-button").click()
            expect(tid(page, "run-status")).to_contain_text("Complete", timeout=RUN_TIMEOUT)
            expect(tid(page, "caught-counter")).to_have_text("6/8")

            # Korean toggle keeps the finished run and translates the chrome; English comes back clean
            tid(page, "lang-ko").click()
            expect(page.locator("html")).to_have_attribute("lang", "ko")
            expect(tid(page, "lang-ko")).to_be_focused()
            expect(tid(page, "nav-run")).to_contain_text("실행")
            expect(tid(page, "caught-counter")).to_have_text("6/8")
            page.screenshot(path=str(SHOTS / "7-run-ko-1440.png"), full_page=True)
            tid(page, "nav-verify").click()
            page.screenshot(path=str(SHOTS / "8-verify-ko-1440.png"), full_page=True)
            tid(page, "nav-decide").click()
            page.screenshot(path=str(SHOTS / "9-decide-ko-1440.png"), full_page=True)
            tid(page, "lang-en").click()
            expect(page.locator("html")).to_have_attribute("lang", "en")
            no_hangul(page, "decide after switching back to English")

            # Reduced motion still completes (not pr-checkout-race: add-mutant changed its server-side sample)
            rm = browser.new_page(viewport={"width": 1280, "height": 720}, reduced_motion="reduce")
            rm.on("pageerror", lambda e: errors.append(str(e)))
            rm.goto(BASE + "/")
            rm.locator('[data-testid="pr-option"][data-pr-id="pr-cisco-sandbox-bypass"]').click()
            rm.get_by_test_id("run-button").click()
            expect(rm.get_by_test_id("caught-counter")).to_have_text("7/8", timeout=RUN_TIMEOUT)
            rm.screenshot(path=str(SHOTS / "6-run-reduced-motion-1280x720.png"))
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
        shutil.rmtree(tmp, ignore_errors=True)

    real_errors = [e for e in errors if "fonts.g" not in e]
    assert not real_errors, f"console errors: {real_errors}"
    print(f"E2E passed. Screenshots in {SHOTS}")


if __name__ == "__main__":
    main()
