# 05. API 및 SSE 스트리밍 명세서 (API & Server-Sent Events Specification)

> **프로젝트**: Argus-PR — PR 레드팀 스웜 및 블라인드 메타 검증 시스템  
> **기반 소스**: [`backend/main.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py), [`backend/models.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py)

---

## 1. API 엔드포인트 요약 (REST API Overview)

FastAPI 서버([`backend/main.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py))는 정적 프론트엔드 서빙(`/`)과 함께 총 **10개의 REST/SSE 엔드포인트**를 제공합니다.

| Method | Path | 기능 요약 | 주요 요청/쿼리 파라미터 | 응답 스키마 |
| :---: | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | 서버 상태 및 `GEMINI_API_KEY` 설정 여부 확인 | 없음 | `{status, service, gemini_api_configured, time}` |
| `GET` | `/api/prs` | 사전 구축된 벤치마크 PR 시나리오 목록 조회 (Cisco 벤치마크 포함) | 없음 | `List[PRMetadata]` |
| `GET` | `/api/prs/{pr_id}` | 특정 PR의 상세 Diff, 코드, Scope Triage 정보 조회 | `pr_id` (Path) | `PRDetailObject` |
| `GET` | `/api/github/pr` | 실제 공개 GitHub PR 실시간 가져오기, **원본 코드 선택 로드(Scope Triage)** 및 Stage 0 스캔 | `url` 또는 `repo` + `prNumber`, `scope_override` (Query) | `{status: "IMPORTED", pr: {...}, scope_triage: {...}}` |
| `POST` | `/api/prs/custom` | 사용자 커스텀 PR Diff/코드 등록 및 Stage 0 + Scope Triage 스캔 | [`CustomPRRequest`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py#L101-L107) | `{status: "CREATED", pr: {...}}` |
| `POST` | `/api/verify/stream` | **실시간 SSE 스트리밍 블라인드 검증 & 5회 적응형 레드팀 루프 실행** | [`VerifyRequest`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py#L79-L90) | `text/event-stream` (SSE 이벤트 시퀀스) |
| `POST` | `/api/verify` | 동기식(Synchronous) 전체 블라인드 검증 실행 | [`VerifyRequest`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py#L79-L90) | [`FullVerificationRunResponse`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L123-L136) |
| `POST` | `/api/verify/apply-patch` | Argon 권장 보안 패치 적용 후 샌드박스 재검증 (`5/5 방어` & `100%` 포착) | [`ApplyPatchRequest`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py#L110-L112) | [`FullVerificationRunResponse`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L123-L136) |
| `POST` | `/api/verify/add-mutant` | 커스텀 블라인드 변이 버그(`M9` 등) 추가 및 $M/K$ 점수 재계산 | [`AddMutantRequest`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py#L115-L120) | [`FullVerificationRunResponse`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L123-L136) |
| `POST` | `/api/decision` | 인간 리뷰어의 최종 병합 승인/반려(`APPROVE_MERGE` / `REJECT_MERGE`) 기록 | [`DecisionRequest`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py#L93-L98) | `{status: "RECORDED", decision: {...}}` |
| `GET` | `/api/decisions` | 기록된 인간 리뷰어 의사결정 감사 로그 전체 조회 | 없음 | `List[DecisionRecord]` |

---

## 2. 주요 엔드포인트 상세 명세

### 2.1 실시간 블라인드 검증 스트리밍: `POST /api/verify/stream`
- **Content-Type**: `application/json` (Request) → `text/event-stream` (Response)
- **Request Body (`VerifyRequest`)**:
```json
{
  "pr_id": "pr-cisco-sandbox-bypass",
  "phase_mode": "phase2_full",
  "execution_mode": "replay",
  "scope_override": "auto",
  "max_redteam_attempts": 5,
  "custom_diff": null,
  "custom_code": null
}
```
  - `phase_mode`: `"phase1_mvp"` (3개 공격 에이전트, 1회 실행) 또는 `"phase2_full"` (4개 공격 에이전트, 최대 5회 적응형 레드팀 루프 + 2회 연속 재현 확인)
  - `execution_mode`: `"replay"` (사전 검증된 샌드박스 실행 로그 즉시 재생) 또는 `"live_api"` (실시간 Gemini & Antigravity API 호출)
  - `scope_override`: `"auto"` (Triage Agent 자동 판단), `"single_file"` (`SINGLE_FILE_UNIT`), `"sparse_package"` (`SPARSE_PACKAGE_TREE`), `"server_daemon"` (`LIVE_SERVER_DAEMON`)
  - `max_redteam_attempts`: 레드팀 에이전트가 방어선 돌파를 시도할 최대 라운드 상한 (기본값 `5`)

---

### 2.2 실제 GitHub PR 불러오기 & 스마트 컨텍스트 로더: `GET /api/github/pr`
- **Query Parameters**:
  - `url`: 예: `https://github.com/cisco-foundation-ai/vulnerability-localization-benchmark/pull/3` 또는 단축 표기 `cisco-foundation-ai/vulnerability-localization-benchmark#3`
  - 또는 `repo` (`cisco-foundation-ai/vulnerability-localization-benchmark`) + `prNumber` (`3` 또는 `6`)
  - `scope_override`: `"auto"` (기본값) | `"single_file"` | `"sparse_package"` | `"server_daemon"`
- **동작 방식 (Diff-Only 한계 극복 & 용량 최적화)**:
  1. GitHub REST API (`/repos/{owner}/{repo}/pulls/{num}` 및 `/files`)를 호출하여 PR 메타데이터, `head.sha`, 파일별 Unified Patch를 가져옵니다.
  2. **실제 원본 소스 코드 패칭 (`Contents / Raw API`)**:
     - 단순 Diff 조각만 가져오면 문법 에러로 실행이 불가능하므로, 변경된 타겟 파일의 `raw_url`(또는 `/repos/{owner}/{repo}/contents/{filename}?ref={head_sha}`)을 통해 **실행 가능한 전체 원본 파이썬 모듈 코드**를 가져옵니다.
  3. **Stage 0.5 Smart Scope Triage**:
     - 변경된 파일들의 확장자와 로컬 `import` 문을 분석하여, 단일 모듈(`sandbox.py`, ~7.4KB)이면 `SINGLE_FILE_UNIT`, 패키지 간 참조(`cli.py` ↔ `scoring.py`, ~23KB)가 있으면 `SPARSE_PACKAGE_TREE`(대용량 `uv.lock` 1MB, `data/manifest.csv` 1.1MB, `docs/*.pdf` 제외), 웹 서버 엔드포인트가 있으면 `LIVE_SERVER_DAEMON`으로 분류합니다.
  4. 즉시 **Stage 0 프롬프트 인젝션 검사**를 수행한 뒤 `SAMPLE_PRS`에 등록합니다.

---

### 2.3 권장 패치 적용 후 재검증: `POST /api/verify/apply-patch`
- **Request Body (`ApplyPatchRequest`)**:
```json
{
  "pr_id": "pr-cisco-sandbox-bypass",
  "phase_mode": "phase2_full"
}
```
- **동작 방식**:
  1. Argon이 제안한 보안 및 상태 불변성 패치(예: `_split_pipeline`의 따옴표 외부 백슬래시 이스케이프 거부, `DENIED_PATTERNS`에 `;` 및 `\n` 추가, `python3`/`find` 차단)가 적용된 후의 상태를 재검증합니다.
  2. Track (a)의 모든 공격 벡터가 **5/5 라운드 내내 방어 성공(`DEFENDED 5/5`, `run_1_passed = True`, `run_2_passed = True`, `confirmed_pr_failures_count = 0`)**으로 전환됩니다.
  3. Track (b)에서 기존에 생존했던 사각지대 변이(`M8`)가 보강된 불변성 테스트에 의해 사살(`False`)되어 결정론적 탐지 점수가 **`8 of 8 planted bugs caught (100.0%)`**로 상승하며, `headline_verdict`가 `"APPROVE_RECOMMENDED"`로 갱신됩니다.

---

### 2.4 커스텀 블라인드 변이 추가: `POST /api/verify/add-mutant`
- **Request Body (`AddMutantRequest`)**:
```json
{
  "pr_id": "pr-cisco-sandbox-bypass",
  "category": "security",
  "title": "Subshell variable expansion $IFS bypass",
  "bug_description": "Custom synthetic mutation planted by human reviewer",
  "caught": true
}
```
- **동작 방식**:
  - Track B의 `blind_mutants` 목록에 `M9`(또는 `M{N+1}`) 변이를 추가하고 [`compute_deterministic_scores()`](file:///c:/Users/ttogl/workspace/google-hack/backend/scoring.py#L29-L119)를 재호출하여 즉시 새로운 $M/K$ 탐지율(예: `8 of 9 planted bugs caught (88.9%)`)을 반환합니다.

---

## 3. SSE(Server-Sent Events) 스트리밍 프로토콜 명세

`POST /api/verify/stream` 호출 시 서버는 `data: <JSON>\n\n` 형식으로 총 **11단계의 SSE 이벤트(`stage`)**를 순차적으로 푸시합니다.

### SSE Stage 진행 흐름도

```mermaid
flowchart LR
    S0["1. guardrail_start"] --> S1["2. guardrail (+ scope_triage)"]
    S1 -->|"is_safe == False"| SBlock["3a. blocked"] --> SDone["11. done"]
    S1 -->|"is_safe == True"| S2["3b. blind_dual_track_start"]
    S2 --> S3["4. invariants_extracted"]
    S3 --> S4["5. swarm_attacking_start"]
    S4 --> S5["6. swarm_attacking (with attempt_history 1..5)"]
    S5 --> S6["7. sandbox_start"]
    S6 --> S7["8. sandbox_track_a (5-round loop + 2x Repro)"]
    S7 --> S8["9. sandbox_track_b (M1..M8 matrix)"]
    S8 --> S9["10. deterministic_scoring"]
    S9 --> S10["10b. one_card_start / one_card_synthesis"]
    S10 --> SDone
```

### SSE 이벤트별 JSON 페이로드 구조

| 순서 | `stage` 값 | 주요 포함 필드 | 프론트엔드 UI 반응 (`frontend/app.js`) |
| :---: | :--- | :--- | :--- |
| **1** | `guardrail_start` | `model` (`"gemini-3.5-flash-lite"`), `message` | 상단 Stepper `0. Flash-Lite Guardrail` 활성화 |
| **2** | `guardrail` | `guardrail` ([`GuardrailResult`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L7-L12)), `scope_triage` (`ScopeTriageResult`), `message` | `#guardrail-banner`에 `SAFE`/`BLOCKED` 및 선정된 Scope 배지(`SINGLE_FILE_UNIT` / `SPARSE_PACKAGE_TREE` / `LIVE_SERVER_DAEMON`) 렌더링 |
| **3a** | `blocked` *(차단 시)* | `message`, `final_response` | 프롬프트 인젝션 탐지 시 즉시 중단 및 `REJECT_RECOMMENDED` 카드 표시 |
| **3b** | `blind_dual_track_start` | `telemetry` (`information_wall_active: true`, `store: false`) | Stepper `1. Blind Dual-Track` 점등 & 중앙 정보 격리벽 배지 강조 |
| **4** | `invariants_extracted` | `invariants`, `attack_plans`, `sealed_mutants_count: 8`, `sealed_status` | 좌측 레인에 `INV-1..4` 표시, 우측 레인에 8개 `🔒 SEALED` 변이 슬롯 생성 |
| **5** | `swarm_attacking_start` | `model` (`"gemini-3.8-flash"`), `active_attackers`, `max_attempts: 5` | Stepper `2. 4x Flash Attacker Swarm` 점등 |
| **6** | `swarm_attacking` | `total_tests_generated`, `swarm_outputs` (각 테스트 내 `attempt_history` 포함) | 좌측 레인에 공격 에이전트별 카드 및 **`Attempt 1..k` 단계별 우회 타임라인** 렌더링 |
| **7** | `sandbox_start` | `agent` (`"antigravity-preview-09-2026"`), `scope_mode`, `message` | 샌드박스 터미널 배지를 `RUNNING`으로 변경 |
| **8** | `sandbox_track_a` | `terminal_logs`, `pr_test_results`, `confirmed_failures_count`, `flaky_filtered_count` | Stepper `3a` 점등, 터미널에 1~5회차 레드팀 공격 루프 및 2x Repro 로그 출력, 카드에 `BREACHED (3/5) · FAIL 2/2` 또는 `DEFENDED (5/5) · PASS 2/2` 배지 부착 |
| **9** | `sandbox_track_b` | `terminal_logs`, `mutant_matrix`, `mutant_ids` | Stepper `3b` 점등, 터미널에 Track (b) 변이 사살 로그 출력 |
| **10** | `deterministic_scoring` | `engine`, `deterministic_score` ([`DeterministicScoreReport`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L100-L111)) | 우측 레인 변이 8개의 봉인 해제(`CAUGHT` vs `SURVIVED`) 및 $M/K$ 점수 확정 |
| **11** | `one_card_synthesis` & `done` | `one_card_summary`, `final_response`, `run_id` | Stepper `4. One-Card` 완료, 하단 `#one-card-summary` 카드 전체 렌더링 |
