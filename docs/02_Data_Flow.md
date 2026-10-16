# 02. 데이터 흐름도 (Data Flow Diagram & Information Wall Specification)

> **프로젝트**: Argus-PR — PR 레드팀 스웜 및 블라인드 메타 검증 시스템  
> **기반 문서**: [`docs/00_Implement_plan.md`](file:///c:/Users/ttogl/workspace/google-hack/docs/00_Implement_plan.md), [`backend/gemini_swarm.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/gemini_swarm.py), [`backend/sandbox_runner.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/sandbox_runner.py), [`backend/scoring.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/scoring.py)

---

## 1. 데이터 흐름 설계의 4대 핵심 원칙

Argus-PR의 데이터 아키텍처는 일반 LLM 코드 리뷰 도구의 한계(환각, 자가 채점 편향, 프롬프트 인젝션 취약성, 무거운 전체 레포 클론 오버헤드, 1회성 정적 테스트의 얕은 검증)를 극복하기 위해 다음 **4가지 데이터 격리 및 실행 무결성 규칙**을 엄격히 강제합니다:

1. **Untrusted Input Perimeter & Smart Scope Triage (비신뢰 입력 방어벽 및 스마트 컨텍스트 로더)**
   - 외부에서 유입된 PR Diff, 코드, 주석, 커밋 메시지는 **신뢰할 수 없는 입력(`Untrusted Payload`)**으로 취급하며, 반드시 `gemini-3.5-flash-lite` 기반 **Stage 0 Guardrail**을 통과해 `is_safe == True`로 판정된 경우에만 상위 프론티어 모델(`gemini-4-argon`)로 전달됩니다.
   - 이어서 **Stage 0.5 Scope Triage**가 파일 확장자 및 로컬 `import` 의존성 그래프를 분석하여 불필요한 대용량 에셋(`uv.lock`, `data/manifest.csv`, `docs/*.pdf` 등)을 배제하고 **`SINGLE_FILE_UNIT`**, **`SPARSE_PACKAGE_TREE`**, **`LIVE_SERVER_DAEMON`** 중 최적의 실행 컨텍스트만 샌드박스에 마운트합니다.
2. **Strict Information Wall (`store=False` 블라인드 정보 격리벽)**
   - **Track 1A (`extract_invariants_and_plan`)**와 **Track 1B (`plant_blind_bugs`)**는 완전히 독립된 `gemini-4-argon` API 호출로 실행되며 세션/메모리를 공유하지 않습니다 (`store=False`).
   - Track 1B가 생성한 `BlindMutantSet (M1..M8)` 데이터는 Track 1A나 `gemini-3.8-flash` 공격 스웜(`run_parallel_attacker_swarm`)으로 **절대 흐르지 않으며**, 오직 원격 샌드박스(`Track 3B`)와 결정론적 채점기(`scoring.py`)에만 주입됩니다.
3. **Adaptive Multi-Turn Red-Team Feedback Loop (최대 5회 적응형 공격 피드백 루프)**
   - Track A의 레드팀 에이전트는 정적 테스트를 1회 생성하고 끝나는 것이 아니라, 샌드박스 내 구동 중인 타겟 모듈/서버로부터 **실행 관찰값(`sandbox_observation`: 차단 사유, 정규식 필터 메시지, HTTP 상태 코드, 예외 트레이스)**을 피드백 받아 최대 `max_attempts = 5` 회차까지 페이로드를 변조(`Observe → Mutate → Attack`)합니다.
   - 특정 회차 $k \le 5$에서 방어선이 뚫리면(`BREACHED`), 즉시 루프를 조기 종료(Early Exit)하고 해당 익스플로잇 페이로드의 **2회 연속 재현성(2/2 Reproducibility)**을 검증합니다.
4. **Deterministic Metric Authority (결정론적 수치 산출 권한 분리)**
   - LLM은 절대 점수나 탐지율을 계산하지 않습니다. 오직 순수 Python 엔진([`backend/scoring.py`](file:///c:/Users/ttogl/workspace/google-hack/backend/scoring.py))만이 샌드박스 실행 매트릭스(`pr_test_results`, `mutant_matrix`)를 입력받아 $\text{Caught}(m_i) \iff \exists t_j \in T : \text{Pass}(t_j, \text{PR}_{\text{orig}}) \land \text{Fail}(t_j, m_i)$ 수식을 계산하고, 확정된 불변(Immutable) 숫자를 최종 요약기(`synthesize_one_card_summary`)에 전달합니다.

---

## 2. 컨텍스트 다이어그램 (Level 0 DFD)

외부 엔티티(인간 리뷰어, GitHub REST/Contents/Trees API, Google Gemini API, Antigravity Remote Sandbox)와 **Argus-PR 시스템** 간의 최상위 데이터 입출력을 나타냅니다.

```mermaid
flowchart LR
    Reviewer(["👤 Human Tech Lead\n(브라우저 클라이언트)"])
    GitHub(["🌐 GitHub REST & Trees API\n(api.github.com / raw.githubusercontent.com)"])
    GeminiAPI(["🧠 Google Gemini API\n(Flash-Lite / Argon / Flash)"])
    Sandbox(["🐳 Antigravity Remote Sandbox\n(antigravity-preview-09-2026)"])

    subgraph ArgusPR ["🛡️ Argus-PR Verification Engine (FastAPI Backend)"]
        CoreEngine["Smart Scope Loader, Dual-Track Blind Verifier,\n5-Round Red-Team Controller & Deterministic Scorer"]
    end

    Reviewer -->|"1. PR 선택 / GitHub URL + Scope Override / 커스텀 Diff\n(VerifyRequest, CustomPRRequest)"| CoreEngine
    CoreEngine -->|"2. PR 메타데이터, 파일 패치 & 실제 Head 원본 소스 조회\n(/pulls/{num}/files + /contents/{path}?ref={head_sha})"| GitHub
    GitHub -->|"3. PR Diff + Selective Source Tree (무거운 에셋 제외)"| CoreEngine

    CoreEngine -->|"4. Stage 0 스캔 / Stage 0.5 Scope 분류 / Track 1A 기획 /\nTrack 1B 변이 생성 / 4x 병렬 공격 및 변조 / One-Card 요약"| GeminiAPI
    GeminiAPI -->|"5. 구조화된 JSON 스키마 응답\n(Guardrail, ScopeTriage, Invariants, Mutants, RedTeamAttempts, Summary)"| CoreEngine

    CoreEngine -->|"6. 선택적 소스 트리 마운트 & 적응형 하네스 실행\n(/workspace/harness/run_dual_track_verification.py)"| Sandbox
    Sandbox -->|"7. Track (a) 1..5회차 공격 타임라인 & 2x Repro 결과\n+ Track (b) Mutant Matrix (SandboxExecutionReport)"| CoreEngine

    CoreEngine -->|"8. 실시간 단계별 SSE 이벤트 스트림 &\n최종 FullVerificationRunResponse"| Reviewer
    Reviewer -->|"9. 최종 병합 승인/반려 판정\n(DecisionRequest: APPROVE / REJECT)"| CoreEngine
```

---

## 3. 상세 데이터 파이프라인 흐름도 (Level 1 DFD, Scope Triage & Information Wall)

각 프로세스 단계별로 어떤 Pydantic 모델(`backend/models.py`)이 생성되고 어디로 전달되는지, **Smart Scope Triage**, **5회 적응형 레드팀 루프**, 그리고 **정보 격리벽(Information Wall)**이 어떻게 작동하는지 보여줍니다.

```mermaid
flowchart TD
    %% 입력 데이터
    InputPR[/"신뢰할 수 없는 PR 데이터 (Untrusted PR Payload)\n- title, description, diff, head_sha, changed_files"/]

    %% Stage 0
    InputPR --> P0["P0. 프롬프트 인젝션 가드레일\nbackend/gemini_swarm.py::run_prompt_injection_guardrail()\nModel: gemini-3.5-flash-lite (store=False)"]
    P0 -->|"GuardrailResult\n{is_safe, risk_level, detected_threats, latency_ms}"| Gate0{"is_safe == True?"}

    Gate0 -->|"False (BLOCKED)"| EarlyHalt["차단 응답 즉시 생성\nFullVerificationRunResponse (0 tests run)"]

    %% Stage 0.5: Smart Scope Triage
    Gate0 -->|"True (Sanitized PR)"| P0_5["P0.5 스마트 범위 분류 및 선택적 컨텍스트 로더\nrun_scope_triage_and_load()\nAST Import 분석 + gemini-3.5-flash-lite"]
    P0_5 -->|"ScopeTriageResult\n{scope_mode: SINGLE_FILE_UNIT | SPARSE_PACKAGE_TREE | LIVE_SERVER_DAEMON,\nmounted_files, skipped_heavy_paths, estimated_mount_size_kb}"| ContextBundle[("선택적 마운트 코드 번들\n(예: sandbox.py 7.4KB 또는 src/ 23KB)")]

    %% Stage 1A & 1B 분리 (Information Wall)
    ContextBundle --> P1A["P1A. 불변성 추출 및 공격 기획\nextract_invariants_and_plan()\nModel: gemini-4-argon (store=False)"]
    ContextBundle --> P1B["P1B. 블라인드 인공 버그 주입\nplant_blind_bugs()\nModel: gemini-4-argon (store=False)"]

    subgraph TrackA_Zone ["🟦 Track A 영역 (적응형 레드팀 공격 루프 — 변이 정답지 접근 불가)"]
        P1A -->|"InvariantExtractionPlan\n{invariants: INV-1..4, attack_plans}"| P2["P2. 병렬 공격자 스웜 & 최대 5회 적응형 변조 루프\nrun_parallel_attacker_swarm()\nModel: 4x gemini-3.8-flash (max_attempts=5)"]
        P2 -->|"List[AttackerSwarmOutput]\n{attacker_id, tests + attempt_history[1..5]}"| TestSuite[("최종 익스플로잇 & 검증 스위트 T\n(test_swarm.py + Attempt Trace)")]
    end

    subgraph TrackB_Zone ["🟪 Track B 영역 (블라인드 메타 검증 정답지 — 🔒 SEALED)"]
        P1B -->|"BlindMutantSet\n{mutants: List[PlantedBugMutant] (M1..M8)}"| MutantStore[("비밀 인공 버그 8개\n(M1..M8 mutated_code)")]
    end

    %% Information Wall 표시
    MutantStore x--x|"🚫 STRICT INFORMATION WALL\n(절대 전달 금지 / Zero Shared Context)"| P1A
    MutantStore x--x|"🚫 STRICT INFORMATION WALL\n(절대 전달 금지 / Zero Shared Context)"| P2

    %% Stage 3 Sandbox
    TestSuite --> P3_Harness["P3. 듀얼 트랙 샌드박스 하네스 빌더\nbackend/sandbox_runner.py::build_dual_track_harness_script()"]
    MutantStore --> P3_Harness
    ContextBundle -->|"Mounted Target Module / Server Daemon"| P3_Harness

    P3_Harness -->|"run_dual_track_verification.py"| P3A_3B["P3A & P3B. 원격 샌드박스 실행 (또는 Recorded Replay)\nagent='antigravity-preview-09-2026' (environment='remote')\n- Track (a): Attempt 1..5 공격 루프 실행 & 돌파 시 2회 연속 재현(Run 1, Run 2)\n- Track (b): M1..M8 변이본 8개 대상 실행"]

    P3A_3B -.->|"Attempt k [BLOCKED] 차단 로그 피드백\n(Observe -> Mutate Payload k+1)"| P2

    P3A_3B -->|"SandboxExecutionReport\n{pr_test_results (with attempt_history), mutant_matrix, sandbox_stdout_logs}"| P4_Scoring["P4. 결정론적 점수 계산 엔진 (100% Python)\nbackend/scoring.py::compute_deterministic_scores()\n수식: Caught(m_i) ⇔ Pass(PR_orig) ∧ Fail(m_i)"]
    MutantStore -->|"Mutant Metadata (M1..M8)"| P4_Scoring
    TestSuite -->|"Test-to-Attacker Mapping"| P4_Scoring

    %% Stage 5 Synthesis
    P4_Scoring -->|"DeterministicScoreReport\n{confirmed_pr_failures, detection_score_pct,\nmutant_evaluations, surviving_mutants}"| P5_Synth["P5. One-Card 리스크 종합기\nsynthesize_one_card_summary()\nModel: gemini-4-argon (store=False)"]
    P1A -->|"InvariantExtractionPlan"| P5_Synth

    P5_Synth -->|"OneCardExecutiveSummary\n{headline_verdict, residual_risk_level,\nblind_spot_explanation, recommended_fix_snippet}"| FinalOut[/"최종 통합 응답\nFullVerificationRunResponse\n(SSE 스트림 & REST JSON)"/]
    EarlyHalt --> FinalOut
```

---

## 4. Stage 0.5 스마트 범위 분류기(Scope Triage) & 적응형 5회 공격 루프 상세 흐름

### 4.1 Smart Scope Triage 결정 트리 (`run_scope_triage_and_load`)
전체 Git 저장소를 무조건 클론할 때 발생하는 네트워크/디스크 병목을 제거하기 위해 다음 결정 트리로 마운트 단위를 결정합니다:

```mermaid
flowchart LR
    PRFiles["PR 변경 파일 목록 & AST Import 스캔"] --> OverrideCheck{"사용자 Scope Override\n지정 여부?"}
    OverrideCheck -->|"지정됨 (user_override)"| ApplyUserScope["사용자가 선택한 모드 강제 적용"]
    OverrideCheck -->|"자동 (agent_auto)"| CheckServer{"FastAPI / Flask / Express /\nHTTP 데몬 엔드포인트 포함?"}

    CheckServer -->|"Yes"| ModeServer["🖥️ LIVE_SERVER_DAEMON\n샌드박스 내 백그라운드 서버 부팅 +\nHTTP/CLI 타격 하네스 마운트"]
    CheckServer -->|"No"| CheckImports{"로컬 상대 경로 import 존재?\n(예: from .scoring import ...)"}

    CheckImports -->|"Yes"| ModePackage["📦 SPARSE_PACKAGE_TREE\nGitHub Trees API로 src/ 코드만 로드\n(uv.lock, PDF, 대용량 CSV 제외)"]
    CheckImports -->|"No"| ModeSingle["📄 SINGLE_FILE_UNIT\n변경된 단일 모듈/컴포넌트 1개만\nContents API로 즉시 로드 (~0.5s)"]
```

### 4.2 결정론적 채점 엔진(`backend/scoring.py`) 내부 데이터 변환 로직
LLM의 환각을 배제하기 위해 [`compute_deterministic_scores()`](file:///c:/Users/ttogl/workspace/google-hack/backend/scoring.py#L29-L119) 함수가 수행하는 정확한 데이터 필터링 파이프라인입니다.

```mermaid
flowchart LR
    RawPRResults["Track (a) 원시 결과\nList[SingleTestRunResult]\n(attempt_history[1..5], run_1_passed, run_2_passed)"] --> FilterA{"최대 5회 공격 루프 &\nRun 1 / Run 2 상태 판별"}

    FilterA -->|"5회 모두 방어 성공\n(Run 1 == True AND Run 2 == True)"| ValidBaseline["유효 기준선 테스트 집합\npassed_on_orig_set\n(Pass(t_j, PR_orig) == True)"]
    FilterA -->|"Attempt k(<=5)에서 BREACHED 후\nRun 1 == False AND Run 2 == False"| ConfirmedDefects["확정된 PR 실제 결함\nconfirmed_pr_failures\n(2/2 Reproduced Exploit at Attempt k/5)"]
    FilterA -->|"Run 1 != Run 2 (1회만 실패)"| FlakyFiltered["비결정적 플레이키 제외\nflaky_filtered_count += 1\n(노이즈 완전 제거)"]

    RawMutantMatrix["Track (b) 변이 실행 행렬\nmutant_matrix[M1..M8][test_id]"] --> EvalLoop["변이본 M_i별 교차 검증\n(for m_i in M1..M8)"]
    ValidBaseline -->|"교집합 필터링 (AND 연산)"| EvalLoop

    EvalLoop --> KillRule{"∃ t_j ∈ passed_on_orig_set\ns.t. mutant_matrix[m_i][t_j] == False?"}
    KillRule -->|"Yes (원본 PASS ∧ 변이 FAIL)"| CaughtMutant["CAUGHT (탐지 성공)\ncaught = True\ncaught_count (M) += 1"]
    KillRule -->|"No (모든 유효 테스트가 변이본 통과)"| SurvivingMutant["SURVIVED (미탐지 사각지대)\ncaught = False\nsurviving_mutants에 추가"]

    CaughtMutant --> ScoreOut["최종 탐지율 산출\ndetection_score_pct = round((M / K) * 100, 1)"]
    SurvivingMutant --> ScoreOut
```

> [!IMPORTANT]
> **왜 `passed_on_orig_set` 필터링이 필수적인가?**  
> 만약 공격 에이전트가 문법 오류(SyntaxError)나 잘못된 임포트(ImportError)가 있는 테스트 $t_{\text{bad}}$를 생성하면, 이 테스트는 원본 PR 코드에서도 실패(`Fail`)하고 8개 변이본(`M1..M8`)에서도 모두 실패(`Fail`)합니다.  
> 단순 실패 여부만 보면 8개 변이본을 모두 잡은 것(`100%`)처럼 착시 현상이 발생하지만, Argus-PR의 결정론적 엔진은 **`Pass(t_j, PR_orig) == True`인 테스트만 변이 사살 자격(Eligible Killer)을 부여**하므로 가짜 양성(False Positive Kill)을 100% 차단합니다.

---

## 5. 단계별 입출력 데이터 계약 요약표 (Data Contracts by Stage)

| 단계 (Stage) | 처리 모듈 / 함수 | 입력 데이터 (Input Schema) | 출력 데이터 (Output Schema) | 데이터 저장/격리 정책 |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 0: Guardrail** | `gemini_swarm.py` :: `run_prompt_injection_guardrail()` | `pr_data: dict` (`title`, `description`, `diff`, `original_code`) | [`GuardrailResult`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L7-L12) (`is_safe`, `risk_level`, `detected_threats`, `latency_ms`) | `store=False`, 정규식 1차 스캔 + `gemini-3.5-flash-lite` 2차 스캔 |
| **Stage 0.5: Scope Triage** | `main.py` / `gemini_swarm.py` :: `run_scope_triage()` | `files_data`, `diff`, `scope_override` | `ScopeTriageResult` (`scope_mode`, `mounted_files`, `skipped_heavy_paths`, `estimated_mount_size_kb`) | GitHub Contents/Trees API로 실행에 필요한 코드만 선택 로드 (무거운 lock/PDF 제외) |
| **Stage 1A: Planner** | `gemini_swarm.py` :: `extract_invariants_and_plan()` | 검증된 `pr_data: dict`, `ScopeTriageResult` | [`InvariantExtractionPlan`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L30-L33) (`invariants`, `attack_plans`) | `store=False`, **Track 1B와 컨텍스트 공유 제로** |
| **Stage 1B: Bug Planter** | `gemini_swarm.py` :: `plant_blind_bugs()` | 검증된 `pr_data: dict` | [`BlindMutantSet`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L46-L47) (`mutants`: `M1..M8`) | `store=False`, **Stage 3B 샌드박스 실행 전까지 SEALED 봉인** |
| **Stage 2 & 3A: Adaptive Red-Team Swarm** | `gemini_swarm.py` & `sandbox_runner.py` | `pr_data`, `InvariantExtractionPlan` (**`BlindMutantSet` 제외!**) | `List[AttackerSwarmOutput]` (최대 5회 `attempt_history` + 최종 `pytest_code`) | `Observe → Mutate → Attack` 루프 (`max_attempts=5`), 돌파 시 즉시 종료 후 2x Repro |
| **Stage 3B: Mutant Runner** | `sandbox_runner.py` :: `run_sandbox()` | `pr_data`, `BlindMutantSet`, `List[AttackerSwarmOutput]` | [`SandboxExecutionReport`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L88-L97) (`pr_test_results`, `mutant_matrix`, `sandbox_stdout_logs`) | 호스트 로컬 실행 금지; 원격 `antigravity-preview-09-2026` 또는 `Recorded Replay` |
| **Stage 4: Scoring Engine** | `scoring.py` :: `compute_deterministic_scores()` | `swarm_outputs`, `blind_mutants`, `sandbox_report` | [`DeterministicScoreReport`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L100-L111) (`M/K`, `confirmed_pr_failures`, `surviving_mutants`) | **100% 결정론적 Python 연산** (LLM 개입 없음) |
| **Stage 5: Synthesizer** | `gemini_swarm.py` :: `synthesize_one_card_summary()` | `pr_data`, `DeterministicScoreReport`, `InvariantExtractionPlan` | [`OneCardExecutiveSummary`](file:///c:/Users/ttogl/workspace/google-hack/backend/models.py#L114-L120) (`headline_verdict`, `recommended_fix_snippet`) | Python이 확정한 수치만 인용하여 정성적 리스크 및 패치 코드 작성 |
