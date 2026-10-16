# 03. 개체-관계 다이어그램 및 데이터 모델 명세 (ERD & Data Schema Specification)

- **프로젝트**: Argus-PR — PR 레드팀 스웜 및 블라인드 메타 검증 시스템  
- **기반 소스**: [`backend/models.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py), [`backend/workspace_slicer.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/workspace_slicer.py), [`backend/live_dast_runner.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/live_dast_runner.py), [`backend/main.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/main.py)

---

## 1. 개요 (Overview)

Argus-PR의 데이터 모델은 **Pydantic v2 엄격한 타입 스키마([`backend/models.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py))**를 중심으로 설계되어 있으며:
1. **Stage 0 프롬프트 인젝션 방어벽(`GuardrailResult`)**,
2. **Stage 0.5 스마트 범위 분류 및 정적 임포트 슬라이서(`ScopeTriageResult`, `WorkspaceSliceResult`)**,
3. **Track 1A 불변성 추출(`InvariantExtractionPlan`) vs Track 1B 블라인드 변이 주입(`BlindMutantSet`)**,
4. **최대 5회 적응형 레드팀 공격 루프 & 🥉 3위 Multi-Persona BOLA 매트릭스(`RedTeamAttemptStep`, `AuthPersona`, `AuthZMatrixRow`, `GeneratedTestCase`, `SingleTestRunResult`)**,
5. **🥇 1위 반례 기반 최대 5회 자가 치유 패치 루프(`SelfHealingPatchReport`, `PatchAttemptStep`, `PatchVerifyGateReport`)**,
6. **🥈 2위 영구 보안 회귀 테스트 & PR 번들 익스포터(`VerifiedPRBundleResponse`, `PinnedRegressionTestFile`)**,
7. **결정론적 채점기(`DeterministicScoreReport`) 및 인간 리뷰어 감사 기록(`HUMAN_DECISIONS_STORE`)** 간의 데이터 무결성을 보장합니다.

---

## 2. 전체 도메인 개체-관계 다이어그램 (Entity-Relationship Diagram)

```mermaid
erDiagram
    PULL_REQUEST_BENCHMARK ||--o{ VERIFICATION_RUN : "verified_by"
    PULL_REQUEST_BENCHMARK ||--o{ PR_TRANSLATION_CACHE : "translated_in"

    VERIFICATION_RUN ||--|| GUARDRAIL_RESULT : "stage_0_scan"
    VERIFICATION_RUN ||--|| SCOPE_TRIAGE_RESULT : "stage_0_5_scope"
    VERIFICATION_RUN ||--|| INVARIANT_EXTRACTION_PLAN : "track_1a_plan"
    VERIFICATION_RUN ||--|| BLIND_MUTANT_SET : "track_1b_mutants"
    VERIFICATION_RUN ||--|{ ATTACKER_SWARM_OUTPUT : "stage_2_swarm"
    VERIFICATION_RUN ||--|| SANDBOX_EXECUTION_REPORT : "stage_3_sandbox"
    VERIFICATION_RUN ||--|| DETERMINISTIC_SCORE_REPORT : "stage_4_score"
    VERIFICATION_RUN ||--|| ONE_CARD_EXECUTIVE_SUMMARY : "stage_5_summary"
    VERIFICATION_RUN ||--o| SELF_HEALING_PATCH_REPORT : "stage_6_cegis_patch"
    VERIFICATION_RUN ||--o| VERIFIED_PR_BUNDLE_RESPONSE : "stage_7_pr_export"
    VERIFICATION_RUN ||--o{ HUMAN_DECISION_RECORD : "governed_by"

    INVARIANT_EXTRACTION_PLAN ||--|{ INVARIANT_ITEM : "extracts"
    INVARIANT_EXTRACTION_PLAN ||--|{ ATTACK_VECTOR_PLAN : "schedules"

    BLIND_MUTANT_SET ||--|{ PLANTED_BUG_MUTANT : "contains_8_plus"

    ATTACKER_SWARM_OUTPUT ||--|{ GENERATED_TEST_CASE : "generates"
    ATTACKER_SWARM_OUTPUT ||--o{ AUTHZ_MATRIX_ROW : "evaluates_bola_personas"
    INVARIANT_ITEM ||--o{ GENERATED_TEST_CASE : "targeted_by"
    GENERATED_TEST_CASE ||--|{ RED_TEAM_ATTEMPT_STEP : "iterates_up_to_5"

    SANDBOX_EXECUTION_REPORT ||--|{ SINGLE_TEST_RUN_RESULT : "records_track_a"
    GENERATED_TEST_CASE ||--|| SINGLE_TEST_RUN_RESULT : "executed_as"

    DETERMINISTIC_SCORE_REPORT ||--|{ MUTANT_KILL_EVALUATION : "evaluates_track_b"
    PLANTED_BUG_MUTANT ||--|| MUTANT_KILL_EVALUATION : "graded_in"

    SELF_HEALING_PATCH_REPORT ||--|{ PATCH_ATTEMPT_STEP : "heals_up_to_5"
    VERIFIED_PR_BUNDLE_RESPONSE ||--|| PINNED_REGRESSION_TEST_FILE : "bundles_ci_test"
```

---

## 3. 핵심 엔티티 상세 명세 (Core Data Dictionary)

### 3.1 `GuardrailResult`, `ScopeTriageResult` & `WorkspaceSliceResult` (Stage 0 & 0.5)
신뢰할 수 없는 PR 입력이 프론티어 모델(`gemini-4-argon`)로 전달되기 전에 `gemini-3.5-flash-lite`가 반환하는 보안 검문 스키마(`GuardrailResult`)와, GitHub/IDE 워크스페이스에서 어떤 파일 범위를 샌드박스에 마운트할지 결정하는 `ScopeTriageResult` 및 [`WorkspaceSliceResult`](file:///c:/Users/ttogl/workspace/google-hack/backend/workspace_slicer.py#L46-L65) 스키마입니다.

| 모델 | 필드명 | 타입 | 필수 | 설명 |
| :--- | :--- | :--- | :---: | :--- |
| **`GuardrailResult`** | `is_safe` | `bool` | Y | 프롬프트 인젝션이나 명령어 무력화 시도가 없으면 `True`, 탐지되면 `False` |
| | `risk_level` | `Literal["SAFE", "SUSPICIOUS", "BLOCKED"]` | Y | 신뢰할 수 없는 PR 페이로드의 위험도 분류 |
| | `detected_threats` | `List[str]` | N | 탐지된 악성 문자열 또는 정규식/시그니처 목록 |
| | `sanitized_summary` | `str` | Y | `gemini-3.5-flash-lite`가 생성한 보안 스캔 요약 |
| | `latency_ms` | `int` | N | 가드레일 검사 소요 시간 (밀리초) |
| **`ScopeTriageResult`** | `scope_mode` | `Literal["SINGLE_FILE_UNIT", "SPARSE_PACKAGE_TREE", "LIVE_SERVER_DAEMON"]` | Y | 단일 모듈 실행, 선택적 패키지 트리 마운트, 샌드박스 내 서버 데몬 구동 중 결정된 실행 모드 |
| | `selection_source` | `Literal["agent_auto", "user_override"]` | Y | 에이전트 자동 분류인지 사용자가 UI에서 강제 지정했는지 여부 |
| | `primary_target_file` | `str` | Y | 핵심 검증 대상 파일 경로 (예: `src/vulnerability_localization_benchmark/sandbox.py`) |
| | `mounted_files` | `List[str]` | N | 샌드박스 `/workspace`에 실제 마운트된 파일 목록 |
| | `skipped_heavy_paths` | `List[str]` | N | 클론 병목 방지를 위해 제외된 대용량 파일 목록 (예: `uv.lock (1.0MB)`, `data/manifest.csv (1.1MB)`, `docs/*.pdf`) |
| | `estimated_mount_size_kb` | `float` | N | 샌드박스에 마운트된 소스 코드 총 크기 (KB, 예: `7.4` 또는 `23.2`) |
| | `rationale` | `str` | Y | 해당 Scope 모드를 선택한 AST/의존성 분석 근거 |
| **`WorkspaceSliceResult`** | `entry_file` | `str` | Y | 프론트엔드/백엔드 슬라이싱 시작 엔트리 파일 (예: `src/pages/RefundCheckoutPage.tsx`) |
| | `dependency_edges` | `List[ImportGraphEdge]` | N | BFS 탐색으로 해석된 로컬 `import` 의존성 간선 목록 (`source_file`, `raw_specifier`, `resolved_file`, `depth`) |
| | `reduction_ratio_pct` | `float` | Y | 전체 워크스페이스 파일 대비 프루닝(절감)된 비율 (`%`, 예: `64.3%`) |

---

### 3.2 `RedTeamAttemptStep`, `GeneratedTestCase` & `AuthZMatrixRow` (최대 5회 레드팀 루프 & 🥉 3위 Multi-Persona BOLA 매트릭스)
단발성 테스트 생성이 아니라, 샌드박스 내 타겟의 방어 로직을 최대 5회(`max_attempts = 5`)까지 공략하며 변조(`Mutate`)한 과정과, **다중 페르소나 교차 테넌트 BOLA/IDOR(`CWE-639`) 리플레이 결과**를 기록하는 스키마입니다.

| 모델 | 필드명 | 타입 | 설명 |
| :--- | :--- | :--- | :--- |
| **`RedTeamAttemptStep`** | `attempt_num` | `int` | 시도 회차 (`1` ~ `5`) |
| | `attack_hypothesis` | `str` | 직전 차단 로그를 관찰한 뒤 수립한 이번 회차의 우회 가설 |
| | `payload_snippet` | `str` | 타겟 함수 또는 서버 엔드포인트에 투입한 실제 공격 입력/명령어 |
| | `sandbox_observation` | `str` | 샌드박스 내 타겟의 실제 응답, 차단 메시지, 또는 예외 트레이스 |
| | `status` | `Literal["BLOCKED", "BREACHED", "DEFENDED"]` | 타겟에 의해 막혔으면 `BLOCKED`, 방어선 돌파에 성공했으면 `BREACHED` |
| **`AuthPersona`** | `persona_id` | `str` | 페르소나 식별자 (`"tenant_a_owner"`, `"tenant_b_attacker"`, `"anonymous_guest"`) |
| | `tenant_id` | `str` | 소속 테넌트 ID (`"tenant_A"`, `"tenant_B"`, `"none"`) |
| | `role` | `Literal["OWNER", "CROSS_TENANT_ATTACKER", "ANONYMOUS"]` | 권한 검증 역할 |
| | `auth_header` | `str` | 샌드박스에서 주입할 Authorization 헤더 (`Bearer jwt_tenant_B_attacker` 등) |
| **`AuthZMatrixRow`** | `endpoint` | `str` | 검증 대상 API 라우트 또는 상태 변경 함수 (예: `POST /api/v1/refunds/instant`) |
| | `resource_id` | `str` | `Tenant A` 소유 리소스 ID (예: `"ch_A100"`) |
| | `tenant_a_status` | `int` | 정상 소유자(`Tenant A`) 호출 시 응답 상태 (예: `200`) |
| | `tenant_b_status` | `int` | 타 테넌트 공격자(`Tenant B`) 호출 시 응답 상태 (`200`이면 BOLA 침해, `403`이면 방어 성공) |
| | `anonymous_status` | `int` | 비인증 게스트 호출 시 응답 상태 (예: `401` 또는 `403`) |
| | `bola_vulnerable` | `bool` | `tenant_b_status == 200`이고 피해자 리소스 변조가 2/2회 재현되면 `True` (`CWE-639`) |
| | `reproduced_2x` | `bool` | Run 1 & Run 2 연속 재현 여부 (`PROVEN` 승격 조건) |

---

### 3.3 `SelfHealingPatchReport` & `PatchAttemptStep` (🥇 1위 반례 기반 최대 5회 자가 치유 패치 루프 모델)
사용자가 `[🔧 권장 패치 적용 후 재검증]`을 실행했을 때 `patch_node` ↔ `patch_verify_node` (`patch_id` 연동, Sprint 38 `TASK-3802`)가 **4대 검증 게이트**를 모두 통과할 때까지 최대 5회까지 반례(`FAILED_COUNTEREXAMPLE`)를 피드백하며 자가 치유한 이력을 담는 스키마입니다.

| 모델 | 필드명 | 타입 | 설명 |
| :--- | :--- | :--- | :--- |
| **`PatchAttemptStep`** | `attempt_num` | `int` | 자가 치유 패치 시도 회차 (`1` ~ `5`) |
| | `patch_diff` | `str` | 이번 회차에 `gemini-4-argon`이 생성한 Unified Diff 스니펫 |
| | `patched_code_snippet` | `str` | 패치가 적용된 핵심 코드 블록 |
| | `gate_1_ast_passed` | `bool` | **Gate 1**: AST 문법/컴파일 유효성 통과 여부 |
| | `gate_2_semgrep_Zero_new` | `bool` | **Gate 2**: 정적 분석(Semgrep) 신규 보안 경고 0건 여부 |
| | `gate_3_dast_regression_blocked` | `bool` | **Gate 3**: 고정된 DAST 회귀 테스트(`PinnedRegressionTest`)에서 기존 익스플로잇 차단 여부 |
| | `gate_4_mutant_score_preserved` | `bool` | **Gate 4**: 기존 단위 테스트 통과 및 블라인드 변이 탐지율($M/K$) 유지/상승 여부 |
| | `status` | `Literal["FAILED_COUNTEREXAMPLE", "VERIFIED"]` | 4개 게이트 중 하나라도 실패 시 `"FAILED_COUNTEREXAMPLE"`, 모두 통과 시 `"VERIFIED"` |
| | `counterexample_trace` | `Optional[str]` | 실패한 게이트의 구체적 반례 트레이스 (다음 회차 `gemini-4-argon` 프롬프트에 주입됨) |
| **`SelfHealingPatchReport`** | `patch_id` | `str` | 패치 고유 ID (예: `"patch_3802_pr-cisco-sandbox-bypass"`) |
| | `max_patch_attempts` | `int` | 세션당 최대 자가 치유 시도 상한 (기본값: `5`) |
| | `attempts_used` | `int` | 최종 `VERIFIED` 도달까지 소요된 시도 횟수 (예: `2`) |
| | `verified_on_attempt` | `Optional[int]` | 몇 번째 시도에서 4대 게이트를 완주했는지 기록 (예: `2`) |
| | `final_status` | `Literal["VERIFIED", "FAILED"]` | 최종 패치 검증 상태 |
| | `attempt_history` | `List[PatchAttemptStep]` | Attempt 1(`FAILED_COUNTEREXAMPLE`)부터 Attempt $k$(`VERIFIED`)까지의 자가 치유 타임라인 |

#### 예시: Cisco `sandbox.py` (PR #3) 대상 `SelfHealingPatchReport` JSON 구조
```json
{
  "patch_id": "patch_3802_pr-cisco-sandbox-bypass",
  "max_patch_attempts": 5,
  "attempts_used": 2,
  "verified_on_attempt": 2,
  "final_status": "VERIFIED",
  "attempt_history": [
    {
      "attempt_num": 1,
      "patch_diff": "@@ -42,4 +42,6 @@\n+    if ch == '\\\\' and quote is None:\n+        return ['__INVALID_UNQUOTED_ESCAPE__']",
      "gate_1_ast_passed": true,
      "gate_2_semgrep_Zero_new": true,
      "gate_3_dast_regression_blocked": false,
      "gate_4_mutant_score_preserved": false,
      "status": "FAILED_COUNTEREXAMPLE",
      "counterexample_trace": "Gate 3 Failed: Escaped quote (\\\") blocked, but semicolon chaining 'ls ; id' and 'python3 -c' still bypassed DENIED_PATTERNS (Mutant M8 survived)."
    },
    {
      "attempt_num": 2,
      "patch_diff": "@@ -18,6 +18,7 @@\n+    (r\"[;\\n]\", \"semicolon or newline command separator\"),\n+    (r\"(?:python\\d*|bash|sh|node|perl|ruby)\\b\", \"inline interpreter invocation\"),",
      "gate_1_ast_passed": true,
      "gate_2_semgrep_Zero_new": true,
      "gate_3_dast_regression_blocked": true,
      "gate_4_mutant_score_preserved": true,
      "status": "VERIFIED",
      "counterexample_trace": null
    }
  ]
}
```

---

### 3.4 `VerifiedPRBundleResponse` & `PinnedRegressionTestFile` (🥈 2위 영구 회귀 테스트 & PR 번들 익스포트 모델)
최종 Merge Gate에서 `[📦 Export Verified PR + Regression Test Bundle]`(`POST /api/prs/export-bundle`) 호출 시 반환되는 스키마입니다.

| 모델 | 필드명 | 타입 | 설명 |
| :--- | :--- | :--- | :--- |
| **`PinnedRegressionTestFile`** | `file_path` | `str` | 레포지토리에 커밋될 테스트 파일 경로 (예: `tests/security/test_argus_regression_pr_cisco_sandbox_bypass.py`) |
| | `framework` | `Literal["pytest", "pytest+httpx"]` | 테스트 실행 프레임워크 |
| | `source_finding_ids` | `List[str]` | 이 회귀 테스트로 고정된 2/2 재현(`PROVEN`) 취약점 테스트 ID 목록 |
| | `code_content` | `str` | 취약 코드에서는 `FAIL`하고 패치 코드에서는 `PASS`하는 독립 실행 가능한 Python `pytest` 파일 전문 |
| **`VerifiedPRBundleResponse`** | `pr_id` | `str` | 대상 PR ID |
| | `patch_id` | `str` | 연동된 `VERIFIED` 패치 ID |
| | `bundle_status` | `Literal["READY_FOR_COMMIT"]` | 번들 상태 |
| | `verified_patch_diff` | `str` | CEGIS 4대 게이트를 통과한 최종 프로덕션 Unified Diff |
| | `regression_test_file` | `PinnedRegressionTestFile` | 영구 자산화될 보안 회귀 테스트 파일 객체 |
| | `ci_workflow_snippet` | `str` | `.github/workflows/argus-security-regression.yml`에 추가할 GitHub Actions 스니펫 |
| | `git_apply_commands` | `List[str]` | 개발자가 터미널에서 즉시 패치와 회귀 테스트를 커밋할 수 있는 쉘 명령어 |

---

### 3.5 `PlantedBugMutant`, `MutantKillEvaluation` & `SandboxExecutionReport` (Track 1B & Track 3B 변이 검증 모델)
Track 1B에서 격리 생성된 인공 버그(`PlantedBugMutant`)와 Track 3B 샌드박스 실행 후 `scoring.py`가 판정한 결과(`MutantKillEvaluation`)의 스키마입니다.

| 모델 | 필드명 | 타입 | 설명 |
| :--- | :--- | :--- | :--- |
| **`PlantedBugMutant`** | `mutant_id` | `str` | 변이 고유 식별자 (`M1` ~ `M8`, 사용자 추가 시 `M9` 등) |
| | `category` | `Literal["security", "edge_cases", "state", "regression"]` | 변이가 속한 취약점/결함 도메인 |
| | `title` | `str` | 심어진 인공 버그의 짧은 제목 |
| | `diff_snippet` | `str` | 원본 코드 대비 변경된 Unified Diff 스니펫 |
| | `mutated_code` | `str` | 샌드박스에서 개별 모듈(`mutant_M1.py` 등)로 로드될 전체 Python 소스 코드 |
| **`MutantKillEvaluation`** | `caught` | `bool` | **결정론적 판정 결과**: $\exists t_j \in T : \text{Pass}(t_j, \text{PR}_{\text{orig}}) \land \text{Fail}(t_j, m_i)$ 충족 시에만 `True` |
| | `caught_by_test_ids` | `List[str]` | 원본에서는 통과(`PASS`)하고 이 변이본에서만 실패(`FAIL`)한 유효 테스트 ID 목록 |
| | `caught_by_attackers` | `List[str]` | 해당 변이를 잡아낸 공격 에이전트 ID 목록 |
| | `raw_failed_test_ids` | `List[str]` | 원본 통과 여부와 무관하게 이 변이본에서 실패한 모든 원시 테스트 ID 목록 (비교/감사용) |

