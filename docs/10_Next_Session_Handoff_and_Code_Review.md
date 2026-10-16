# 10. Next-Session Continuation Guide & Code Review Checklist

이 문서는 다음 개발 세션에서 **1) 현재까지 구현된 코드베이스의 정밀 코드 리뷰(Code Review) 및 정합성 검증**을 먼저 수행한 뒤, **2) `docs/`(00~09번 문서)에 새롭게 명세된 차세대 엔터프라이즈 AppSec 에이전트 기능(Top 1~3)을 순서대로 구현**하기 위한 인수인계(Handoff) 문서입니다.

---

## 1. [`docs/09_Agent_Orchestration_and_LLM_Call_Flow.md`](file:///c:/Users/ttogl/workspace/google-hack/docs/09_Agent_Orchestration_and_LLM_Call_Flow.md) vs. 현재 실제 구현체 비교 분석

[`docs/09_Agent_Orchestration_and_LLM_Call_Flow.md`](file:///c:/Users/ttogl/workspace/google-hack/docs/09_Agent_Orchestration_and_LLM_Call_Flow.md) 문서는 **현재 구현 완료된 Stage 0 ~ Stage 4a/4b 파이프라인**과 **앞으로 추가할 Stage 4 Post-Review 확장 기능**을 함께 담고 있습니다. 실제 코드와 대조한 결과는 다음과 같습니다:

### 1.1 100% 일치하는 구간 (현재 구현 완료 및 검증됨)

| 파이프라인 단계 | [`docs/09_Agent_Orchestration_and_LLM_Call_Flow.md`](file:///c:/Users/ttogl/workspace/google-hack/docs/09_Agent_Orchestration_and_LLM_Call_Flow.md) 명세 | 실제 구현 코드 위치 및 동작 | 상태 |
| :--- | :--- | :--- | :---: |
| **Node 0: Prompt-Injection Guardrail** | `gemini-3.5-flash-lite` (`store=False`) + `INJECTION_PATTERNS` 정규식 사전 필터 | [`backend/gemini_swarm.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/gemini_swarm.py#L41-L100) `run_prompt_injection_guardrail()` | **완벽 일치** |
| **Node 0.5: Smart Scope Triage & Import Slicer** | 100% 결정론적 Python (`ast` + ES Module Regex BFS, 깊이 $\le 3$) | [`backend/sample_prs.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/sample_prs.py#L31-L148) `analyze_scope_triage()` 및 [`backend/workspace_slicer.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/workspace_slicer.py#L223-L353) `slice_workspace_by_imports()` | **완벽 일치** |
| **Node 1A: Track 1A Attack Planner** | `gemini-4-argon` (`store=False`), `INV-1..4` 및 공격 계획 JSON 추출 | [`backend/gemini_swarm.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/gemini_swarm.py#L103-L152) `extract_invariants_and_plan()` | **완벽 일치** |
| **Node 1B: Track 1B Blind Bug Planter** | `gemini-4-argon` (`store=False`), 정보 격리벽 너머에서 8개 변이(`M1..M8`) 독립 주입 | [`backend/gemini_swarm.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/gemini_swarm.py#L155-L186) `plant_blind_bugs()` | **완벽 일치** |
| **Node 2: Parallel Attacker Swarm** | `asyncio.gather`로 4개 `gemini-3.8-flash` 에이전트 병렬 호출 (`security`, `edge_cases`, `state`, `regression`) | [`backend/gemini_swarm.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/gemini_swarm.py#L189-L261) `run_parallel_attacker_swarm()` | **완벽 일치** |
| **Node 3A/3B: Dual-Track Sandbox & Live DAST** | `antigravity-preview-09-2026` 원격 샌드박스 + 로컬 격리 서브프로세스(`_run_local_isolated_sandbox`) + `live_dast_runner.py` | [`backend/sandbox_runner.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/sandbox_runner.py#L168-L353) `run_sandbox()` 및 [`backend/live_dast_runner.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/live_dast_runner.py#L368-L505) `run_live_server_dast_verification()` | **완벽 일치** |
| **Node 4: Deterministic Score Calculator** | LLM 개입 0%, 순수 Python 집합 연산으로 $\text{Pass}(\text{PR}_{\text{orig}}) \land \text{Fail}(M_i)$ 및 $2/2$ 재현성 계산 | [`backend/scoring.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/scoring.py#L19-L131) `compute_deterministic_scores()` | **완벽 일치** |
| **Node 5: One-Card Executive Synthesizer** | `gemini-4-argon` (`store=False`), Python이 확정한 $M/K$ 수치와 생존 변이(`M8`)를 바탕으로 경영진 요약 카드 작성 | [`backend/gemini_swarm.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/gemini_swarm.py#L264-L306) `synthesize_one_card_summary()` | **완벽 일치** |

---

### 1.2 문서(`docs/09` 및 `docs/00~08`)와 현재 코드 간의 차이점 (다음 세션에서 구현할 신규 스펙 4가지)

현재 [`docs/09_Agent_Orchestration_and_LLM_Call_Flow.md`](file:///c:/Users/ttogl/workspace/google-hack/docs/09_Agent_Orchestration_and_LLM_Call_Flow.md) (및 함께 업데이트된 `docs/00`~`08`)에는 **다음 세션에서 구현할 새 기능 스펙**이 미리 반영되어 있어, 현재 코드와 아래 4가지 차이점이 존재합니다:

1. **Stage 0 vs Stage 0.5 실행 순서 (사소한 순서 차이)**:
   - **문서 (`docs/09` Mermaid 다이어그램)**: `Stage 0 Guardrail` 완료 후 `is_safe == True`일 때 `Stage 0.5 Scope Triage`로 이동(또는 Sequence Diagram에서는 업로드 직후 Triage 후 Guardrail 호출로 표기).
   - **실제 코드 ([`backend/main.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py#L1023-L1108))**: line 1023에서 `_resolve_scope_triage_for_pr()`를 먼저 계산해 두고, SSE 이벤트는 `guardrail_start` $\to$ `guardrail` $\to$ (`is_safe` 검사) $\to$ `scope_triage` 순서로 스트리밍합니다. 동작상 문제는 없으나 코드 리뷰 시 확인 포인트입니다.
2. **Track 1A & Track 1B 동시 실행 방식 (`Live API` 모드 시)**:
   - **문서 (`docs/09` Sequence Diagram line 117-123)**: `par Track 1A ... and Track 1B` 병렬 호출로 표기.
   - **실제 코드 ([`backend/main.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py#L1131-L1133))**: 현재 `extract_invariants_and_plan()`과 `plant_blind_bugs()`가 동기 함수여서 순차 호출됩니다. 다음 세션 코드 리뷰에서 `asyncio.to_thread` + `asyncio.gather`로 감싸면 문서의 `par` 다이어그램과 100% 동일하게 진짜 병렬로 동작합니다.
3. **Node 6: CEGIS 반례 기반 자가 치유 패치 루프 (`POST /api/verify/apply-patch`)**:
   - **문서 (`docs/09` line 75-84, 152-159, 176 & `docs/05` 2.3절)**: `patch_node` (`gemini-4-argon`) $\leftrightarrow$ `patch_verify_node` (4-Gate: Gate 1 AST, Gate 2 Semgrep, Gate 3 Pinned DAST, Gate 4 Blind Mutants)가 최대 5회(`max_patch_attempts=5`) 반례(`FAILED_COUNTEREXAMPLE`)를 주고받으며 `SelfHealingPatchReport` (Attempt 1 실패 $\to$ Attempt 2 `VERIFIED`)를 반환하도록 명세되어 있습니다.
   - **실제 코드 ([`backend/main.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py#L667-L746))**: 현재는 1회성 즉시 패치 적용(`FullVerificationRunResponse` 반환)만 구현되어 있으며, 4-Gate `SelfHealingPatchReport` 모델 및 반례 피드백 루프는 **다음 세션 구현 대상 1순위**입니다.
4. **PR 번들 & 회귀 테스트 익스포터 (`POST /api/prs/export-bundle`) 및 Multi-Persona BOLA 매트릭스 (`authz_matrix`)**:
   - **문서 (`docs/09` line 49, 59, 79 & `docs/05` 2.4절)**:
     - `POST /api/prs/export-bundle` 엔드포인트(`VerifiedPRBundleResponse`: 패치 Diff + `tests/security/test_argus_regression_*.py` + GitHub Actions YAML + `git apply` 명령어 반환)
     - Security Attacker 및 Live DAST 내 **Multi-Persona BOLA/IDOR 교차 인가 매트릭스 (`authz_matrix`: Tenant A Victim vs Tenant B Attacker vs Anonymous)**
   - **실제 코드**: 아직 `backend/models.py`, `backend/main.py`, `frontend/`에 추가되지 않았으며 **다음 세션 구현 대상 2·3순위**입니다.

---

## 2. 다음 세션 시작용 단계별 체크리스트 (Step 1: 코드 리뷰 $\to$ Step 2: 신규 기능 구현)

### Step 1. 기존 구현 코드 리뷰 체크리스트 (Code Review First)
다음 세션을 시작할 때 에이전트가 새 기능을 바로 짜기 전에 반드시 아래 항목을 먼저 점검하도록 지시합니다:
1. **백엔드 정합성 및 비동기 병렬성 점검**:
   - [`backend/main.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py#L1131-L1133)에서 Live API 모드 시 Track 1A(`extract_invariants_and_plan`)와 Track 1B(`plant_blind_bugs`)를 `asyncio.gather(asyncio.to_thread(...), asyncio.to_thread(...))`로 병렬화할 수 있는지 확인.
   - [`backend/sandbox_runner.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/sandbox_runner.py)의 `build_dual_track_harness_script()`가 생성하는 `/workspace/harness/run_dual_track_verification.py` 실행 시 타임아웃, 임시 디렉토리 정리(`tempfile.TemporaryDirectory`), 인코딩(`utf-8`) 누수가 없는지 점검.
   - [`backend/workspace_slicer.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/workspace_slicer.py)와 [`backend/live_dast_runner.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/live_dast_runner.py)의 예외 처리 및 포트 정리 점검.
2. **프론트엔드 UI/UX 및 DOM 상태 동기화 점검**:
   - [`frontend/index.html`](file:///c:/Users/ttogl/workspace/google-hack/frontend/index.html), [`frontend/styles.css`](file:///c:/Users/ttogl/workspace/google-hack/frontend/styles.css), [`frontend/app.js`](file:///c:/Users/ttogl/workspace/google-hack/frontend/app.js)에서 다크/화이트 테마 전환, `#agent-topology-drawer` 다이어그램 단계별 하이라이트(`setPipelineStep`), 스윔레인 2열 그리드 레이아웃 깨짐 여부가 모든 PR 시나리오에서 정상인지 확인.
3. **기존 단위/통합 테스트 통과 확인**:
   - `.\.venv\Scripts\python.exe -m pytest tests/ -v` 실행하여 100% PASS 확인.

### Step 2. `docs/` 기반 차세대 기능 구현 로드맵 (After Code Review)
코드 리뷰 통과 후 [`docs/00_Implement_plan.md`](file:///c:/Users/ttogl/workspace/google-hack/docs/00_Implement_plan.md), [`docs/03_ERD_and_Data_Model.md`](file:///c:/Users/ttogl/workspace/google-hack/docs/03_ERD_and_Data_Model.md), [`docs/05_API_and_SSE_Spec.md`](file:///c:/Users/ttogl/workspace/google-hack/docs/05_API_and_SSE_Spec.md), [`docs/08_Enterprise_Agent_Expansion_Ideas.md`](file:///c:/Users/ttogl/workspace/google-hack/docs/08_Enterprise_Agent_Expansion_Ideas.md), [`docs/09_Agent_Orchestration_and_LLM_Call_Flow.md`](file:///c:/Users/ttogl/workspace/google-hack/docs/09_Agent_Orchestration_and_LLM_Call_Flow.md)에 명세된 3대 기능을 구현합니다:
1. **🥇 Top 1: CEGIS 반례 기반 자가 치유 패치 루프 (`patch_node` $\leftrightarrow$ `patch_verify_node`)**
   - `backend/models.py`에 `PatchGateAttempt`, `SelfHealingPatchReport` 추가.
   - `POST /api/verify/apply-patch` 업그레이드: 4-Gate(AST, Semgrep, Pinned DAST, Blind Mutants) 검증 및 Attempt 1 (`FAILED_COUNTEREXAMPLE`) $\to$ Attempt 2 (`VERIFIED`) 자가 치유 이력 반환 + 프론트엔드 CEGIS 타임라인 UI 렌더링.
2. **🥈 Top 2: 영구 보안 회귀 테스트 & PR 번들 익스포터 (`POST /api/prs/export-bundle`)**
   - `backend/models.py`에 `ExportBundleRequest`, `VerifiedPRBundleResponse` 추가.
   - `POST /api/prs/export-bundle` 구현 및 One-Card 하단에 **"📦 Export Verified PR & CI Regression Suite"** 모달/드로어 UI 추가.
3. **🥉 Top 3: 멀티 페르소나 인가(AuthZ / BOLA) 교차 리플레이 매트릭스 (`authz_matrix`)**
   - `backend/models.py`에 `PersonaAuthZProbe`, `MultiPersonaAuthZMatrix` 추가.
   - `pr-checkout-race` 및 `live_dast_runner.py`에 `Tenant A (Owner)` vs `Tenant B (Attacker)` vs `Anonymous` 교차 호출 결과 탑재 및 UI 배지/테이블 표시.

---

## 3. 다음 세션에 그대로 복사해서 붙여넣을 프롬프트 (Copy-Paste Prompt)

```markdown
안녕! 이전 세션에 이어서 `Argus-PR` (`c:\Users\ttogl\workspace\google-hack`) 개발을 이어가려고 해.
먼저 새 기능을 바로 구현하지 말고, 아래 순서대로 진행해줘:

### 1단계: 핵심 문서 및 인수인계 문서 숙지
1. `docs/10_Next_Session_Handoff_and_Code_Review.md` 와 `docs/09_Agent_Orchestration_and_LLM_Call_Flow.md` 를 먼저 읽어줘.
2. 업데이트된 설계 문서들(`docs/00_Implement_plan.md`, `docs/03_ERD_and_Data_Model.md`, `docs/05_API_and_SSE_Spec.md`, `docs/08_Enterprise_Agent_Expansion_Ideas.md`)도 함께 확인해줘.

### 2단계: 현재 코드베이스 정밀 코드 리뷰 (Code Review First!)
새 기능을 작성하기 전에 현재 구현된 백엔드(`backend/main.py`, `backend/gemini_swarm.py`, `backend/sandbox_runner.py`, `backend/workspace_slicer.py`, `backend/live_dast_runner.py`, `backend/scoring.py`, `backend/sample_prs.py`)와 프론트엔드(`frontend/index.html`, `frontend/styles.css`, `frontend/app.js`)를 대상으로 코드 리뷰를 먼저 수행하고 결과를 보고해줘:
- `pytest` 전체 테스트 실행 결과 및 잠재적 버그/예외 처리 누락 여부
- `backend/main.py`의 Live API 호출 시 Track 1A와 Track 1B 비동기 병렬 처리 개선 포인트
- `frontend/` UI 상태 동기화 및 메모리/이벤트 리스너 중복 바인딩 여부
- 코드 리뷰에서 발견된 개선점이 있다면 먼저 깔끔하게 수정하고 테스트를 통과시켜줘.

### 3단계: `docs/`에 명세된 차세대 에이전트 기능(Top 1 ~ Top 3) 구현
코드 리뷰와 리팩토링이 완료되면, 새롭게 업데이트된 `docs/` 명세에 맞춰 다음 3가지 기능을 백엔드 + 프론트엔드 + `pytest` 테스트까지 완결성 있게 구현해줘:
1. **Top 1 — CEGIS 반례 기반 자가 치유 패치 루프 (`POST /api/verify/apply-patch`)**:
   - 4대 검증 게이트(Gate 1 AST, Gate 2 Semgrep, Gate 3 Pinned DAST, Gate 4 Blind Mutants) 및 `SelfHealingPatchReport` (Attempt 1 `FAILED_COUNTEREXAMPLE` -> Attempt 2 `VERIFIED`, 세션당 최대 5회 상한 `TASK-3802`) 구현 및 UI 시각화.
2. **Top 2 — 영구 보안 회귀 테스트 & PR 번들 익스포터 (`POST /api/prs/export-bundle`)**:
   - `VerifiedPRBundleResponse` (`verified_patch_diff` + `tests/security/test_argus_regression_*.py` + GitHub Actions YAML + `git apply` 명령어) 구현 및 One-Card 내 원클릭 익스포트 UI 추가.
3. **Top 3 — 멀티 페르소나 BOLA/IDOR 인가 매트릭스 (`authz_matrix`)**:
   - `Tenant A (Victim)` vs `Tenant B (Attacker)` vs `Anonymous` 교차 호출 검증 매트릭스를 `sample_prs.py`, `live_dast_runner.py`, 그리고 프론트엔드 카드/터미널에 통합.
```
