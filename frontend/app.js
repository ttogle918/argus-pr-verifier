// ARGUS-PR Frontend Orchestrator (Swimlane Visualizer, Sandbox Log Replayer & One-Card Summary)

const state = {
    prs: {},
    currentPrId: 'pr-checkout-race',
    lastRunData: null,
    isRunning: false,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setStepState(stepKey, status) {
    const pill = document.querySelector(`.step-pill[data-step="${stepKey}"]`);
    if (!pill) return;
    pill.classList.remove('active', 'done', 'blocked');
    if (status) pill.classList.add(status);
}

function resetAllSteps() {
    document.querySelectorAll('.step-pill').forEach((el) => {
        el.classList.remove('active', 'done', 'blocked');
    });
}

function appendTerminalLog(text, cls = 'log-info') {
    const term = document.getElementById('terminal-output');
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
}

async function loadSamplePrs() {
    try {
        const res = await fetch('/api/prs');
        if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data) ? data : (data.prs || []);
            list.forEach((p) => {
                state.prs[p.pr_id || p.id] = p;
            });
            updateDiffDrawer();
        }
    } catch (err) {
        console.warn('Backend /api/prs not reachable yet, using fallback metadata.', err);
    }
}

function updateDiffDrawer() {
    const prId = document.getElementById('scenario-selector').value;
    state.currentPrId = prId;
    const pr = state.prs[prId];
    const titleEl = document.getElementById('diff-title');
    const metaEl = document.getElementById('diff-meta');
    const codeEl = document.getElementById('diff-code');
    if (pr) {
        titleEl.textContent = `${pr.title || prId}`;
        metaEl.textContent = `${pr.repo_name || pr.repo || ''} • Author: ${pr.author || 'ai-agent'}`;
        codeEl.textContent = pr.diff || pr.pr_diff || '# Diff loaded on verification run';
    } else {
        titleEl.textContent = `Selected Scenario: ${prId}`;
        metaEl.textContent = 'Ready for inspection';
    }
}

function renderSealedMutants(mutantEvalList) {
    const container = document.getElementById('planter-content');
    container.innerHTML = '';
    mutantEvalList.forEach((m) => {
        const card = document.createElement('div');
        card.className = 'mutant-card sealed';
        card.id = `mutant-card-${m.mutant_id}`;
        card.innerHTML = `
            <div class="mutant-top">
                <span class="mutant-id">${m.mutant_id} • ${m.category.toUpperCase()}</span>
                <span class="mutant-status sealed" id="mutant-status-${m.mutant_id}">SEALED (BLIND)</span>
            </div>
            <div style="color:#cbd5e1;font-weight:600;">${m.title}</div>
            <div class="mutant-killer" id="mutant-killer-${m.mutant_id}">Hidden behind store=False wall</div>
        `;
        container.appendChild(card);
    });
}

function revealMutantOutcome(m) {
    const card = document.getElementById(`mutant-card-${m.mutant_id}`);
    const statusEl = document.getElementById(`mutant-status-${m.mutant_id}`);
    const killerEl = document.getElementById(`mutant-killer-${m.mutant_id}`);
    if (!card || !statusEl || !killerEl) return;

    card.classList.remove('sealed');
    statusEl.classList.remove('sealed');

    if (m.caught) {
        card.classList.add('caught');
        statusEl.classList.add('caught');
        statusEl.textContent = 'CAUGHT (Pass(PR) ∧ Fail(M))';
        killerEl.textContent = `Killed by: ${m.caught_by_test_ids.join(', ')}`;
    } else {
        card.classList.add('survived');
        statusEl.classList.add('survived');
        statusEl.textContent = 'SURVIVED (BLIND SPOT)';
        killerEl.textContent = 'Escaped all baseline tests (Residual Risk)';
    }
}

function renderInvariants(invariantPlan) {
    const box = document.getElementById('invariants-box');
    const items = (invariantPlan && invariantPlan.invariants) || [];
    const pillsHtml = items.slice(0, 6).map((inv) => `
        <div class="inv-pill" title="${inv.formal_assertion}">
            <strong>${inv.id}</strong> (${inv.category}): ${inv.title}
        </div>
    `).join('');
    box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <span><strong>Extracted Formal Invariants (${items.length})</strong> — <code>gemini-4-argon (store=False)</code></span>
            <span style="color:#38bdf8;font-size:0.72rem;font-family:var(--font-mono);">Zero Planted-Bug Leakage</span>
        </div>
        <div class="inv-pills">${pillsHtml}</div>
    `;
}

function renderSwarmAttackers(swarmOutputs, testResultMap) {
    const grid = document.getElementById('swarm-content');
    grid.innerHTML = '';
    swarmOutputs.forEach((att) => {
        const card = document.createElement('div');
        card.className = 'attacker-card active';
        const testsHtml = (att.tests || []).map((t) => {
            const res = testResultMap[t.test_id];
            let statusCls = '';
            let badge = 'PENDING';
            if (res) {
                if (!res.passed_on_original && res.reproduced_twice) {
                    statusCls = 'fail-2x';
                    badge = 'FAIL 2/2 (REAL PR BUG)';
                } else if (!res.passed_on_original && !res.reproduced_twice) {
                    statusCls = 'flaky-1x';
                    badge = '1/2 FLAKY (FILTERED)';
                } else {
                    statusCls = 'pass-base';
                    badge = 'PASS 2/2 (BASELINE)';
                }
            }
            return `<li class="${statusCls}">• ${t.test_id} [${badge}]</li>`;
        }).join('');

        card.innerHTML = `
            <div class="attacker-top">
                <span class="attacker-name">${att.attacker_name}</span>
                <span class="attacker-badge">${(att.tests || []).length} tests</span>
            </div>
            <ul class="attacker-tests">${testsHtml}</ul>
        `;
        grid.appendChild(card);
    });
}

function renderOneCardSummary(data) {
    const card = document.getElementById('one-card-summary');
    const verdictEl = document.getElementById('hero-verdict');
    const takeawayEl = document.getElementById('hero-takeaway');
    const stampEl = document.getElementById('human-decision-stamp');
    const score = data.deterministic_score;
    const summary = data.one_card_summary;

    stampEl.className = 'decision-stamp hidden';
    stampEl.textContent = '';

    verdictEl.innerHTML = `
        <span>ONE-CARD MERGE REVIEW: ${data.pr_title}</span>
        <span class="verdict-chip">${summary.headline_verdict.replace('_', ' ')} • RISK: ${summary.residual_risk_level}</span>
    `;
    takeawayEl.textContent = summary.one_line_takeaway;
    document.getElementById('inline-score-label').textContent = score.detection_score_label;

    // Metric 1: Confirmed PR Bugs (2/2 Repro)
    document.getElementById('metric-bugs').innerHTML = `
        <div class="metric-label">1. Confirmed PR Defects (Track a)</div>
        <div class="metric-value" style="color:#fb7185;">${score.confirmed_pr_failures_count} Breaking Failure(s)</div>
        <div class="metric-sub">Reproduced 2/2 times in Antigravity Sandbox (${score.flaky_filtered_count} flaky 1/2 alarm filtered out)</div>
    `;

    // Metric 2: Deterministic Detection Score (M/K)
    const segsHtml = (score.mutant_evaluations || []).map((m) =>
        `<div class="seg ${m.caught ? 'caught' : 'survived'}" title="${m.mutant_id}: ${m.title} (${m.caught ? 'CAUGHT' : 'SURVIVED'})"></div>`
    ).join('');

    document.getElementById('metric-score').innerHTML = `
        <div class="metric-label">2. Blind Verifier Trust Score (Track b)</div>
        <div class="metric-value" style="color:#34d399;">${score.detection_score_label}</div>
        <div class="segment-bar">${segsHtml}</div>
        <div class="metric-sub">Deterministic Python <code>scoring.py</code>: <code>Pass(PR_orig) ∧ Fail(Mutant)</code></div>
    `;

    // Metric 3: Residual Risk & Surviving Mutants
    const survivingNames = (score.surviving_mutants || []).map((m) => `${m.mutant_id} (${m.title})`).join(', ') || 'None';
    document.getElementById('metric-risk').innerHTML = `
        <div class="metric-label">3. Residual Risk &amp; Blind Spots</div>
        <div class="metric-value" style="color:#fbbf24;">${summary.residual_risk_level} (${score.surviving_mutants.length} Uncaught)</div>
        <div class="metric-sub">Surviving Mutant: <strong>${survivingNames}</strong></div>
    `;

    // Left column: Confirmed Breaking Tests
    const testMap = {};
    (data.swarm_outputs || []).forEach((s) => {
        (s.tests || []).forEach((t) => { testMap[t.test_id] = t; });
    });

    const bugsContainer = document.getElementById('bug-details');
    if ((score.confirmed_pr_failures || []).length === 0) {
        bugsContainer.innerHTML = `<div class="empty-state">No reproducible failures on original PR code.</div>`;
    } else {
        bugsContainer.innerHTML = score.confirmed_pr_failures.map((f) => {
            const tInfo = testMap[f.test_id] || {};
            return `
                <div class="bug-card">
                    <div class="bug-card-header">
                        <span>${f.test_id} (${tInfo.target_invariant_id || 'INV'})</span>
                        <span style="font-family:var(--font-mono);font-size:0.72rem;background:rgba(244,63,94,0.2);padding:2px 7px;border-radius:4px;">2/2 REPRODUCED</span>
                    </div>
                    <div style="color:#cbd5e1;">${tInfo.description || 'Deterministic invariant violation reproduced twice in isolated sandbox.'}</div>
                    <pre class="bug-trace">${f.failure_trace || 'AssertionError: Invariant violated in Track (a) run 1/2 and run 2/2'}</pre>
                </div>
            `;
        }).join('');
    }

    // Right column: Argon Residual Risk & Recommended Patch
    const residualContainer = document.getElementById('residual-details');
    residualContainer.innerHTML = `
        <div><strong>Why Surviving Mutant(s) Escaped:</strong> ${summary.blind_spot_explanation}</div>
        <div><strong>Recommended Security &amp; State Patch:</strong></div>
        <pre class="patch-pre">${summary.recommended_fix_snippet}</pre>
    `;

    card.classList.remove('hidden');
}

async function runVerificationFlow() {
    if (state.isRunning) return;
    state.isRunning = true;

    const launchBtn = document.getElementById('launch-btn');
    launchBtn.disabled = true;

    const prId = document.getElementById('scenario-selector').value;
    const isPhase2 = document.getElementById('phase-toggle').checked;
    const isReplay = document.getElementById('mode-toggle').checked;

    const banner = document.getElementById('guardrail-banner');
    const oneCard = document.getElementById('one-card-summary');
    const sandboxBadge = document.getElementById('sandbox-status-badge');
    const term = document.getElementById('terminal-output');

    banner.className = 'banner hidden';
    oneCard.classList.add('hidden');
    term.innerHTML = '';
    resetAllSteps();

    // Fetch verification result from FastAPI backend
    let data = null;
    try {
        const res = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pr_id: prId,
                phase_mode: isPhase2 ? 'phase2_full' : 'phase1_mvp',
                execution_mode: isReplay ? 'replay' : 'live_api',
            }),
        });
        if (res.ok) {
            data = await res.json();
        }
    } catch (err) {
        console.error('Error calling /api/verify:', err);
    }

    if (!data) {
        appendTerminalLog('[ERROR] Could not reach /api/verify backend endpoint.', 'log-fail');
        state.isRunning = false;
        launchBtn.disabled = false;
        return;
    }

    state.lastRunData = data;

    // STAGE 0: Flash-Lite Prompt-Injection Guardrail
    setStepState('guardrail', 'active');
    appendTerminalLog(`[Stage 0] gemini-3.5-flash-lite scanning untrusted PR diff & comments for prompt injection...`, 'log-info');
    await sleep(320);

    if (!data.guardrail.is_safe) {
        setStepState('guardrail', 'blocked');
        banner.className = 'banner blocked';
        banner.innerHTML = `
            <div>
                <strong>&#128721; [GUARDRAIL BLOCKED BY gemini-3.5-flash-lite]</strong>
                ${data.guardrail.sanitized_summary}
                <div style="font-family:var(--font-mono);font-size:0.75rem;margin-top:4px;">
                    Threats: ${(data.guardrail.detected_threats || []).join(' | ')}
                </div>
            </div>
            <span style="font-family:var(--font-mono);font-size:0.76rem;">${data.guardrail.latency_ms}ms</span>
        `;
        document.getElementById('invariants-box').innerHTML = `<div class="empty-state" style="color:#fda4af;">Execution halted at Stage 0: Malicious prompt-injection attempt quarantined before reaching Gemini 4 Argon.</div>`;
        document.getElementById('swarm-content').innerHTML = '';
        document.getElementById('planter-content').innerHTML = `<div class="empty-state" style="color:#fda4af;">Track B aborted safely.</div>`;
        appendTerminalLog(`[QUARANTINED] Prompt injection payload blocked in ${data.guardrail.latency_ms}ms. Downstream Argon/Sandbox execution prevented.`, 'log-fail');
        sandboxBadge.textContent = 'QUARANTINED';
        state.isRunning = false;
        launchBtn.disabled = false;
        return;
    }

    setStepState('guardrail', 'done');
    banner.className = 'banner safe';
    banner.innerHTML = `
        <span>&#9989; <strong>[STAGE 0 GUARDRAIL PASSED — gemini-3.5-flash-lite]</strong> ${data.guardrail.sanitized_summary}</span>
        <span style="font-family:var(--font-mono);font-size:0.75rem;">${data.guardrail.latency_ms}ms</span>
    `;

    // STAGE 1: Blind Dual-Track (Argon Planner vs. Isolated Argon Bug Planter)
    setStepState('blind_plan', 'active');
    appendTerminalLog(`[Stage 1A] gemini-4-argon (store=False) extracting formal invariants from ${data.repo_name}...`, 'log-info');
    appendTerminalLog(`[Stage 1B] Isolated gemini-4-argon (store=False) planting 8 blind mutations (M1..M8) behind Information Wall...`, 'log-info');
    renderInvariants(data.invariant_plan);
    renderSealedMutants(data.deterministic_score.mutant_evaluations || []);
    await sleep(420);
    setStepState('blind_plan', 'done');

    // STAGE 2: Parallel 4x Flash Attacker Swarm
    setStepState('swarm', 'active');
    appendTerminalLog(`[Stage 2] Spawning ${(data.swarm_outputs || []).length} parallel gemini-3.8-flash attacker agents...`, 'log-info');
    renderSwarmAttackers(data.swarm_outputs || [], {});
    await sleep(420);
    setStepState('swarm', 'done');

    // STAGE 3a: Antigravity Sandbox Track (a) — PR Original Code (2x Repro)
    setStepState('sandbox_a', 'active');
    sandboxBadge.className = 'sandbox-badge running';
    sandboxBadge.textContent = 'RUNNING TRACK (A)';
    appendTerminalLog(`[Sandbox] Launching agent="${data.sandbox_report.sandbox_agent_id}" -> python /workspace/harness/run_dual_track_verification.py`, 'log-info');
    await sleep(260);

    const testResultMap = {};
    for (const r of (data.sandbox_report.pr_test_results || [])) {
        testResultMap[r.test_id] = r;
        if (!r.passed_on_original && r.reproduced_twice) {
            appendTerminalLog(`  [Track a • PR_orig] ${r.test_id}: Run 1=FAIL, Run 2=FAIL -> 2/2 REPRODUCED PR FAILURE!`, 'log-fail');
        } else if (!r.passed_on_original && !r.reproduced_twice) {
            appendTerminalLog(`  [Track a • PR_orig] ${r.test_id}: Run 1=FAIL, Run 2=PASS -> 1/2 FLAKY ALARM (FILTERED OUT)`, 'log-flaky');
        } else {
            appendTerminalLog(`  [Track a • PR_orig] ${r.test_id}: Run 1=PASS, Run 2=PASS -> Valid Baseline Invariant Test`, 'log-pass');
        }
        await sleep(95);
    }
    renderSwarmAttackers(data.swarm_outputs || [], testResultMap);
    setStepState('sandbox_a', 'done');

    // STAGE 3b: Antigravity Sandbox Track (b) — 8 Blind Mutants
    setStepState('sandbox_b', 'active');
    sandboxBadge.textContent = 'RUNNING TRACK (B): M1..M8';
    appendTerminalLog(`[Sandbox Track b] Executing valid baseline tests against 8 Blind Mutants (Caught ⟺ Pass(PR_orig) ∧ Fail(Mutant))...`, 'log-info');
    await sleep(240);

    for (const m of (data.deterministic_score.mutant_evaluations || [])) {
        revealMutantOutcome(m);
        if (m.caught) {
            appendTerminalLog(`  [Track b • ${m.mutant_id}] CAUGHT (${m.title}) by ${m.caught_by_test_ids.join(', ')}`, 'log-pass');
        } else {
            appendTerminalLog(`  [Track b • ${m.mutant_id}] SURVIVED (${m.title}) — All baseline tests passed on mutant!`, 'log-flaky');
        }
        await sleep(110);
    }
    sandboxBadge.className = 'sandbox-badge done';
    sandboxBadge.textContent = 'COMPLETED';
    setStepState('sandbox_b', 'done');

    // STAGE 4: Deterministic Python Score + One-Card Executive Summary
    setStepState('one_card', 'active');
    appendTerminalLog(
        `[Scoring.py] Deterministic M/K Result: ${data.deterministic_score.detection_score_label} | Confirmed 2/2 PR Bugs: ${data.deterministic_score.confirmed_pr_failures_count}`,
        'log-info'
    );
    await sleep(220);
    renderOneCardSummary(data);
    setStepState('one_card', 'done');

    state.isRunning = false;
    launchBtn.disabled = false;
}

async function submitHumanDecision(decision) {
    if (!state.lastRunData) return;
    const stampEl = document.getElementById('human-decision-stamp');
    const prId = state.lastRunData.pr_id;

    try {
        await fetch('/api/decision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                run_id: state.lastRunData.run_id,
                pr_id: prId,
                decision: decision,
                reviewer_notes: decision === 'REJECT_MERGE'
                    ? 'Rejected due to 2/2 reproduced breaking tests and surviving mutant blind spot.'
                    : 'Approved by human reviewer.',
            }),
        });
    } catch (e) {
        console.warn('Recorded decision locally:', e);
    }

    if (decision === 'REJECT_MERGE') {
        stampEl.className = 'decision-stamp rejected';
        stampEl.textContent = `✖ MERGE REJECTED BY HUMAN REVIEWER — BLOCKING ${prId.toUpperCase()}`;
        appendTerminalLog(`[Human Merge Gate] Reviewer REJECTED merge for ${prId}. PR blocked until invariants and M8 blind spot are patched.`, 'log-fail');
    } else {
        stampEl.className = 'decision-stamp approved';
        stampEl.textContent = `✔ MERGE APPROVED BY HUMAN REVIEWER — ${prId.toUpperCase()}`;
        appendTerminalLog(`[Human Merge Gate] Reviewer APPROVED merge for ${prId}.`, 'log-pass');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadSamplePrs();

    document.getElementById('scenario-selector').addEventListener('change', () => {
        updateDiffDrawer();
    });

    document.getElementById('toggle-diff-btn').addEventListener('click', () => {
        const drawer = document.getElementById('pr-diff-drawer');
        drawer.classList.toggle('hidden');
        updateDiffDrawer();
    });

    document.getElementById('launch-btn').addEventListener('click', () => {
        runVerificationFlow();
    });

    document.getElementById('reject-btn').addEventListener('click', () => {
        submitHumanDecision('REJECT_MERGE');
    });

    document.getElementById('approve-btn').addEventListener('click', () => {
        submitHumanDecision('APPROVE_MERGE');
    });
});
