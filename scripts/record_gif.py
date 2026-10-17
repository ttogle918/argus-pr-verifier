"""Record the guided Argus-PR demo (steps 1..7 + bonus) as a .webm video, an animated GIF and step screenshots.

Usage:
  .venv/Scripts/python.exe scripts/record_gif.py --lang en   # argus_pr_demo.{gif,webm}, docs/screenshots/*.png
  .venv/Scripts/python.exe scripts/record_gif.py --lang ko   # argus_pr_demo_ko.{gif,webm}, docs/screenshots/ko/*.png

Starts its own server on a copy of backend/argus_pr.db, so the tracked database is never modified.
The Korean recording starts in English and switches with the header EN/KO toggle.
"""
import argparse
import io
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time

from PIL import Image
from playwright.sync_api import expect, sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[1]
PORT = 8766
BASE = f"http://127.0.0.1:{PORT}"
VIEWPORT = {"width": 1440, "height": 900}
GIF_WIDTH = 960
RUN_TIMEOUT = 30_000

CAPTIONS = {
    "en": {
        "start": "Argus-PR · pick a sample PR",
        "lang": "EN / KO toggle in the header",
        "diff": "1 · View the PR diff",
        "run": "2 · Run the blind verification swarm",
        "dast": "3 · Live DAST: multi-persona BOLA check",
        "verify": "Verify: tests × 8 hidden mutants",
        "mutant": "4 · Plant a calibration mutant (M9)",
        "patch": "5 · Apply the fix and re-verify (4-gate loop)",
        "export": "6 · Export PR + pinned regression test",
        "approve": "7 · Human approval gate",
        "blocked": "Bonus · Prompt-injection PR blocked at Stage 0",
    },
    "ko": {
        "start": "Argus-PR · 샘플 PR 선택",
        "lang": "헤더의 EN / KO 토글로 한국어 전환",
        "diff": "1 · PR diff 보기",
        "run": "2 · 블라인드 검증 Swarm 실행",
        "dast": "3 · Live DAST: 멀티 페르소나 BOLA 검사",
        "verify": "검증: 테스트 × 숨겨진 mutant 8개",
        "mutant": "4 · 보정용 mutant(M9) 심기",
        "patch": "5 · 수정 적용 & 재검증 (4-gate 루프)",
        "export": "6 · PR + 고정 회귀 테스트 내보내기",
        "approve": "7 · 사람이 최종 승인",
        "blocked": "보너스 · Prompt injection PR, Stage 0에서 차단",
    },
}

CAPTION_JS = """(text) => {
  let el = document.getElementById('demo-caption');
  if (!el) {
    el = document.createElement('div');
    el.id = 'demo-caption';
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;'
      + 'padding:10px 18px;border-radius:8px;background:rgba(13,15,18,0.92);border:1px solid #4A525C;'
      + 'color:#F2F4F6;font:600 18px/1.3 "IBM Plex Sans","IBM Plex Sans KR",sans-serif;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = !text;
}"""


def start_server(db_path):
    env = {**os.environ, "ARGUS_DB_PATH": str(db_path)}
    env.pop("GEMINI_API_KEY", None)
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", str(PORT)],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    for _ in range(300):
        try:
            socket.create_connection(("127.0.0.1", PORT), 0.2).close()
            return proc
        except OSError:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("server did not start")


class Recorder:
    def __init__(self, page, lang, shots_dir):
        self.page = page
        self.lang = lang
        self.shots_dir = shots_dir
        self.frames = []
        self.durations = []
        self.t0 = time.time()
        self.chapters = []

    def tid(self, name):
        return self.page.get_by_test_id(name)

    def caption(self, key):
        if key:
            self.chapters.append((round(time.time() - self.t0, 1), CAPTIONS[self.lang][key]))
        self.page.evaluate(CAPTION_JS, CAPTIONS[self.lang][key] if key else "")

    def frame(self, ms=250):
        img = Image.open(io.BytesIO(self.page.screenshot())).convert("RGB")
        img = img.resize((GIF_WIDTH, round(img.height * GIF_WIDTH / img.width)), Image.LANCZOS)
        self.frames.append(img)
        self.durations.append(ms)

    def hold(self, ms):
        time.sleep(ms / 1000)
        self.frame(ms)

    def snapshot(self, name):
        """Doc screenshot without the caption, then a GIF frame with it."""
        self.page.evaluate(CAPTION_JS, "")
        self.page.screenshot(path=str(self.shots_dir / name))
        self.frame(200)

    def film_until(self, done, max_s=30, step_ms=300):
        end = time.time() + max_s
        while time.time() < end:
            self.frame(step_ms)
            if done():
                return
            time.sleep(step_ms / 1000)
        raise TimeoutError("condition not reached while filming")

    def save_gif(self, path):
        palette_frames = [f.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in self.frames]
        palette_frames[0].save(path, save_all=True, append_images=palette_frames[1:], duration=self.durations,
                               loop=0, optimize=True, disposal=1)


def record(lang):
    suffix = "" if lang == "en" else "_ko"
    shots_dir = ROOT / "docs" / "screenshots" / ("" if lang == "en" else "ko")
    shots_dir.mkdir(parents=True, exist_ok=True)
    tmp = pathlib.Path(tempfile.mkdtemp())
    shutil.copy(ROOT / "backend" / "argus_pr.db", tmp / "argus.db")
    server = start_server(tmp / "argus.db")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(viewport=VIEWPORT, record_video_dir=str(tmp / "video"), record_video_size=VIEWPORT)
            page = context.new_page()
            page.set_default_timeout(15_000)
            r = Recorder(page, lang, shots_dir)
            tid = r.tid

            # Start
            page.goto(BASE + "/")
            expect(page.locator('[data-testid="pr-option"]')).to_have_count(5)
            page.wait_for_timeout(600)
            if lang == "ko":
                r.caption("lang")
                r.hold(900)
                tid("lang-ko").click()
                expect(page.locator("html")).to_have_attribute("lang", "ko")
                page.wait_for_timeout(300)
            r.caption("start")
            page.locator('[data-testid="pr-option"][data-pr-id="pr-checkout-race"]').click()
            r.hold(900)
            r.snapshot("demo_step_0_initial.png")

            # 1 · diff
            r.caption("diff")
            tid("open-diff").click()
            expect(page.locator('[data-overlay="diff"]')).to_be_visible()
            r.hold(1200)
            r.snapshot("demo_step_1_diff.png")
            page.keyboard.press("Escape")

            # 2 · run
            r.caption("run")
            page.locator('[data-testid="phase-option"][data-value="phase2_full"]').click()
            tid("run-button").click()
            expect(page.locator("#view-run")).to_be_visible()
            r.film_until(lambda: page.evaluate("window.__argus.store.getState().run.status") == "complete")
            expect(tid("caught-counter")).to_have_text("7/8", timeout=RUN_TIMEOUT)
            r.hold(1200)
            r.snapshot("demo_step_2_launch.png")

            # 3 · live DAST
            r.caption("dast")
            tid("open-run-details").click()
            expect(page.locator('[data-overlay="run-details"]')).to_be_visible()
            tid("dast-run").scroll_into_view_if_needed()
            r.hold(500)
            tid("dast-run").click()
            r.film_until(lambda: page.locator('[data-testid="dast-row"]').count() == 3, max_s=15)
            page.wait_for_timeout(300)
            r.hold(1200)
            r.snapshot("demo_step_3_bola_dast.png")
            page.keyboard.press("Escape")

            # Verify matrix
            r.caption("verify")
            tid("continue-verify").first.click()
            expect(tid("score-big")).to_have_text("7/8")
            for _ in range(4):
                r.hold(300)
            page.locator('[data-testid="matrix-col"][data-mutant-id="M8"]').click()
            r.hold(1200)
            r.snapshot("demo_step_3_bola_matrix.png")

            # 4 · calibration mutant
            r.caption("mutant")
            tid("open-mutant-form").click()
            expect(page.locator('[data-overlay="mutant"]')).to_be_visible()
            tid("mutant-title").fill("Negative fee bypass on partial refunds")
            r.hold(700)
            page.locator('[data-testid="mutant-outcome"][data-value="survived"]').click()
            r.hold(700)
            tid("mutant-submit").click()
            expect(page.locator('[data-testid="mutant-verdict"]')).to_have_count(9, timeout=15_000)
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(400)
            r.hold(1300)
            r.snapshot("demo_step_4_custom_mutant.png")

            # 5 · patch loop
            r.caption("patch")
            tid("continue-decide").click()
            expect(tid("score-hero")).to_be_visible()
            r.hold(1300)
            r.snapshot("demo_step_4_blind_mutants.png")
            tid("apply-patch").scroll_into_view_if_needed()
            tid("apply-patch").click()
            r.film_until(lambda: page.locator('[data-testid="patch-attempt"]').count() == 2, max_s=20)
            tid("patch-section").scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            r.hold(1500)
            r.snapshot("demo_step_5_cegis_patch.png")

            # 6 · export
            r.caption("export")
            tid("open-export").click()
            expect(page.locator('[data-overlay="export"]')).to_be_visible()
            expect(tid("export-code")).to_contain_text("def test_", timeout=15_000)
            r.hold(1300)
            r.snapshot("demo_step_6_export_bundle.png")
            page.locator('[data-testid="export-tab"][data-tab="ci"]').click()
            r.hold(1100)
            page.keyboard.press("Escape")

            # 7 · approve
            r.caption("approve")
            tid("reviewer-note").scroll_into_view_if_needed()
            tid("reviewer-note").fill("Patch verified 4/4 gates; M9 tracked as follow-up.")
            r.hold(700)
            tid("approve-button").click()
            expect(tid("decision-stamp")).to_have_attribute("data-status", "saved")
            tid("decision-stamp").scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            r.hold(1500)
            r.snapshot("demo_step_7_approved.png")

            # Bonus · blocked PR
            r.caption("blocked")
            tid("nav-start").click()
            page.locator('[data-testid="pr-option"][data-pr-id="pr-prompt-injection-attack"]').click()
            r.hold(700)
            tid("run-button").click()
            r.film_until(lambda: tid("blocked-panel").is_visible(), max_s=20)
            page.wait_for_timeout(400)
            r.hold(1800)
            r.snapshot("demo_step_8_guardrail_blocked.png")
            r.caption(None)

            page.close()
            video_path = page.video.path()
            context.close()
            browser.close()

        shutil.copy(video_path, ROOT / f"argus_pr_demo{suffix}.webm")
        r.save_gif(ROOT / f"argus_pr_demo{suffix}.gif")
        print(f"[{lang}] {len(r.frames)} frames, {sum(r.durations) / 1000:.1f}s; "
              f"argus_pr_demo{suffix}.gif, argus_pr_demo{suffix}.webm, screenshots in {shots_dir.relative_to(ROOT)}")
        for at, text in r.chapters:
            print(f"  {at:6.1f}s  {text}")
    finally:
        server.terminate()
        server.wait(timeout=10)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=["en", "ko"], default="en")
    record(parser.parse_args().lang)
