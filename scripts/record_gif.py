"""
Argus-PR E2E Verifier & Lane-View GIF Recorder
Generates a high-resolution animated GIF demo capturing:
1. Initial State & PR Diff Inspection (PR #412)
2. Launch Blind Verification Swarm (Stage 0 -> Stage 1 -> Stage 2 -> Stage 3a -> Stage 3b -> Stage 4)
3. One-Card Human Review & Merge Rejection
4. Bonus Adversarial Guardrail Demo (PR #666 Prompt Injection blocked by gemini-3.5-flash-lite)
"""

import io
import os
import pathlib
import subprocess
import sys
import time
from PIL import Image
from playwright.sync_api import sync_playwright
import requests

SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8765
SERVER_URL = f"http://{SERVER_HOST}:{SERVER_PORT}"
HEALTH_URL = f"{SERVER_URL}/api/health"
OUTPUT_GIF_PATH = pathlib.Path(r"c:\Users\ttogl\workspace\google-hack\argus_pr_demo.gif")


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


def record_demo_gif():
    print("=" * 70, flush=True)
    print("ARGUS-PR: STARTING E2E VERIFIER & LANE-VIEW GIF RECORDER", flush=True)
    print("=" * 70, flush=True)

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
    proc = subprocess.Popen(cmd, cwd=r"c:\Users\ttogl\workspace\google-hack")

    frames = []
    durations = []  # milliseconds per frame

    try:
        if not wait_for_server(20.0):
            raise RuntimeError("FastAPI server failed to start within timeout.")

        # 2. Launch Playwright Headless Chromium
        print("[2/5] Launching Playwright Chromium Headless (viewport 1360x940)...", flush=True)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1360, "height": 940},
                device_scale_factor=1,
            )
            page = context.new_page()

            def capture_frame(duration_ms=220):
                png_bytes = page.screenshot()
                img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
                frames.append(img)
                durations.append(duration_ms)

            # 3. Navigate to Dashboard
            print(f"[3/5] Navigating to {SERVER_URL}/ ...", flush=True)
            page.goto(SERVER_URL, wait_until="networkidle")
            page.wait_for_selector("#scenario-selector")
            page.wait_for_selector("#launch-btn")
            time.sleep(0.6)  # allow UI fonts and sample PRs to settle

            # -------------------------------------------------------------
            # Frame Set 1: Initial State & PR Diff Inspection
            # -------------------------------------------------------------
            print("  -> Frame Set 1: Initial state & PR diff inspection...", flush=True)
            capture_frame(duration_ms=650)  # Hold on initial state

            # Open PR diff drawer
            page.click("#toggle-diff-btn")
            time.sleep(0.35)
            capture_frame(duration_ms=500)
            capture_frame(duration_ms=500)

            # Close PR diff drawer so Swimlanes & Terminal are fully visible
            page.click("#toggle-diff-btn")
            time.sleep(0.35)
            capture_frame(duration_ms=400)

            # -------------------------------------------------------------
            # Frame Set 2: Launch Blind Verification Swarm (Swimlane & Terminal)
            # -------------------------------------------------------------
            print("  -> Frame Set 2: Launching Blind Verification Swarm for PR #412...", flush=True)
            page.click("#launch-btn")

            # Capture screenshots every ~220ms while verification progresses
            start_verify = time.time()
            one_card_shown = False
            while time.time() - start_verify < 7.0:
                capture_frame(duration_ms=220)
                time.sleep(0.20)
                # Check if One-Card summary is now displayed
                is_hidden = page.evaluate("() => document.getElementById('one-card-summary').classList.contains('hidden')")
                if not is_hidden:
                    one_card_shown = True
                    # Capture 2 more frames showing the newly appeared summary in lane context
                    capture_frame(duration_ms=300)
                    capture_frame(duration_ms=300)
                    break

            print(f"     Verification swarm completed in {time.time() - start_verify:.2f}s (one_card_shown={one_card_shown})", flush=True)

            # -------------------------------------------------------------
            # Frame Set 3: One-Card Human Review & Merge Rejection
            # -------------------------------------------------------------
            print("  -> Frame Set 3: Scrolling smoothly to One-Card Executive Summary...", flush=True)
            # Smooth scroll down to one-card-summary
            for scroll_y in [250, 500, 750, 950]:
                page.evaluate(f"window.scrollTo({{ top: {scroll_y}, behavior: 'instant' }})")
                time.sleep(0.12)
                capture_frame(duration_ms=180)

            page.locator("#one-card-summary").scroll_into_view_if_needed()
            time.sleep(0.2)
            capture_frame(duration_ms=550)  # Hold to read metrics
            capture_frame(duration_ms=550)

            # Click Reject Merge & Request Fixes
            print("     Clicking #reject-btn (Human Decision: REJECT_MERGE)...", flush=True)
            page.click("#reject-btn")
            time.sleep(0.3)
            # Capture the red rejection stamp and hold on it
            capture_frame(duration_ms=650)
            capture_frame(duration_ms=950)  # Final decision hold

            # -------------------------------------------------------------
            # Frame Set 4: Bonus Adversarial Guardrail Demo
            # -------------------------------------------------------------
            print("  -> Frame Set 4: Bonus Adversarial Prompt Injection Guardrail Demo...", flush=True)
            # Scroll back to top
            for scroll_y in [600, 250, 0]:
                page.evaluate(f"window.scrollTo({{ top: {scroll_y}, behavior: 'instant' }})")
                time.sleep(0.10)
                capture_frame(duration_ms=150)

            # Select scenario PR #666
            print("     Selecting 'pr-prompt-injection-attack'...", flush=True)
            page.select_option("#scenario-selector", "pr-prompt-injection-attack")
            time.sleep(0.25)
            capture_frame(duration_ms=450)

            # Launch swarm to trigger Stage 0 guardrail quarantine
            print("     Clicking #launch-btn to test Stage 0 Guardrail...", flush=True)
            page.click("#launch-btn")

            # Capture progression as gemini-3.5-flash-lite intercepts and halts
            for _ in range(8):
                time.sleep(0.16)
                capture_frame(duration_ms=220)
                # Check if banner is blocked
                is_blocked = page.evaluate("() => document.getElementById('guardrail-banner').classList.contains('blocked')")
                if is_blocked:
                    break

            # Hold on the crimson quarantine banner
            capture_frame(duration_ms=800)
            capture_frame(duration_ms=1100)

            browser.close()

        # 4. Assemble GIF with PIL
        print(f"[4/5] Assembling {len(frames)} frames into animated GIF...", flush=True)
        total_time_ms = sum(durations)
        print(f"     Total GIF runtime: {total_time_ms / 1000.0:.2f} seconds across {len(frames)} frames.", flush=True)

        # Optimize palette quantization for ultra crisp visuals
        quantized_frames = []
        for i, f in enumerate(frames):
            q = f.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
            quantized_frames.append(q)

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
        print(f"[+] Successfully generated: {OUTPUT_GIF_PATH}", flush=True)
        print(f"    Size: {gif_size_mb:.2f} MB", flush=True)

        # Guard against >10MB
        if gif_size_mb > 10.0:
            print("[!] File > 10MB, re-optimizing with scale 0.9x...", flush=True)
            scaled_frames = [
                f.resize((int(f.width * 0.9), int(f.height * 0.9)), Image.Resampling.BILINEAR)
                for f in frames
            ]
            q_scaled = [
                sf.quantize(colors=216, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
                for sf in scaled_frames
            ]
            q_scaled[0].save(
                str(OUTPUT_GIF_PATH),
                save_all=True,
                append_images=q_scaled[1:],
                duration=durations,
                loop=0,
                optimize=True,
            )
            gif_size_mb = OUTPUT_GIF_PATH.stat().st_size / (1024 * 1024)
            print(f"[+] Re-optimized Size: {gif_size_mb:.2f} MB", flush=True)

    finally:
        # 5. Cleanly terminate uvicorn server
        print("[5/5] Terminating background Uvicorn server...", flush=True)
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=4.0)
            except subprocess.TimeoutExpired:
                proc.kill()
        print("[+] Backend server stopped cleanly.", flush=True)

    print("=" * 70, flush=True)
    print("ARGUS-PR DEMO GIF RECORDING COMPLETE!", flush=True)
    print("=" * 70, flush=True)


if __name__ == "__main__":
    record_demo_gif()
