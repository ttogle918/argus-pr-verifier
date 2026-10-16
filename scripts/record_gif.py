"""
Argus-PR E2E Verifier, Guided Step (1..7) Video (.webm) & Animated GIF Recorder
Generates both a Playwright video (argus_pr_demo.webm) and high-res animated GIF (argus_pr_demo.gif)
walking through all numbered UI buttons in chronological order:
  🔴 1: PR Diff 보기 (#toggle-diff-btn)
  🔴 2: 블라인드 검증 스웜 실행 (#launch-btn)
  🔴 3: Run Multi-Persona BOLA DAST (#run-live-dast-bola-btn)
  🔴 4 & 🔴 4-1: + 커스텀 버그 심기 & 추가/재계산 (#toggle-mutant-form-btn, #submit-custom-mutant-btn)
  🔴 5: 권장 패치 적용 후 재검증 — Blue-Team CEGIS 4-Gate Loop (#apply-patch-btn)
  🔴 6: Export PR + Pinned Regression Test (#export-bundle-btn)
  🔴 7: 병합 최종 승인 (#approve-btn)
  + Bonus: PR #666 Adversarial Prompt Injection Guardrail Quarantine
"""

import io
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
from PIL import Image
from playwright.sync_api import sync_playwright
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8765
SERVER_URL = f"http://{SERVER_HOST}:{SERVER_PORT}"
HEALTH_URL = f"{SERVER_URL}/api/health"
ROOT_DIR = pathlib.Path(r"c:\Users\ttogl\workspace\google-hack")
OUTPUT_GIF_PATH = ROOT_DIR / "argus_pr_demo.gif"
OUTPUT_WEBM_PATH = ROOT_DIR / "argus_pr_demo.webm"
ARTIFACT_DIR = pathlib.Path(
    r"C:\Users\ttogl\.gemini\antigravity\brain\7c562cfa-8cef-486b-9e3d-21533dd2c29d"
)


def wait_for_server(timeout_sec: float = 20.0) -> bool:
    print(f"[*] Polling {HEALTH_URL} for readiness...", flush=True)
    start_time = time.time()
    session = requests.Session()
    while time.time() - start_time < timeout_sec:
        try:
            resp = session.get(HEALTH_URL, timeout=1.0)
            if resp.status_code == 200:
                print(f"[+] Server is UP and healthy on port {SERVER_PORT}!", flush=True)
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def record_demo():
    print("=" * 74, flush=True)
    print("ARGUS-PR: STARTING GUIDED STEP (1..7) VIDEO (.WEBM) & GIF RECORDER", flush=True)
    print("=" * 74, flush=True)

    # 1. Start FastAPI / Uvicorn server as background subprocess
    print("[1/5] Launching Uvicorn backend server...", flush=True)
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "backend.main:app",
        "--host",
        SERVER_HOST,
        "--port",
        str(SERVER_PORT),
        "--log-level",
        "warning",
    ]
    proc = subprocess.Popen(cmd, cwd=str(ROOT_DIR))

    frames = []
    durations = []  # milliseconds per frame
    temp_video_dir = pathlib.Path(tempfile.mkdtemp(prefix="argus_video_"))

    try:
        if not wait_for_server(20.0):
            raise RuntimeError("FastAPI server failed to start within timeout.")

        # 2. Launch Playwright Headless Chromium with Video Recording enabled
        print("[2/5] Launching Playwright Chromium (viewport 1360x940, video recording ON)...", flush=True)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1360, "height": 940},
                device_scale_factor=1,
                record_video_dir=str(temp_video_dir),
                record_video_size={"width": 1360, "height": 940},
            )
            page = context.new_page()

            def capture_frame(duration_ms=240, save_snapshot_name=None):
                png_bytes = page.screenshot()
                img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
                frames.append(img)
                durations.append(duration_ms)
                if save_snapshot_name and ARTIFACT_DIR.exists():
                    snap_path = ARTIFACT_DIR / save_snapshot_name
                    img.save(str(snap_path))

            def show_step_toast(step_text: str):
                page.evaluate(
                    """(text) => {
                        let banner = document.getElementById('demo-step-floating-toast');
                        if (!banner) {
                            banner = document.createElement('div');
                            banner.id = 'demo-step-floating-toast';
                            banner.style.cssText = [
                                'position:fixed',
                                'top:14px',
                                'left:50%',
                                'transform:translateX(-50%)',
                                'z-index:99999',
                                'background:linear-gradient(135deg, #dc2626, #991b1b)',
                                'color:#ffffff',
                                'font-weight:800',
                                'font-size:0.88rem',
                                'padding:7px 18px',
                                'border-radius:999px',
                                'border:2px solid #fca5a5',
                                'box-shadow:0 6px 24px rgba(239,68,68,0.75)',
                                'letter-spacing:0.3px',
                                'pointer-events:none'
                            ].join(';');
                            document.body.appendChild(banner);
                        }
                        banner.textContent = text;
                    }""",
                    step_text,
                )

            def pulse_and_click(selector: str, step_toast: str, hold_ms: int = 380, snapshot_name=None):
                show_step_toast(step_toast)
                page.locator(selector).scroll_into_view_if_needed()
                page.evaluate(
                    """(sel) => {
                        const el = document.querySelector(sel);
                        if (el) el.classList.add('demo-click-pulse');
                    }""",
                    selector,
                )
                time.sleep(0.25)
                capture_frame(duration_ms=hold_ms, save_snapshot_name=snapshot_name)
                page.click(selector)
                time.sleep(0.20)
                page.evaluate(
                    """(sel) => {
                        const el = document.querySelector(sel);
                        if (el) el.classList.remove('demo-click-pulse');
                    }""",
                    selector,
                )

            # 3. Navigate to Dashboard
            print(f"[3/5] Navigating to {SERVER_URL}/ ...", flush=True)
            page.goto(SERVER_URL, wait_until="networkidle")
            page.wait_for_selector("#scenario-selector")
            page.wait_for_selector("#launch-btn")
            time.sleep(0.6)

            # -------------------------------------------------------------
            # STEP 1: Click 🔴 1 PR Diff 보기 (#toggle-diff-btn)
            # -------------------------------------------------------------
            print("  -> [STEP 1/7] Clicking 🔴 1 #toggle-diff-btn (PR Diff 보기)...", flush=True)
            show_step_toast("🔴 STEP 1 / 7 : PR 시나리오 확인 및 [🔴 1 PR Diff 보기] 클릭")
            capture_frame(duration_ms=550, save_snapshot_name="demo_step_0_initial.png")

            pulse_and_click(
                "#toggle-diff-btn",
                "🔴 STEP 1 / 7 : [🔴 1 PR Diff 보기] 클릭 — 타겟 PR 코드 변경사항 확인",
                hold_ms=450,
                snapshot_name="demo_step_1_diff.png",
            )
            time.sleep(0.35)
            capture_frame(duration_ms=650)

            # Close diff drawer to keep workspace clean
            page.click("#toggle-diff-btn")
            time.sleep(0.25)
            capture_frame(duration_ms=320)

            # -------------------------------------------------------------
            # STEP 2: Click 🔴 2 블라인드 검증 스웜 실행 (#launch-btn)
            # -------------------------------------------------------------
            print("  -> [STEP 2/7] Clicking 🔴 2 #launch-btn (블라인드 검증 스웜 실행)...", flush=True)
            pulse_and_click(
                "#launch-btn",
                "🔴 STEP 2 / 7 : [🔴 2 블라인드 검증 스웜 실행] — Stage 0 → 0.5 → 1A/1B → 2 → 3a/3b → 4",
                hold_ms=420,
                snapshot_name="demo_step_2_launch.png",
            )

            start_verify = time.time()
            while time.time() - start_verify < 8.0:
                capture_frame(duration_ms=220)
                time.sleep(0.20)
                is_done = page.evaluate(
                    "() => !state.isRunning && !document.getElementById('one-card-summary').classList.contains('hidden')"
                )
                if is_done:
                    capture_frame(duration_ms=450)
                    break

            print(f"     Swarm verification completed in {time.time() - start_verify:.2f}s", flush=True)

            # -------------------------------------------------------------
            # STEP 3: Click 🔴 3 Run Multi-Persona BOLA DAST (#run-live-dast-bola-btn)
            # -------------------------------------------------------------
            print("  -> [STEP 3/7] Clicking 🔴 3 #run-live-dast-bola-btn (Multi-Persona BOLA DAST)...", flush=True)
            page.wait_for_selector("#run-live-dast-bola-btn", timeout=5000)
            pulse_and_click(
                "#run-live-dast-bola-btn",
                "🔴 STEP 3 / 7 : [🔴 3 Run Multi-Persona BOLA DAST] — 3개 권한 페르소나 교차 재현",
                hold_ms=450,
            )
            time.sleep(0.55)
            capture_frame(duration_ms=800, save_snapshot_name="demo_step_3_bola_dast.png")

            # -------------------------------------------------------------
            # STEP 4: Click 🔴 4 + 커스텀 버그 심기 (#toggle-mutant-form-btn & #submit-custom-mutant-btn)
            # -------------------------------------------------------------
            print("  -> [STEP 4/7] Clicking 🔴 4 #toggle-mutant-form-btn (+ 커스텀 버그 심기)...", flush=True)
            pulse_and_click(
                "#toggle-mutant-form-btn",
                "🔴 STEP 4 / 7 : [🔴 4 + 커스텀 버그 심기] — Track B 인공 결함 M9 추가 및 M/K 재계산",
                hold_ms=420,
            )
            time.sleep(0.25)
            page.fill("#custom-mutant-title", "Subshell env variable leakage bypass")
            time.sleep(0.20)
            capture_frame(duration_ms=420)

            pulse_and_click(
                "#submit-custom-mutant-btn",
                "🔴 STEP 4-1 / 7 : [🔴 4-1 추가 & 재계산] 클릭 — M/K 점수 실시간 재산출 (7/8 → 8/9)",
                hold_ms=420,
                snapshot_name="demo_step_4_custom_mutant.png",
            )
            time.sleep(0.45)
            capture_frame(duration_ms=650)

            # -------------------------------------------------------------
            # STEP 5: Click 🔴 5 권장 패치 적용 후 재검증 (#apply-patch-btn)
            # -------------------------------------------------------------
            print("  -> [STEP 5/7] Clicking 🔴 5 #apply-patch-btn (Blue-Team CEGIS 4-Gate Loop)...", flush=True)
            pulse_and_click(
                "#apply-patch-btn",
                "🔴 STEP 5 / 7 : [🔴 5 권장 패치 적용 후 재검증] — Blue-Team CEGIS 4-Gate 자동 패치 루프",
                hold_ms=450,
            )
            time.sleep(0.65)
            page.locator("#cegis-patch-banner").scroll_into_view_if_needed()
            time.sleep(0.25)
            capture_frame(duration_ms=900, save_snapshot_name="demo_step_5_cegis_patch.png")

            # -------------------------------------------------------------
            # STEP 6: Click 🔴 6 Export PR + Pinned Regression Test (#export-bundle-btn)
            # -------------------------------------------------------------
            print("  -> [STEP 6/7] Clicking 🔴 6 #export-bundle-btn (Export PR + Pinned Regression Test)...", flush=True)
            pulse_and_click(
                "#export-bundle-btn",
                "🔴 STEP 6 / 7 : [🔴 6 Export PR + Pinned Regression Test] — PROVEN 회귀 테스트 & CI 번들 추출",
                hold_ms=450,
            )
            time.sleep(0.55)
            capture_frame(duration_ms=950, save_snapshot_name="demo_step_6_export_bundle.png")

            # Close bundle modal
            page.click("#close-export-bundle-modal-btn")
            time.sleep(0.30)
            capture_frame(duration_ms=350)

            # -------------------------------------------------------------
            # STEP 7: Click 🔴 7 병합 최종 승인 (#approve-btn)
            # -------------------------------------------------------------
            print("  -> [STEP 7/7] Clicking 🔴 7 #approve-btn (Human Merge Gate Approval)...", flush=True)
            pulse_and_click(
                "#approve-btn",
                "🔴 STEP 7 / 7 : [🔴 7 병합 최종 승인] — 패치 검증 완료 후 휴먼 머지 게이트 최종 승인",
                hold_ms=450,
            )
            time.sleep(0.35)
            page.locator("#one-card-summary").scroll_into_view_if_needed()
            time.sleep(0.20)
            capture_frame(duration_ms=950, save_snapshot_name="demo_step_7_approved.png")

            # -------------------------------------------------------------
            # BONUS: Stage 0 Adversarial Prompt Injection Guardrail (PR #666)
            # -------------------------------------------------------------
            print("  -> [BONUS] Testing PR #666 Stage 0 Prompt Injection Guardrail...", flush=True)
            page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
            show_step_toast("🛡️ BONUS : PR #666 적대적 프롬프트 인젝션 → Stage 0 즉시 차단 검증")
            time.sleep(0.20)
            page.select_option("#scenario-selector", "pr-prompt-injection-attack")
            time.sleep(0.25)
            capture_frame(duration_ms=420)

            pulse_and_click(
                "#launch-btn",
                "🛡️ BONUS : [🔴 2 블라인드 검증 스웜 실행] → Stage 0 (gemini-3.5-flash-lite) 인젝션 즉시 격리",
                hold_ms=380,
            )
            for _ in range(8):
                time.sleep(0.16)
                capture_frame(duration_ms=220)
                is_blocked = page.evaluate(
                    "() => document.getElementById('guardrail-banner').classList.contains('blocked')"
                )
                if is_blocked:
                    break

            capture_frame(duration_ms=1100, save_snapshot_name="demo_step_8_guardrail_blocked.png")
            time.sleep(0.5)

            # Close page & context so Playwright flushes the .webm video file
            page.close()
            context.close()
            browser.close()

        # Copy the recorded .webm video to OUTPUT_WEBM_PATH and ARTIFACT_DIR
        recorded_videos = list(temp_video_dir.glob("*.webm"))
        if recorded_videos:
            shutil.copy2(str(recorded_videos[0]), str(OUTPUT_WEBM_PATH))
            webm_size_mb = OUTPUT_WEBM_PATH.stat().st_size / (1024 * 1024)
            print(f"[+] Successfully saved Playwright video: {OUTPUT_WEBM_PATH} ({webm_size_mb:.2f} MB)", flush=True)
            if ARTIFACT_DIR.exists():
                shutil.copy2(str(OUTPUT_WEBM_PATH), str(ARTIFACT_DIR / "argus_pr_demo.webm"))

        # 4. Assemble GIF with PIL
        print(f"[4/5] Assembling {len(frames)} frames into animated GIF...", flush=True)
        total_time_ms = sum(durations)
        print(f"     Total GIF runtime: {total_time_ms / 1000.0:.2f} seconds across {len(frames)} frames.", flush=True)

        quantized_frames = [
            f.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
            for f in frames
        ]

        OUTPUT_GIF_PATH.parent.mkdir(parents=True, exist_ok=True)
        quantized_frames[0].save(
            str(OUTPUT_GIF_PATH),
            save_all=True,
            append_images=quantized_frames[1:],
            duration=durations,
            loop=0,
            optimize=True,
        )

        gif_size_mb = OUTPUT_GIF_PATH.stat().st_size / (1024 * 1024)
        print(f"[+] Successfully generated GIF: {OUTPUT_GIF_PATH} ({gif_size_mb:.2f} MB)", flush=True)
        if ARTIFACT_DIR.exists():
            shutil.copy2(str(OUTPUT_GIF_PATH), str(ARTIFACT_DIR / "argus_pr_demo.gif"))

    finally:
        # 5. Cleanly terminate uvicorn server and temp video dir
        print("[5/5] Terminating background Uvicorn server...", flush=True)
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=4.0)
            except subprocess.TimeoutExpired:
                proc.kill()
        shutil.rmtree(str(temp_video_dir), ignore_errors=True)
        print("[+] Backend server stopped cleanly.", flush=True)

    print("=" * 74, flush=True)
    print("ARGUS-PR GUIDED DEMO VIDEO (.WEBM) & GIF RECORDING COMPLETE!", flush=True)
    print("=" * 74, flush=True)


if __name__ == "__main__":
    record_demo()
