# Argus-PR Architecture & Flow Diagrams (Mermaid Source)

> **Document ID**: `docs/presentation_diagrams.md`  
> **Purpose**: Mermaid source definitions for all system architecture, blind verification, multi-agent orchestration, and CEGIS self-healing diagrams in the Argus-PR project presentation.

---

## 1. Dual-Track Blind Verification Architecture (`diagram_dual_track.svg`)

```mermaid
flowchart TD
    PR["Untrusted Pull Request + Repo Context\n(Diff, Codebase, Commit Message)"] --> Guard["0. Prompt-Injection Guardrail\n(gemini-3.5-flash-lite | store=False)\nBlocks adversarial PR comments/instructions (~68ms)"]
    
    Guard -->|Sanitized PR Context| Planner["1A. Invariant Extractor & Attack Planner\n(gemini-4-argon | store=False)\nExtracts Formal Invariants INV-1..4 & Target Plans"]
    Guard -->|Sanitized PR Context| Planter["1B. Blind Bug Planter (Isolated Call)\n(gemini-4-argon | store=False)\nPlants 8 subtle bugs in shadow copies (M1..M8)"]
    
    Planner -->|Invariants & Attack Plan ONLY\n(Zero knowledge of planted bugs)| Swarm["2. Parallel Attacker Swarm\n(4x gemini-3.8-flash | asyncio.gather)"]
    
    subgraph Swarm ["Parallel Attacker Swarm (gemini-3.8-flash)"]
        S1["Security Attacker\n(Auth, BOLA, Injection, Traversal)"]
        S2["Edge-Case Attacker\n(Boundaries, Nulls, DivZero, Overflow)"]
        S3["State & Concurrency Attacker\n(Race conditions, Idempotency, Deadlock)"]
        S4["Regression Attacker\n(API Contract, Breaking Schema Changes)"]
    end

    Swarm -->|Generated Test Suite T| SandboxA["3A. Antigravity Sandbox: PR Code\n(antigravity-preview-09-2026)\nFinds real PR bugs (Phase 2: 2x Repro Filter)"]
    Swarm -->|Generated Test Suite T| SandboxB["3B. Antigravity Sandbox: 8 Mutants\n(antigravity-preview-09-2026)\nDifferential Execution against M1..M8"]
    Planter -.->|Secret Answer Key: Mutants M1..M8\n(Strict Information Wall: Hidden from Swarm)| SandboxB

    SandboxA -->|PR Pass/Fail Matrix| Calc["4. Deterministic Score Engine (Python scoring.py)\n- Real PR Bugs: Confirmed 2/2 Reproductions\n- Mutant Caught iff: Pass(PR_orig) AND Fail(Mutant)\n- Exact M/K Score: 7 of 8 caught (87.5%)"]
    SandboxB -->|Mutant Pass/Fail Matrix| Calc
    Planter -.->|Mutant Metadata| Calc

    Calc -->|Immutable Score + Surviving Mutants| Synth["5. One-Card Risk Synthesizer\n(gemini-4-argon | store=False)\nExplains residual risk from uncaught mutant M8"]
    Synth --> UI["6. Human Review One-Card UI\n(Verdict, Residual Risk, Patch & Merge Gate)"]
```

---

## 2. End-to-End User Journey & Reviewer Workflow (`diagram_user_journey.svg`)

```mermaid
sequenceDiagram
    autonumber
    actor Dev as 👤 Reviewer / Developer
    participant UI as 🖥️ Argus-PR Web UI
    participant Guard as 🛡️ Stage 0 Guardrail (Flash-Lite)
    participant Slicer as ⚙️ Stage 0.5 Scope Slicer (Python AST)
    participant DualTrack as 🎭 Stage 1 Dual-Track (Argon store=False)
    participant Swarm as ⚡ Stage 2 Attacker Swarm (4x Flash)
    participant Sandbox as 🐳 Stage 3 Isolated Sandbox
    participant PyScore as 📐 Stage 4a Scoring Engine (Python)
    participant Synth as 🧾 Stage 4b Synthesizer (Argon)
    participant CEGIS as 🛠️ Stage 5 CEGIS Patch & Export

    Dev->>UI: 1. Select PR or Upload Workspace (Toggle: Replay vs Live API)
    UI->>Guard: POST /api/verify/stream (PR Diff + Comments)
    
    rect rgb(240, 253, 244)
        Note over Guard: Prompt Injection & Adversarial Payload Scan
        alt Malicious Prompt Detected
            Guard-->>UI: 🛑 Blocked (Quarantined) - Zero LLM/Sandbox cost
        else Clean PR
            Guard->>Slicer: Pass Sanitized PR Context
        end
    end

    rect rgb(238, 242, 253)
        Note over Slicer: AST/Regex Import Graph BFS (Depth <= 3)
        Slicer->>DualTrack: Trimmed Codebase (70~90% irrelevant files stripped)
    end

    rect rgb(245, 243, 255)
        Note over DualTrack: Information Wall (store=False)
        par Track 1A: Planner
            DualTrack->>Swarm: Invariant Extraction Plan (INV-1..4)
        and Track 1B: Planter
            DualTrack->>Sandbox: Sealed 8 Mutants (M1..M8)
        end
    end

    rect rgb(254, 242, 242)
        Note over Swarm: 4x Parallel Adaptive Red-Team
        Swarm->>Sandbox: Execute Generated pytest Suite T
    end

    rect rgb(255, 247, 237)
        Note over Sandbox: 2x Repro Filter + Differential Mutant Execution
        Sandbox->>PyScore: Raw Execution Traces & Pass/Fail Matrix
    end

    rect rgb(240, 249, 255)
        Note over PyScore: Pure Deterministic Algebra (Zero Hallucination)
        PyScore->>Synth: Exact M/K Score (7/8 = 87.5%) + Surviving Mutant M8
        Synth-->>UI: Streamed One-Card Summary + Explanations
    end

    UI-->>Dev: Display Lane View + 7/8 Score + One-Card Verdict

    opt Apply Self-Healing Patch (CEGIS Loop)
        Dev->>CEGIS: Click "Apply Recommended Patch & Re-Verify"
        loop Up to 5 Attempts (4-Gate Verifier)
            CEGIS->>CEGIS: Patch Refinement with Counterexamples
        end
        CEGIS-->>UI: Verified Patch + Export Regression Suite (CI YAML + pytests)
    end
```

---

## 3. Dual-Layer AI Model Routing & Build-Time Subagent Delegation (`diagram_agent_hierarchy.svg`)

```mermaid
flowchart TB
    subgraph LayerA ["Layer A: In-App Runtime AI Model Routing (google-genai SDK)"]
        direction LR
        M1["gemini-3.5-flash-lite\n• Stage 0 Perimeter Guardrail\n• ~68ms Low Latency\n• store=False, Zero State"]
        M2["gemini-4-argon\n• Track 1A Invariants & Plans\n• Track 1B Secret 8 Mutants\n• Stage 4b One-Card Synthesizer"]
        M3["4x gemini-3.8-flash\n• Stage 2 Attacker Swarm\n• asyncio.gather Parallelism\n• 5-Attempt Red-Team Logic"]
        M4["antigravity-preview-09-2026\n• Stage 3 Isolated Sandbox\n• 2x Repro Flaky Elimination\n• Differential Mutant Kills"]
        M1 --> M2 --> M3 --> M4
    end

    subgraph LayerB ["Layer B: Build-Time Subagent Delegation Criteria (invoke_subagent)"]
        direction TB
        Lead["👑 Lead Architect Agent (Parent Session)\n• Architecture Blueprint, Pydantic Schema, Deterministic Python Engine"]
        
        subgraph TierPro ["Model Tier: pro (Gemini 4 Argon) — Deep Reasoning & Complex UX"]
            S_Arch["Subagent #1: Blind Sandbox Architect\n• Information Wall Isolation\n• Remote/Local Dual-Track Harness"]
            S_UI["Subagent #3: Swimlane & One-Card UI Engineer\n• Real-Time SSE State Machine\n• Responsive PPT Layout & Themes"]
        end

        subgraph TierFlash ["Model Tier: flash (Gemini 3.8 Flash) — Rapid Generation & Automation"]
            S_Bench["Subagent #2: Benchmark & FastAPI Builder\n• High-Fidelity PR Testbeds\n• SSE Streaming Boilerplates"]
            S_E2E["Subagent #4: E2E Playwright & GIF Recorder\n• Headless Browser Automation\n• Frame-by-Frame Demo Recording"]
        end

        Lead ==>|"Deep Architecture / Strict State"| TierPro
        Lead ==>|"Boilerplate / Testbed / Browser Capture"| TierFlash
    end
```

---

## 4. CEGIS Self-Healing Patch Loop & Regression Asset Export (`diagram_cegis_and_bundle.svg`)

```mermaid
flowchart TD
    BugFound["Real PR Bug Detected or Mutant Survived\n(e.g., Race Condition in Checkout / BOLA Vulnerability)"] --> PatchGen["1. Candidate Patch Generation\n(gemini-4-argon | patch_node)\nGenerates Unified Diff targeting root cause"]
    
    PatchGen --> Gate1["Gate 1: AST Syntax & Lint Check\n(Deterministic Python)"]
    Gate1 -- Pass --> Gate2["Gate 2: Semgrep Security Rules\n(Deterministic Static Analysis)"]
    Gate2 -- Pass --> Gate3["Gate 3: Live DAST & Swarm Replay\n(Isolated Sandbox | 2/2 Pass Required)"]
    Gate3 -- Pass --> Gate4["Gate 4: Blind Mutant Re-Kill Check\n(Ensure mutation score >= 87.5%)"]

    Gate1 -- Fail: Syntax Error --> CE["Counterexample Feedback\n(AST errors / DAST traces / Surviving mutant diff)"]
    Gate2 -- Fail: Security Violation --> CE
    Gate3 -- Fail: Test Failure / Regr --> CE
    Gate4 -- Fail: Regressed Mutant --> CE

    CE -->|"Max 5 Attempts (TASK-3802)"| PatchGen

    Gate4 -- "All 4 Gates PASS (VERIFIED)" --> Export["Export PR Regression Bundle\n(POST /api/prs/export-bundle)"]
    
    subgraph Bundle ["Permanently Pinned PR Assets"]
        B1["1. Verified Unified Patch Diff\n(Ready for git apply / GitHub PR commit)"]
        B2["2. tests/security/test_argus_regression_*.py\nPermanently pinned breaking test as regression guard"]
        B3["3. .github/workflows/argus-gate.yml\nContinuous Verification Gate for CI/CD"]
    end

    Export --> Bundle
    Bundle --> HumanGate["Human Decision Gate (One-Card Approval)"]
```

---

## 5. Stage 0 & 0.5: Perimeter Guardrail & Smart Scope Slicer (`diagram_stage0_guardrail.svg`)

```mermaid
flowchart LR
    Input["Untrusted PR / Diff / GitHub PR\n(Comments, Code, Docstrings)"] --> Guard{"Stage 0: Guardrail\n(gemini-3.5-flash-lite)\n~68ms latency"}
    
    Guard -->|"BLOCKED (Adversarial Prompt)"| Quarantine["Quarantine & Reject\n• Zero downstream LLM cost\n• Zero sandbox runs"]
    Guard -->|"SAFE (Clean Logic)"| Triage["Stage 0.5: Smart Scope Slicer\n(Python AST BFS traversal)"]
    
    Triage --> M1["SINGLE_FILE_UNIT (~0.5s)\nIsolated function / module"]
    Triage --> M2["SPARSE_PACKAGE_TREE (~1.5s)\nTrim 70~90% irrelevant assets"]
    Triage --> M3["LIVE_SERVER_DAEMON\nEphemeral ASGI/WSGI Server"]
```

---

## 6. Stage 2: 4x Parallel Attacker Swarm & BOLA Cross-Tenant Matrix (`diagram_stage2_swarm.svg`)

```mermaid
flowchart TD
    Invariants["Sanitized Invariants (INV-1..4)\n(from Track 1A Invariant Extractor)"] --> Swarm["Parallel Attacker Swarm (4x gemini-3.8-flash)"]
    
    subgraph Swarm
        S1["Security Attacker\n• 5-Attempt Red-Team Loop\n• CWE-639, 89, 22"]
        S2["Edge-Case Attacker\n• Off-by-one, Null, Overflow\n• Boundary condition stress"]
        S3["State Attacker\n• 50 concurrent threads\n• Race conditions & TOCTOU"]
        S4["Regression Attacker\n• API contract & schema drift\n• Client breaking change scan"]
    end

    S1 --> BOLA["Multi-Persona AuthZ / BOLA Matrix\n• Victim (Tenant A)\n• Attacker (Tenant B)\n• Anonymous\n(2/2 Differential Replay in dast-isolated-net)"]
```

---

## 7. Stage 3: Isolated Linux Sandbox & 2x Repro Differential Execution (`diagram_stage3_sandbox.svg`)

```mermaid
flowchart TD
    Tests["Generated Test Suite T"] --> Sandbox["Google Cloud Antigravity Isolated Linux Sandbox\n(antigravity-preview-09-2026 | dast-isolated-net)"]
    
    subgraph Sandbox ["Dual-Track Isolated Sandbox Execution"]
        subgraph TrackA ["Track (a): Real PR Code Execution"]
            T1["1x Initial Run\n(Detect suspect failures)"] --> T2["2x Repro Filter Check\n(Consecutive 2/2 failures required)"]
            T2 --> Proven["PROVEN Real Defects\n(Zero Flaky false positives)"]
        end

        subgraph TrackB ["Track (b): 8 Mutant Shadow Copies"]
            MRun["Execute Tests passing on original PR against M1..M8"]
            MRun --> KillCheck{"Differential Kill Condition:\nPass(PR_orig) ∧ Fail(M_i)"}
            KillCheck --> Killed["Caught Mutants (e.g. M1..M7)"]
            KillCheck --> Survived["Surviving Mutant (e.g. M8)"]
        end
    end
```

---

## 8. Stage 4: Deterministic Scoring & One-Card Human Merge Gate (`diagram_stage4_onecard.svg`)

```mermaid
flowchart TD
    ExecOut["Sandbox Pass/Fail Matrix"] --> Scoring["Deterministic Python Engine (scoring.py)\n• Confirmed 2/2 Defects: 2\n• Mutant Kill Rate: 7/8 (87.5%)\n• 0% LLM hallucination"]
    
    Scoring --> Synth["Risk Synthesizer (gemini-4-argon)\n• Explains uncaught mutant M8 residual risk\n• Writes human-readable summary"]
    
    Synth --> OneCard["One-Card Executive Summary Dashboard\n• 2/2 Confirmed Bugs & Breach Rounds\n• 7/8 Calibrated Trust Score\n• Residual Risk Breakdown"]
    
    OneCard --> Actions{"Next-Gen Enterprise Actions"}
    Actions --> CEGIS["🔧 Apply CEGIS Self-Healing Patch"]
    Actions --> Export["📦 Export Regression Bundle (pytests + CI YAML)"]
    Actions --> HumanDecision["👤 Human Tech Lead Decision Gate\n[Approve & Merge] vs [Reject PR]"]
```

