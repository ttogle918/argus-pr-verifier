# 🎬 Argus-PR: 7단계 데모 시연 가이드 및 영상 (Start → Run → Verify → Decide)

- 🇺🇸 **English Walkthrough**: [`docs/11_Guided_Demo_Walkthrough.md`](./11_Guided_Demo_Walkthrough.md)
- 🎬 **인터랙티브 웹 비디오 플레이어 (`.webm` + 챕터 점프 지원)**: [**웹 브라우저에서 고화질 데모 영상 바로 재생하기 →**](https://htmlpreview.github.io/?https://github.com/ttogle918/argus-pr-verifier/blob/main/demo_video.html) · [`../demo_video.html`](../demo_video.html)
- ⬇ **원본 비디오 파일 직접 보기/다운로드 (한국어 UI, `.webm`, 약 10 MB, 약 37초)**: [`../argus_pr_demo_ko.webm`](../argus_pr_demo_ko.webm) · 영어 UI: [`../argus_pr_demo.webm`](../argus_pr_demo.webm)

---

## 🎥 전체 시나리오 자동 녹화 애니메이션 (1~7단계 + 보너스 `PR #666`)

재설계된 UI는 **1 Start → 2 Run → 3 Verify → 4 Decide** 4개 화면과 오버레이(PR diff 서랍, 실행 상세 서랍, PR 가져오기, 내보내기)로 구성됩니다. 헤더에는 `EN` / `KO` 언어 토글과 `RECORDED REPLAY` / `SAMPLE DATA` 배지가 있습니다. 아래 영상은 영어 UI로 시작해 `KO` 토글로 한국어로 전환한 뒤 7단계를 순서대로 시연합니다:

![Argus-PR Guided Demo GIF (KO)](../argus_pr_demo_ko.gif)

**영상 챕터** (`argus_pr_demo_ko.webm` 기준 초): 1.4 EN→KO 토글 · 3.0 Start · 4.3 1단계 · 6.1 2단계 · 12.2 3단계 · 15.3 Verify · 19.1 4단계 · 23.2 5단계 · 28.0 6단계 · 31.2 7단계 · 34.5 보너스.

---

## 🧭 UI 컨트롤 단계별 클릭 순서 요약표

| 단계 | 화면 | 컨트롤 이름 (`data-testid`) | 실행되는 파이프라인 단계 및 핵심 검증 동작 |
| :--- | :--- | :--- | :--- |
| **1단계** | Start | **`PR diff 보기`** (`open-diff`) | 검증 전 대상 Pull Request의 원본 코드 변경점(Unified Diff)을 서랍으로 펼쳐서 확인합니다. |
| **2단계** | Start → Run | **`검증 실행`** (`run-button`) | Stage 0 가드레일 $\to$ Stage 0.5 스마트 범위 분류 $\to$ Track 1A/1B (`gemini-4-argon` 정보 격리) $\to$ Stage 2 병렬 `4x gemini-3.8-flash` 5회 적응형 공격 루프 $\to$ Stage 3 듀얼 트랙 샌드박스를 실행합니다. Run 화면에 눈 8개 시그니처 장면(`7/8` 탐지)과 공격자 레인이 표시됩니다. |
| **3단계** | Run → 실행 상세 서랍 | **`실행 상세`** (`open-run-details`) 후 **`BOLA 점검 실행`** (`dast-run`) | 3개의 가상 JWT 페르소나(`Victim: Tenant A`, `Attacker: Tenant B`, `Anonymous`)를 즉석 발급해 테넌트 간 권한 우회(`PROVEN_BOLA_BYPASS` vs `ENFORCED_ISOLATION`)를 실증합니다. |
| — | Run → Verify | **`검증 매트릭스 보기`** (`continue-verify`) | 테스트 × 8개 mutant 매트릭스가 있는 Verify 화면을 엽니다 (`M8` 생존). |
| **4단계** | Verify | **`+ 보정용 mutant 심기`** (`open-mutant-form`) 후 **`M9 추가 및 재계산`** (`mutant-submit`) | 커스텀 인공 버그(`M9`)를 즉석에서 주입하면 매트릭스가 9열로 늘어나고, `backend/scoring.py`가 블라인드 변이 탐지율($M/K$)을 결정론적으로 재계산합니다. |
| — | Verify → Decide | **`결정으로 계속`** (`continue-decide`) | 점수, 확정 결함, 잔여 위험, 권장 수정을 한 장에 보여주는 Decide 화면을 엽니다. |
| **5단계** | Decide | **`수정 적용 & 재검증`** (`apply-patch`) | **Stage 6 Blue-Team CEGIS 4-Gate 자가 치유 루프**를 가동하여 Attempt #1(Gate 3 TOCTOU 반례 실패) $\to$ Attempt #2(4대 게이트 전원 통과)로 패치를 완성하고 전/후 비교표를 보여줍니다. |
| **6단계** | Decide | **`PR + 고정 회귀 테스트 내보내기`** (`open-export`) | **Stage 7 영구 보안 회귀 테스트 번들 오버레이**를 열어 검증된 패치 Diff / 고정 `pytest` 회귀 테스트 / GitHub Actions CI YAML을 탭별로 확인합니다. |
| **7단계** | Decide | **`승인 & 머지`** (`approve-button`) / **`머지 반려 & 수정 요청`** (`reject-button`) | **Human-in-the-Loop 최종 병합 게이트** 결정("머지 승인됨")을 SQLite 감사 로그에 영구 기록합니다. |
| 보너스 | Start → Run | `PR #666` 선택 후 **`검증 실행`** | Stage 0 가드레일이 실행을 중단하고 차단 패널(`blocked-panel`)을 표시합니다. |
| — | Start | **`PR 가져오기`** (`open-import`) | 파일 업로드, GitHub URL, Diff 붙여넣기로 실제 PR을 가져옵니다. |
| — | 헤더 | **`EN` / `KO`** (`lang-en`, `lang-ko`) | 모든 화면과 오버레이를 영어/한국어로 즉시 전환합니다. |

---

## 📸 단계별 실제 실행 화면 캡처 (1~7단계 + 보너스)

### Start: 샘플 PR 선택 (`PR #412`)
샘플 PR이 선택된 Start 화면과 헤더의 `EN` / `KO` 토글:
![Start - PR #412 선택](./screenshots/ko/demo_step_0_initial.png)

---

### Step 1: PR 코드 변경점(Diff) 확인 (`open-diff`)
![Step 1 - PR diff 보기](./screenshots/ko/demo_step_1_diff.png)

---

### Step 2: 검증 실행 (`run-button`)
4개의 `gemini-3.8-flash` 에이전트가 5회 적응형 공격 루프(`Observe → Mutate → Attack`)로 공격하고, 봉인된 인공 버그 8개(`M1..M8`) 중 7개(`87.5%`)를 탐지합니다. 눈 8개 시그니처 장면에서 `M8`은 생존으로 표시됩니다:
![Step 2 - 검증 실행 후 Run 화면](./screenshots/ko/demo_step_2_launch.png)

---

### Step 3: 멀티 페르소나 교차 테넌트 BOLA DAST 실행 (`open-run-details` → `dast-run`)
**실행 상세**를 열고 **BOLA 점검 실행**을 누릅니다. `Victim (Tenant A)`, `Attacker (Tenant B)`, `Anonymous` 3개 페르소나로 엔드포인트를 교차 호출하여 수평적 권한 상승(`PROVEN_BOLA_BYPASS`)을 결정론적으로 입증합니다:
![Step 3 - 멀티 페르소나 BOLA DAST 표](./screenshots/ko/demo_step_3_bola_dast.png)

이어서 **검증 매트릭스 보기**(`continue-verify`)로 테스트 × mutant 매트릭스가 있는 Verify 화면을 엽니다 (`M8` 선택, 생존):
![Verify - 테스트 × 8개 mutant 매트릭스](./screenshots/ko/demo_step_3_bola_matrix.png)

---

### Step 4: 보정용 mutant(`M9`) 주입 및 탐지율 재계산 (`open-mutant-form` → `mutant-submit`)
9번째 보정용 mutant(`M9`)를 심으면 `backend/scoring.py`가 탐지율을 재계산합니다. 매트릭스는 9열이 되고, `M9`가 스웜 테스트를 통과해 생존하므로 점수는 `7/9 = 77.8%`가 됩니다:
![Step 4 - 보정용 mutant 심기 (M9)](./screenshots/ko/demo_step_4_custom_mutant.png)

**결정으로 계속**(`continue-decide`)을 누르면 점수, 확정 결함, 생존 mutant, 잔여 위험, 권장 수정을 한 장에 담은 Decide 화면이 열립니다:
![Decide - 원카드 요약](./screenshots/ko/demo_step_4_blind_mutants.png)

---

### Step 5: 수정 적용 & 재검증 — Blue-Team CEGIS 4-Gate 루프 (`apply-patch`)
Attempt #1이 Gate 3(TOCTOU 반례)에서 기각된 뒤, 반례 트레이스를 피드백받은 Attempt #2가 4대 검증 게이트를 모두 통과(`Verified · 4/4 gates`)합니다. 전/후 비교표가 `7/9`, 위험 HIGH(반려 권고)에서 `9/9 · 100%`, 확정 결함 0건, 위험 LOW(승인 권고)로 바뀝니다:
![Step 5 - Blue-Team CEGIS 자가 치유 패치 완료](./screenshots/ko/demo_step_5_cegis_patch.png)

---

### Step 6: 검증된 PR 패치 + 고정 회귀 테스트 번들 추출 (`open-export`)
원래 PR을 뚫었던 `2/2 PROVEN` 익스플로잇을 영구 `pytest` 회귀 테스트 코드로 변환하여 패치 Diff, CI YAML과 함께 탭별로 내보냅니다:
![Step 6 - 내보내기 오버레이](./screenshots/ko/demo_step_6_export_bundle.png)

---

### Step 7: Human-in-the-Loop 병합 최종 승인 (`approve-button`)
모든 결함이 해결되고 변이 탐지율 100%가 증명된 상태에서 인간 리뷰어가 최종 병합을 승인합니다. 승인 후에도 결정 변경, 내보내기, JSON 리포트 다운로드를 사용할 수 있습니다:
![Step 7 - 머지 승인됨](./screenshots/ko/demo_step_7_approved.png)

---

### 🌐 언어 토글 (`lang-en` / `lang-ko`)
헤더의 **KO**를 누르면 전체 UI가 한국어로, **EN**을 누르면 영어로 즉시 전환됩니다. 한국어 녹화본 [`../argus_pr_demo_ko.gif`](../argus_pr_demo_ko.gif) / [`../argus_pr_demo_ko.webm`](../argus_pr_demo_ko.webm)은 영어로 시작해 토글로 전환되며, 한국어 스크린샷은 `docs/screenshots/ko/`에 같은 파일명으로 있습니다.

---

### 🛡️ 보너스 (`PR #666`): Stage 0 적대적 프롬프트 인젝션 가드레일 즉시 차단
`PR #666` 선택 후 **검증 실행**을 누르면 `gemini-3.5-flash-lite`가 주석에 숨겨진 `# SYSTEM OVERRIDE` 프롬프트 인젝션을 100ms 이내에 포착하여 서킷 브레이커를 작동시킵니다 (`blocked-panel`):
![Bonus Step 8 - Stage 0 프롬프트 인젝션 차단](./screenshots/ko/demo_step_8_guardrail_blocked.png)

---

### 🔁 미디어 재녹화
`.venv/Scripts/python.exe scripts/record_gif.py --lang ko` (또는 `--lang en`)로 GIF, 영상, 스크린샷을 다시 생성합니다. 브라우저 E2E: `.venv/Scripts/python.exe scripts/e2e_frontend.py`, 프론트엔드 단위 테스트: `npm run test:frontend`.
