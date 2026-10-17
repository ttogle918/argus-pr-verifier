# 🎬 Argus-PR: Guided 7-Step Demo Walkthrough (Start → Run → Verify → Decide)

- 🇰🇷 **한국어 가이드 바로가기**: [`docs/11_Guided_Demo_Walkthrough_ko.md`](./11_Guided_Demo_Walkthrough_ko.md)
- 🎬 **Interactive Web Video Player (`.webm` + Chapter Jumps)**: [**Watch Full HD Video in Browser →**](https://htmlpreview.github.io/?https://github.com/ttogle918/argus-pr-verifier/blob/main/demo_video.html) · [`../demo_video.html`](../demo_video.html)
- ⬇ **Direct Raw Video (`.webm`, ~10 MB, ~37 s)**: [`../argus_pr_demo.webm`](../argus_pr_demo.webm) · Korean UI: [`../argus_pr_demo_ko.webm`](../argus_pr_demo_ko.webm)

---

## 🎥 Full End-to-End Animated Walkthrough (Steps 1 → 7 + Bonus `PR #666`)

The redesigned UI is a four-screen flow: **1 Start → 2 Run → 3 Verify → 4 Decide**, plus overlays (PR diff drawer, Run details drawer, Import PR, Export). The header shows the `EN` / `KO` language toggle and the `RECORDED REPLAY` / `SAMPLE DATA` badges. The demo below walks the seven steps in chronological order:

![Argus-PR Guided Demo GIF](../argus_pr_demo.gif)

**Video chapters** (seconds into `argus_pr_demo.webm`): 1.5 Start · 2.9 Step 1 diff · 5.0 Step 2 run · 11.0 Step 3 Live DAST · 14.9 Verify matrix · 19.2 Step 4 calibration mutant · 23.5 Step 5 fix & re-verify · 27.9 Step 6 export · 31.1 Step 7 approval · 34.3 Bonus PR #666 blocked.

---

## 🧭 UI Control Map (Steps 1 ~ 7)

| Step | Screen | Control (`data-testid`) | Pipeline Stage & Action |
| :--- | :--- | :--- | :--- |
| **Step 1** | Start | **`View PR diff`** (`open-diff`) | Inspect the raw Pull Request code diff in a drawer before verification. |
| **Step 2** | Start → Run | **`Run verification`** (`run-button`) | Triggers Stage 0 Guardrail, Stage 0.5 Smart Scope Triage, Track 1A/1B (`gemini-4-argon`), Stage 2 Parallel 4x `gemini-3.8-flash` 5-Attempt Red-Team Swarm, and Stage 3 Dual-Track Sandbox. The Run screen shows the 8-eye signature scene (`7/8` planted bugs caught) and the attacker lanes. |
| **Step 3** | Run → Run details drawer | **`Run details`** (`open-run-details`), then **`Run BOLA check`** (`dast-run`) | Mints 3 virtual JWT personas (`Victim: Tenant A`, `Attacker: Tenant B`, `Anonymous`) and executes cross-tenant HTTP replay (`PROVEN_BOLA_BYPASS` vs `ENFORCED_ISOLATION`). |
| — | Run → Verify | **`See verification matrix`** (`continue-verify`) | Opens the Verify screen: tests × 8 mutants matrix (`M8` survived). |
| **Step 4** | Verify | **`+ Plant calibration mutant`** (`open-mutant-form`), then **`Add M9 and recalculate`** (`mutant-submit`) | Inject a custom synthetic bug (`M9`) on the fly; the matrix grows to 9 columns and `backend/scoring.py` deterministically recomputes the Blind Mutation Kill Score ($M/K$). |
| — | Verify → Decide | **`Continue to decision`** (`continue-decide`) | Opens the one-card Decide screen: score, confirmed defects, residual risk, recommended fix. |
| **Step 5** | Decide | **`Apply fix & re-verify`** (`apply-patch`) | Runs the **Stage 6 Blue-Team CEGIS Self-Healing Loop** across 4 Verification Gates (Attempt #1 fails at Gate 3 TOCTOU counterexample $\to$ Attempt #2 passes all 4/4 Gates) and shows a before/after table. |
| **Step 6** | Decide | **`Export PR + pinned regression test`** (`open-export`) | Opens the **Stage 7 Living Security Regression Suite** overlay with tabs for the patched diff, the pinned `pytest` regression test, and the GitHub Actions CI YAML. |
| **Step 7** | Decide | **`Approve & merge`** (`approve-button`) / **`Reject merge & request fixes`** (`reject-button`) | Records the **Human-in-the-Loop** final merge gate decision in SQLite ("Merge approved"). |
| Bonus | Start → Run | Select `PR #666`, **`Run verification`** | Stage 0 guardrail halts the run and shows the blocked panel (`blocked-panel`). |
| — | Start | **`Import PR`** (`open-import`) | Import a real PR via upload, GitHub URL, or pasted diff. |
| — | Header | **`EN` / `KO`** (`lang-en`, `lang-ko`) | Switches every screen and overlay between English and Korean instantly. |

---

## 📸 Step-by-Step Visual Snapshots

### Start: pick a sample PR (`PR #412`)
The Start screen with the sample PR selected and the `EN` / `KO` toggle in the header:
![Start - PR #412 selected](./screenshots/demo_step_0_initial.png)

---

### Step 1: Inspect PR Diff (`open-diff`)
![Step 1 - View PR Diff](./screenshots/demo_step_1_diff.png)

---

### Step 2: Run Verification (`run-button`)
Runs the 4 parallel `gemini-3.8-flash` red-team attackers (up to 5 adaptive rounds: `Observe → Mutate → Attack`) alongside the sealed 8-mutant blind calibration track (`M1..M8`). The signature scene shows 8 eyes; `7/8` planted bugs are caught and `M8` survived:
![Step 2 - Run screen after verification](./screenshots/demo_step_2_launch.png)

---

### Step 3: Run Multi-Persona Cross-Tenant BOLA DAST (`open-run-details` → `dast-run`)
Open **Run details**, then **Run BOLA check**. It synthesizes `OWNER_VICTIM (Tenant A)`, `CROSS_TENANT_ATTACKER (Tenant B)`, and `ANONYMOUS` tokens to prove horizontal privilege escalation (`PROVEN_BOLA_BYPASS` with HTTP `200 OK` on cross-tenant resource access):
![Step 3 - Multi-Persona BOLA DAST table](./screenshots/demo_step_3_bola_dast.png)

Then **See verification matrix** (`continue-verify`) opens the Verify screen with the tests × mutants matrix (`M8` selected, survived):
![Verify - tests x 8 mutants matrix](./screenshots/demo_step_3_bola_matrix.png)

---

### Step 4: Plant Custom Mutant Bug & Recompute Score (`open-mutant-form` → `mutant-submit`)
Plant an additional calibration mutant (`M9`) and watch `backend/scoring.py` recompute the detection score; the matrix now has 9 columns and the score is `7/9 = 77.8%` because `M9` survives the swarm's tests:
![Step 4 - Custom Mutant Injection (M9)](./screenshots/demo_step_4_custom_mutant.png)

**Continue to decision** (`continue-decide`) opens the one-card Decide screen (score, confirmed defects, surviving mutants, residual risk, recommended fix):
![Decide - one-card summary](./screenshots/demo_step_4_blind_mutants.png)

---

### Step 5: Blue-Team CEGIS Self-Healing 4-Gate Loop (`apply-patch`)
Shows **Attempt #1 (`Failed at gate 3`, TOCTOU counterexample)** self-healing into **Attempt #2 (`Verified · 4/4 gates`)**. The before/after table moves from `Reject recommended · risk HIGH` (`7/9`) to `Approve recommended · risk LOW` (`9/9 · 100%`, 0 confirmed defects):
![Step 5 - Blue-Team CEGIS Self-Healing Patch Verified](./screenshots/demo_step_5_cegis_patch.png)

---

### Step 6: Export Verified PR Bundle & Pinned Regression Test (`open-export`)
Exports the verified production patch diff together with the pinned `pytest` security regression test and CI YAML, each in its own tab:
![Step 6 - Export overlay](./screenshots/demo_step_6_export_bundle.png)

---

### Step 7: Human-in-the-Loop Merge Approval (`approve-button`)
Final human sign-off ("Merge approved") persisted to the SQLite audit log, with **Change decision**, **Export PR + pinned regression test** and **Download JSON report** still available:
![Step 7 - Human Merge Gate Approved](./screenshots/demo_step_7_approved.png)

---

### 🌐 Language toggle (`lang-en` / `lang-ko`)
Click **KO** in the header at any time to switch the whole UI to Korean (and **EN** to switch back). The Korean recording [`../argus_pr_demo_ko.gif`](../argus_pr_demo_ko.gif) / [`../argus_pr_demo_ko.webm`](../argus_pr_demo_ko.webm) starts in English and flips with the toggle; Korean screenshots live in `docs/screenshots/ko/` under the same file names.

---

### 🛡️ Bonus (`PR #666`): Stage 0 Adversarial Prompt-Injection Guardrail
Selecting `PR #666` and clicking **Run verification** triggers `gemini-3.5-flash-lite` (`store=False`), which intercepts the embedded `# SYSTEM OVERRIDE` instruction in `<100ms` and halts the pipeline before sandbox execution (`blocked-panel`):
![Bonus Step 8 - Stage 0 Prompt Injection Guardrail Quarantine](./screenshots/demo_step_8_guardrail_blocked.png)

---

### 🔁 Re-recording the media
`.venv/Scripts/python.exe scripts/record_gif.py --lang en` (or `--lang ko`) regenerates the GIF, video and screenshots. Browser E2E: `.venv/Scripts/python.exe scripts/e2e_frontend.py`; frontend unit tests: `npm run test:frontend`.
