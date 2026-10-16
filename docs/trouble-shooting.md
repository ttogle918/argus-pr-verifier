# ARGUS-PR 트러블슈팅 로그 (Troubleshooting Guide)

본 문서는 **ARGUS-PR (Blind Dual-Track Red-Team Swarm & Meta-Verifier)** 개발 및 Live Gemini API 연동 테스트 과정에서 발생한 주요 이슈와 원인 분석, 그리고 해결 방법을 기록합니다.

---

## 1. Live API 실행 시 단계별 UI 흐름도(Stepper/Swimlane) 멈춤 및 일괄 렌더링 현상, LLM 타임아웃/빈 응답, 샌드박스 폴백 이슈

### 1-1. 증상 (Symptoms)
Live Gemini API 모드로 검증 파이프라인 실행 시 다음과 같은 서버/터미널 로그와 UI 현상이 관찰됨:

```text
[LIVE GEMINI OK] model=gemini-3.5-flash-lite elapsed=1964ms bytes=282
[LIVE GEMINI OK] model=gemini-4-argon elapsed=24597ms bytes=4233
[LIVE GEMINI OK] model=gemini-4-argon elapsed=93520ms bytes=39094
[LIVE GEMINI OK] model=gemini-3.8-flash elapsed=11351ms bytes=5264
[LIVE GEMINI OK] model=gemini-3.8-flash elapsed=29912ms bytes=6642
[SWARM security FALLBACK] Gemini call failed for gemini-3.8-flash: Empty candidates from gemini-3.8-flash
[SWARM edge_cases FALLBACK] Gemini call failed for gemini-3.8-flash: Empty candidates from gemini-3.8-flash
[LIVE GEMINI OK] model=gemini-4-argon elapsed=13591ms bytes=2389
```

1. **화면 흐름도 멈춤 현상**: 백엔드에서 Stage 0 → Stage 1A → Stage 1B → Stage 2 순으로 LLM 작업이 하나씩 완료되고 있음에도, 프런트엔드 상단 흐름도(Stepper & Topology)와 좌/우 스윔레인이 실시간으로 넘어가지 않고 멈춰 있다가 모든 작업(~130초)이 끝난 뒤에야 한꺼번에 렌더링됨.
2. **Track 1B (`plant_blind_bugs`) 과도한 지연 (93.5초 소요)**: `gemini-4-argon`이 8개의 변이 버그(`M1..M8`)를 생성할 때 응답 크기가 `39,094 bytes`에 달하며 약 94초가 소요됨.
3. **Swarm 공격 에이전트 `Empty candidates` 폴백**: 4개의 병렬 `gemini-3.8-flash` 공격 에이전트 중 `security`, `edge_cases` 에이전트에서 `Empty candidates from gemini-3.8-flash` 예외가 발생하며 사전 녹화된 테스트로 폴백됨.
4. **터미널 로그 `agent="undefined"` 및 샌드박스 통째 폴백 현상**:
   * 터미널 로그에 `[Sandbox] Launching agent="undefined"`로 표시됨.
   * LLM이 생성한 테스트 코드 중 하나라도 마크다운 코드펜스(````python`)를 포함하거나 함수명이 `test_id`와 미세하게 다르면 `test_swarm.py` 전체 모듈 임포트가 실패하여 Recorded Replay 데이터로 통째 폴백됨.
   * *(참고)* 터미널에 출력된 `[BLOCKED]` → `[BREACHED]` → `Run 1=FAIL, Run 2=FAIL (2/2 REPRODUCED!)` 로그는 시스템 에러가 아니라 **Red-Team 공격 에이전트가 최대 5회 변이 루프(Observe-Mutate-Attack)를 통해 대상 PR의 방어 로직을 실제로 뚫고 취약점 2회 연속 재현에 성공했음을 나타내는 정상 검증 결과**임.

---

### 1-2. 원인 분석 (Root Cause)

| 구분 | 원인 상세 | 관련 파일 |
| :--- | :--- | :--- |
| **① UI 실시간 미반영** | 백엔드에 실시간 스트리밍용 `POST /api/verify/stream`(SSE)이 구현되어 있었으나, 프런트엔드 `runVerificationFlow()`가 동기식 단일 응답 엔드포인트인 `POST /api/verify`를 호출하고 있었음. 또한 `_stream_verification_events()` 내부에서도 `swarm_attacking` 이벤트가 샌드박스 실행 이후에 yield 되도록 순서가 밀려 있었음. | `frontend/app.js`<br>`backend/main.py` |
| **② Track 1B 93.5초 지연** | `plant_blind_bugs()`가 원본 파이썬 파일 전체를 8번 복제(`M1..M8`의 `mutated_code`)하면서 원본의 긴 주석과 독스트링(`"""..."""`)까지 그대로 8번 반복 출력하여 출력 JSON 토큰이 ~40KB로 비대해짐. | `backend/gemini_swarm.py` |
| **③ `Empty candidates` 에러** | `security` 및 `edge_cases` 에이전트가 셸 인젝션/권한 우회 등 Red-Team 공격 페이로드가 포함된 `pytest` 코드를 생성할 때, Gemini API의 기본 Safety Filter에 의해 `candidates`가 빈 배열로 차단됨. 또한 빈 응답 발생 시 다음 폴백 모델(`MODEL_FALLBACK_MAP`)로 넘어가지 않고 `break`로 루프를 탈출함. | `backend/gemini_swarm.py` |
| **④ `agent="undefined"` 및 샌드박스 폴백** | `SandboxExecutionReport` 모델의 필드명은 `sandbox_agent`인데 프런트엔드가 `sandbox_agent_id`를 참조함. 또한 `sandbox_runner.py`에서 모든 에이전트의 `pytest_code`를 단일 `test_swarm.py`로 단순 결합 후 `getattr(test_mod, tid)`로 호출하여, 한 테스트의 문법 오류나 마크다운 펜스가 전체 실행 실패 및 Replay 폴백을 유발함. | `backend/sandbox_runner.py`<br>`frontend/app.js` |

---

### 1-3. 조치 및 해결 내용 (Resolution)

1. **프런트엔드-백엔드 실시간 SSE 스트리밍 연동 및 파이프라인 오버랩 (`frontend/app.js`, `backend/main.py`)**
   * `runVerificationFlow()`가 `POST /api/verify/stream`을 호출하고 `ReadableStream` 리더(`res.body.getReader()`)로 각 Stage 완료 이벤트를 받는 즉시 `setStepState()`, 스윔레인 카드, 터미널 로그를 실시간 업데이트하도록 수정.
   * **Track 1A → Track 2 즉시 파이프라이닝**: Track 1A(`extract_invariants_and_plan`)가 끝나자마자 Track 1B(`plant_blind_bugs`) 완료를 기다리지 않고 즉시 `track_1a_complete` SSE를 전송해 왼쪽 스윔레인(Invariants)을 먼저 렌더링하고, 동시에 Stage 2(`run_parallel_attacker_swarm`)를 시작하도록 개선.
   * `asyncio.wait(..., return_when=asyncio.FIRST_COMPLETED)`를 사용해 Track 1B와 Track 2 중 먼저 끝나는 작업부터 즉시 화면에 반영하고, 샌드박스 실행 전에 `swarm_attacking` 이벤트가 즉시 전송되도록 수정.

2. **Track 1B 출력 토큰 다이어트 (`backend/gemini_swarm.py`)**
   * `plant_blind_bugs()` 시스템 프롬프트에 각 `mutated_code` 생성 시 모든 주석(`#`)과 독스트링(`"""..."""`)을 제거하고 실행 가능한 코드만 출력하도록 명시하여 응답 바이트를 약 70% 절감.

3. **Swarm 에이전트 Safety Filter 차단 방지 및 폴백 루프 개선 (`backend/gemini_swarm.py`)**
   * `_call_gemini_structured()` 호출 페이로드에 방어적 보안 검증 목적을 위한 `safetySettings: BLOCK_NONE` 4대 카테고리 설정 추가.
   * `_run_single_flash_attacker()` 프롬프트를 방어적 QA 단위 테스트 생성 관점으로 다듬고(에이전트당 핵심 테스트 2~3개, `attempt_history` 2~3턴), `Empty candidates` 발생 시 `break` 대신 다음 후보 모델로 자동 재시도하도록 수정.

4. **샌드박스 개별 테스트 격리 컴파일 및 필드명 수정 (`backend/sandbox_runner.py`, `backend/main.py`)**
   * `_clean_code_fences()`를 추가해 LLM이 반환한 `pytest_code`와 `mutated_code`의 마크다운 코드블록(````python`)을 자동 제거.
   * `compile_isolated_test_fn()`을 통해 각 테스트를 독립된 네임스페이스(`exec(code_str, ns)`)에서 개별 컴파일 및 함수 바인딩하도록 개선하여, 특정 테스트 하나가 실패해도 전체 샌드박스가 Replay로 폴백되지 않고 실제 생성된 테스트들이 실행되도록 수정.
   * `sandbox_report.sandbox_agent` 필드를 정확히 매핑하여 터미널에 `agent="antigravity-preview-09-2026"`이 정상 출력되도록 수정.
