# 🎬 Argus-PR: Guided 7-Step Demo Walkthrough (`🔴 1` $\to$ `🔴 7`)

- 🇰🇷 **한국어 가이드 바로가기**: [`docs/11_Guided_Demo_Walkthrough_ko.md`](./11_Guided_Demo_Walkthrough_ko.md)
- 🎬 **Interactive Web Video Player (`.webm` + Chapter Jumps)**: [**Watch Full HD Video in Browser →**](https://htmlpreview.github.io/?https://github.com/ttogle918/argus-pr-verifier/blob/main/demo_video.html) · [`../demo_video.html`](../demo_video.html)
- ⬇ **Direct Raw Video (`.webm`, 9.5 MB)**: [`../argus_pr_demo.webm`](../argus_pr_demo.webm)

---

## 🎥 Full End-to-End Animated Walkthrough (`🔴 1` $\to$ `🔴 7` + Bonus `PR #666`)

Every primary action button in the Argus-PR UI is prefixed with a red step indicator (`🔴 1` through `🔴 7`) so judges and reviewers can test the entire closed-loop pipeline in exact chronological order:

![Argus-PR Guided Demo GIF](../argus_pr_demo.gif)

---

## 🧭 Numbered UI Button Map (`🔴 1` ~ `🔴 7`)

| Step | UI Badge | Target Button & Selector | Pipeline Stage & Action |
| :--- | :--- | :--- | :--- |
| **Step 1** | `🔴 1` | **`PR Diff 보기` / `View PR Diff`** (`#toggle-diff-btn`) | Inspect the raw Pull Request code diff before verification. |
| **Step 2** | `🔴 2` | **`블라인드 검증 스웜 실행` / `Launch Blind Verification Swarm`** (`#launch-btn`) | Triggers Stage 0 Guardrail, Stage 0.5 Smart Scope Triage, Track 1A/1B (`gemini-4-argon`), Stage 2 Parallel 4x `gemini-3.8-flash` 5-Attempt Red-Team Swarm, and Stage 3 Dual-Track Sandbox. |
| **Step 3** | `🔴 3` | **`🔐 Run Multi-Persona BOLA DAST`** (`#run-live-dast-bola-btn`) | Mints 3 virtual JWT personas (`Victim: Tenant A`, `Attacker: Tenant B`, `Anonymous`) and executes cross-tenant HTTP replay (`PROVEN_BOLA_BYPASS` vs `ENFORCED_ISOLATION`). |
| **Step 4** | `🔴 4` / `🔴 4-1` | **`+ 커스텀 버그 심기` / `추가 & 재계산`** (`#toggle-mutant-form-btn`, `#submit-custom-mutant-btn`) | Allows judges to inject a custom synthetic bug (`M9`) on the fly and deterministically recompute the Blind Mutation Kill Score ($M/K$). |
| **Step 5** | `🔴 5` | **`권장 패치 적용 후 재검증` / `Apply Recommended Fix & Re-Verify`** (`#apply-patch-btn`) | Runs the **Stage 6 Blue-Team CEGIS Self-Healing Loop** across 4 Verification Gates (Attempt #1 fails at Gate 3 TOCTOU counterexample $\to$ Attempt #2 passes all 4/4 Gates). |
| **Step 6** | `🔴 6` | **`Export PR + Pinned Regression Test`** (`#export-bundle-btn`) | Opens the **Stage 7 Living Security Regression Suite Modal** with the verified patch diff, pinned `pytest` regression suite, and GitHub Actions CI YAML. |
| **Step 7** | `🔴 7` | **`병합 최종 승인` / `Approve Merge`** (`#approve-btn`, `#reject-btn`) | Records the **Human-in-the-Loop** final merge gate decision in SQLite. |

---

## 📸 Step-by-Step Visual Snapshots

### Step 0 & Step 1 (`🔴 1`): Inspect PR Diff (`#toggle-diff-btn`)
![Step 1 - View PR Diff](./screenshots/demo_step_1_diff.png)

---

### Step 2 (`🔴 2`): Launch Blind Verification Swarm (`#launch-btn`)
Runs the 4 parallel `gemini-3.8-flash` red-team attackers (up to 5 adaptive rounds: `Observe → Mutate → Attack`) alongside the sealed 8-mutant blind calibration track (`M1..M8`):
![Step 2 - Blind Verification Swarm Complete](./screenshots/demo_step_2_launch.png)

---

### Step 3 (`🔴 3`): Run Multi-Persona Cross-Tenant BOLA DAST (`#run-live-dast-bola-btn`)
Synthesizes `OWNER_VICTIM (Tenant A)`, `CROSS_TENANT_ATTACKER (Tenant B)`, and `ANONYMOUS` tokens to prove horizontal privilege escalation (`PROVEN_BOLA_BYPASS` with HTTP `200 OK` on cross-tenant resource access):
![Step 3 - Multi-Persona BOLA DAST Matrix](./screenshots/demo_step_3_bola_dast.png)

---

### Step 4 (`🔴 4` & `🔴 4-1`): Plant Custom Mutant Bug & Recompute Score (`#toggle-mutant-form-btn`)
Judges can plant an additional custom bug (`M9: Off-by-one pipe index skip`) and watch `backend/scoring.py` recompute the detection score (`8/9 = 88.9%`):
![Step 4 - Custom Mutant Injection](./screenshots/demo_step_4_custom_mutant.png)

---

### Step 5 (`🔴 5`): Blue-Team CEGIS Self-Healing 4-Gate Loop (`#apply-patch-btn`)
Shows **Attempt #1 (`FAILED_COUNTEREXAMPLE` at Gate 3)** self-healing into **Attempt #2 (`VERIFIED` across all 4 Gates)** and transitioning the verdict from `BLOCK_MERGE` to `ALLOW_MERGE (100% 9/9 Mutants Killed)`:
![Step 5 - Blue-Team CEGIS Self-Healing Patch Verified](./screenshots/demo_step_5_cegis_patch.png)

---

### Step 6 (`🔴 6`): Export Verified PR Bundle & Pinned Regression Test (`#export-bundle-btn`)
Exports the verified production patch diff together with the pinned `pytest` security regression test (`tests/test_regression_pr_142.py`):
![Step 6 - Export PR Bundle Modal](./screenshots/demo_step_6_export_bundle.png)

---

### Step 7 (`🔴 7`): Human-in-the-Loop Merge Approval (`#approve-btn`)
Final human sign-off persisted to the SQLite audit log:
![Step 7 - Human Merge Gate Approved](./screenshots/demo_step_7_approved.png)

---

### 🛡️ Bonus (`PR #666`): Stage 0 Adversarial Prompt-Injection Guardrail
Selecting `PR #666` and clicking `🔴 2` triggers `gemini-3.5-flash-lite` (`store=False`), which intercepts the embedded `# SYSTEM OVERRIDE` instruction in `<100ms` and halts the pipeline before sandbox execution:
![Bonus Step 8 - Stage 0 Prompt Injection Guardrail Quarantine](./screenshots/demo_step_8_guardrail_blocked.png)
