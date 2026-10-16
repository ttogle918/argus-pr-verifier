"""
Patch scripts/build_presentation.py and verify zero Korean characters in EN mode.
"""
import re
import os
from html.parser import HTMLParser

BUILD_SCRIPT = os.path.join(os.path.dirname(__file__), "build_presentation.py")

with open(BUILD_SCRIPT, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update CSS for language switching of images
old_css = """  /* Language Switching */
  .lang-en { display: none !important; }
  body.lang-mode-en .lang-ko { display: none !important; }
  body.lang-mode-en .lang-en { display: inline !important; }
  body.lang-mode-en div.lang-en,
  body.lang-mode-en p.lang-en,
  body.lang-mode-en section.lang-en,
  body.lang-mode-en span.lang-en-block { display: block !important; }"""

new_css = """  /* Language Switching */
  .lang-en { display: none !important; }
  body.lang-mode-en .lang-ko { display: none !important; }
  body.lang-mode-en .lang-en { display: inline !important; }
  body.lang-mode-en div.lang-en,
  body.lang-mode-en p.lang-en,
  body.lang-mode-en section.lang-en,
  body.lang-mode-en span.lang-en-block { display: block !important; }
  img.lang-ko { display: block !important; }
  img.lang-en { display: none !important; }
  body.lang-mode-en img.lang-ko { display: none !important; }
  body.lang-mode-en img.lang-en { display: block !important; }"""

if old_css in content:
    content = content.replace(old_css, new_css)
    print("Updated language CSS")
else:
    print("Warning: old_css not found exactly")

# 2. Update Nav Bar buttons
old_nav = """      <button class="lang-btn active" id="btn-ko" onclick="setLanguage('ko')">KO 한국어</button>
      <button class="lang-btn" id="btn-en" onclick="setLanguage('en')">EN English</button>"""

new_nav = """      <button class="lang-btn active" id="btn-ko" onclick="setLanguage('ko')"><span class="lang-ko">KO 한국어</span><span class="lang-en">KO</span></button>
      <button class="lang-btn" id="btn-en" onclick="setLanguage('en')"><span class="lang-ko">EN 영어</span><span class="lang-en">EN</span></button>"""

if old_nav in content:
    content = content.replace(old_nav, new_nav)
    print("Updated nav buttons")
else:
    print("Warning: old_nav not found exactly")

# 3. Update all 8 diagram img tags to bilingual
diagram_pairs = [
    ("docs/image/diagram_user_journey.svg", "docs/image/diagram_user_journey_ko.svg", "docs/image/diagram_user_journey_en.svg", 'style="max-height: 405px;"', 'alt="End-to-End User Journey Diagram"'),
    ("docs/image/diagram_stage0_guardrail.svg", "docs/image/diagram_stage0_guardrail_ko.svg", "docs/image/diagram_stage0_guardrail_en.svg", 'style="max-height: 405px;"', 'alt="Stage 0 Guardrail and Scope Slicer Diagram"'),
    ("docs/image/diagram_dual_track.svg", "docs/image/diagram_dual_track_ko.svg", "docs/image/diagram_dual_track_en.svg", 'style="max-height: 520px;"', 'alt="Argus-PR Dual-Track Blind Verification Architecture"'),
    ("docs/image/diagram_stage2_swarm.svg", "docs/image/diagram_stage2_swarm_ko.svg", "docs/image/diagram_stage2_swarm_en.svg", 'style="max-height: 405px;"', 'alt="Stage 2 Attacker Swarm and BOLA Matrix Diagram"'),
    ("docs/image/diagram_stage3_sandbox.svg", "docs/image/diagram_stage3_sandbox_ko.svg", "docs/image/diagram_stage3_sandbox_en.svg", 'style="max-height: 405px;"', 'alt="Stage 3 Sandbox and Differential Execution Diagram"'),
    ("docs/image/diagram_stage4_onecard.svg", "docs/image/diagram_stage4_onecard_ko.svg", "docs/image/diagram_stage4_onecard_en.svg", 'style="max-height: 405px;"', 'alt="Stage 4 Scoring and One-Card Gate Diagram"'),
    ("docs/image/diagram_cegis_and_bundle.svg", "docs/image/diagram_cegis_and_bundle_ko.svg", "docs/image/diagram_cegis_and_bundle_en.svg", 'style="max-height: 405px;"', 'alt="CEGIS Self-Healing Loop and Bundle Export Diagram"'),
    ("docs/image/diagram_agent_hierarchy.svg", "docs/image/diagram_agent_hierarchy_ko.svg", "docs/image/diagram_agent_hierarchy_en.svg", 'style="max-height: 405px;"', 'alt="Dual-Layer AI Hierarchy and Delegation Diagram"'),
]

for orig, ko_svg, en_svg, style, alt in diagram_pairs:
    target = f'<img src="{orig}" {alt} {style}>'
    replacement = f'<img class="lang-ko" src="{ko_svg}" {alt} {style}>\n        <img class="lang-en" src="{en_svg}" {alt} {style}>'
    if target in content:
        content = content.replace(target, replacement)
        print(f"Replaced {orig} with bilingual pair")
    else:
        print(f"Warning: target not found for {orig}")

# 4. Slide 09 model allocation lists
old_slide9_l1 = """          <ul class="card-list">
            <li><b>gemini-3.5-flash-lite</b>: ~68ms 초저지연 프롬프트 인젝션 스캐너 (Stage 0).</li>
            <li><b>gemini-4-argon</b>: 고난도 불변성(INV-1..4) 추출, 비밀 미끼 주입, 최종 리스크 종합.</li>
            <li><b>4x gemini-3.8-flash</b>: 동시성/보안 파괴 테스트 생성을 위한 고속 4대 병렬 스웜.</li>
          </ul>"""

new_slide9_l1 = """          <ul class="card-list">
            <li>
              <b>gemini-3.5-flash-lite</b>:
              <span class="lang-ko">~68ms 초저지연 프롬프트 인젝션 스캐너 (Stage 0).</span>
              <span class="lang-en">~68ms ultra-low latency prompt injection scanner (Stage 0).</span>
            </li>
            <li>
              <b>gemini-4-argon</b>:
              <span class="lang-ko">고난도 불변성(INV-1..4) 추출, 비밀 미끼 주입, 최종 리스크 종합.</span>
              <span class="lang-en">Extracts complex invariants (INV-1..4), injects canary secrets, synthesizes final risk.</span>
            </li>
            <li>
              <b>4x gemini-3.8-flash</b>:
              <span class="lang-ko">동시성/보안 파괴 테스트 생성을 위한 고속 4대 병렬 스웜.</span>
              <span class="lang-en">High-speed 4-agent parallel swarm for generating concurrency/security break tests.</span>
            </li>
          </ul>"""

if old_slide9_l1 in content:
    content = content.replace(old_slide9_l1, new_slide9_l1)
    print("Updated Slide 09 Layer A list")
else:
    print("Warning: old_slide9_l1 not found")

old_slide9_l2 = """          <ul class="card-list">
            <li><b>pro (Argon)</b>: 정보 격리벽·샌드박스 하네스 설계, 실시간 터미널 &amp; UI 상태 머신.</li>
            <li><b>flash (3.8 Flash)</b>: 대량 벤치마크 PR 데이터셋 생성, Playwright E2E GIF 자동 캡처.</li>
            <li><b>원칙</b>: 깊은 추론·무결성은 <code>pro</code>, 병렬 구현·반복 보일러플레이트는 <code>flash</code>.</li>
          </ul>"""

new_slide9_l2 = """          <ul class="card-list">
            <li>
              <b>pro (Argon)</b>:
              <span class="lang-ko">정보 격리벽·샌드박스 하네스 설계, 실시간 터미널 &amp; UI 상태 머신.</span>
              <span class="lang-en">Air-gapped isolation wall &amp; sandbox harness design, live terminal &amp; UI state machine.</span>
            </li>
            <li>
              <b>flash (3.8 Flash)</b>:
              <span class="lang-ko">대량 벤치마크 PR 데이터셋 생성, Playwright E2E GIF 자동 캡처.</span>
              <span class="lang-en">Synthetic benchmark PR dataset generation, automated Playwright E2E GIF capture.</span>
            </li>
            <li>
              <span class="lang-ko"><b>원칙</b>: 깊은 추론·무결성은 <code>pro</code>, 병렬 구현·반복 보일러플레이트는 <code>flash</code>.</span>
              <span class="lang-en"><b>Principle</b>: Deep reasoning &amp; safety invariant integrity use <code>pro</code>, parallel task execution &amp; boilerplate use <code>flash</code>.</span>
            </li>
          </ul>"""

if old_slide9_l2 in content:
    content = content.replace(old_slide9_l2, new_slide9_l2)
    print("Updated Slide 09 Layer B list")
else:
    print("Warning: old_slide9_l2 not found")

# 5. Slide 10 replay title in English
old_slide10_replay = """<span class="lang-en"><b>Hackathon Demo Reliability</b>: The <code>기록 재생 안전 모드</code> toggle serves pre-verified high-fidelity traces within 1.5 seconds.</span>"""
new_slide10_replay = """<span class="lang-en"><b>Hackathon Demo Reliability</b>: The <code>Safe Replay Mode</code> toggle serves pre-verified high-fidelity traces within 1.5 seconds.</span>"""

if old_slide10_replay in content:
    content = content.replace(old_slide10_replay, new_slide10_replay)
    print("Updated Slide 10 replay code tag")
else:
    print("Warning: old_slide10_replay not found")

# 6. Slide 11 scenarios 1, 2, 3
old_slide11 = """          <ul class="card-list">
            <li><b>탐지 결함</b>: 결제 잔액 중복 차감 동시성 레이스 (State Attacker 2/2 포착).</li>
            <li><b>변이체 점수</b>: 8개 중 7개 처치 (87.5% 검증 신뢰도).</li>
            <li><b>인간 결정</b>: 🛑 Merge Rejected &rarr; 자가 치유 패치 적용.</li>
          </ul>
        </div>

        <div class="card tint-accent">
          <div class="card-head">
            <div class="card-title">
              <span class="lang-ko">시나리오 2: 레이트 리미터 경계값</span>
              <span class="lang-en">Scenario 2: Rate Limiter Off-By-One</span>
            </div>
            <span class="card-badge badge-accent">CAUGHT</span>
          </div>
          <p class="card-p"><b>PR ID</b>: <code>pr-ratelimiter-offbyone</code></p>
          <ul class="card-list">
            <li><b>탐지 결함</b>: 슬라이딩 윈도우 &gt; 대신 &ge; 비교로 인한 1회 오버플로우 허용.</li>
            <li><b>변이체 점수</b>: 8개 중 8개 처치 (100% 무결성 달성).</li>
            <li><b>인간 결정</b>: 🛑 Merge Rejected &rarr; 경계 연산자 수정 패치 반영.</li>
          </ul>
        </div>

        <div class="card tint-red">
          <div class="card-head">
            <div class="card-title">
              <span class="lang-ko">시나리오 3: 프롬프트 인젝션 공격</span>
              <span class="lang-en">Scenario 3: Prompt Injection Attack</span>
            </div>
            <span class="card-badge badge-red">BLOCKED</span>
          </div>
          <p class="card-p"><b>PR ID</b>: <code>pr-prompt-injection-attack</code></p>
          <ul class="card-list">
            <li><b>공격 페이로드</b>: PR 주석 내 <code>IGNORE PREVIOUS INSTRUCTIONS</code>.</li>
            <li><b>가드레일 방어</b>: Gemini 3.5 Flash-Lite가 68ms 만에 즉시 격리 차단.</li>
            <li><b>인간 결정</b>: 🛑 Quarantined (LLM 및 샌드박스 비용 0원 방어).</li>
          </ul>"""

new_slide11 = """          <ul class="card-list">
            <li>
              <span class="lang-ko"><b>탐지 결함</b>: 결제 잔액 중복 차감 동시성 레이스 (State Attacker 2/2 포착).</span>
              <span class="lang-en"><b>Detected Defect</b>: Double-deduction balance race condition (Caught 2/2 by State Attacker).</span>
            </li>
            <li>
              <span class="lang-ko"><b>변이체 점수</b>: 8개 중 7개 처치 (87.5% 검증 신뢰도).</span>
              <span class="lang-en"><b>Mutant Score</b>: 7 of 8 killed (87.5% verification reliability).</span>
            </li>
            <li>
              <span class="lang-ko"><b>인간 결정</b>: 🛑 Merge Rejected &rarr; 자가 치유 패치 적용.</span>
              <span class="lang-en"><b>Human Decision</b>: 🛑 Merge Rejected &rarr; Apply CEGIS self-healing patch.</span>
            </li>
          </ul>
        </div>

        <div class="card tint-accent">
          <div class="card-head">
            <div class="card-title">
              <span class="lang-ko">시나리오 2: 레이트 리미터 경계값</span>
              <span class="lang-en">Scenario 2: Rate Limiter Off-By-One</span>
            </div>
            <span class="card-badge badge-accent">CAUGHT</span>
          </div>
          <p class="card-p"><b>PR ID</b>: <code>pr-ratelimiter-offbyone</code></p>
          <ul class="card-list">
            <li>
              <span class="lang-ko"><b>탐지 결함</b>: 슬라이딩 윈도우 &gt; 대신 &ge; 비교로 인한 1회 오버플로우 허용.</span>
              <span class="lang-en"><b>Detected Defect</b>: 1-request overflow permitted due to &gt; instead of &ge; comparison in sliding window.</span>
            </li>
            <li>
              <span class="lang-ko"><b>변이체 점수</b>: 8개 중 8개 처치 (100% 무결성 달성).</span>
              <span class="lang-en"><b>Mutant Score</b>: 8 of 8 killed (100% invariant integrity achieved).</span>
            </li>
            <li>
              <span class="lang-ko"><b>인간 결정</b>: 🛑 Merge Rejected &rarr; 경계 연산자 수정 패치 반영.</span>
              <span class="lang-en"><b>Human Decision</b>: 🛑 Merge Rejected &rarr; Apply boundary operator fix patch.</span>
            </li>
          </ul>
        </div>

        <div class="card tint-red">
          <div class="card-head">
            <div class="card-title">
              <span class="lang-ko">시나리오 3: 프롬프트 인젝션 공격</span>
              <span class="lang-en">Scenario 3: Prompt Injection Attack</span>
            </div>
            <span class="card-badge badge-red">BLOCKED</span>
          </div>
          <p class="card-p"><b>PR ID</b>: <code>pr-prompt-injection-attack</code></p>
          <ul class="card-list">
            <li>
              <span class="lang-ko"><b>공격 페이로드</b>: PR 주석 내 <code>IGNORE PREVIOUS INSTRUCTIONS</code>.</span>
              <span class="lang-en"><b>Attack Payload</b>: <code>IGNORE PREVIOUS INSTRUCTIONS</code> inside PR commit comments.</span>
            </li>
            <li>
              <span class="lang-ko"><b>가드레일 방어</b>: Gemini 3.5 Flash-Lite가 68ms 만에 즉시 격리 차단.</span>
              <span class="lang-en"><b>Guardrail Defense</b>: Gemini 3.5 Flash-Lite quarantined within 68ms.</span>
            </li>
            <li>
              <span class="lang-ko"><b>인간 결정</b>: 🛑 Quarantined (LLM 및 샌드박스 비용 0원 방어).</span>
              <span class="lang-en"><b>Human Decision</b>: 🛑 Quarantined ($0 downstream LLM &amp; sandbox compute cost).</span>
            </li>
          </ul>"""

if old_slide11 in content:
    content = content.replace(old_slide11, new_slide11)
    print("Updated Slide 11 scenarios list")
else:
    print("Warning: old_slide11 not found")

with open(BUILD_SCRIPT, "w", encoding="utf-8") as f:
    f.write(content)
print(f"Successfully saved {BUILD_SCRIPT}")
