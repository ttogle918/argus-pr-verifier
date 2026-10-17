import { parseSandboxLog } from './derive.js';

const DELAYS = {
  replay: { test: 75, mutant: 95, log: 40 },
  live_api: { test: 40, mutant: 50, log: 20 },
};

export function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

// backend/main.py gives track B every line containing "TRACK (b)", "mutant" or "scoring" (case-insensitive) and track A
// everything without "TRACK (b)". So mutant-result and scoring lines arrive in track A's batch (replay "Running against Mn",
// live "[MUTANT Mn]"), and live "[PASS ...] Eligible for Track (b) Mutant Kill" lines arrive in both.
// Track A hands the mutant/scoring lines to track B via ctx; ctx.emitted dedupes lines already shown under track A.
const isTrackBLine = (line) => /Running against M\d|\[MUTANT M\d|scoring/i.test(line);

// Server events arrive in batches; this turns one batch into [delayMs, event] steps.
// ctx is a per-run object used to pass the track B lines from the track A event to the track B event.
export function expandEvent(evt, { mode = 'replay', ctx = {} } = {}) {
  const d = DELAYS[mode] ?? DELAYS.replay;
  if (evt.stage === 'sandbox_track_a') {
    const lines = evt.terminal_logs ?? [];
    const partA = lines.filter((l) => !isTrackBLine(l));
    ctx.trackBLogs = lines.filter(isTrackBLine);
    ctx.emitted = new Set(partA);
    const aIdx = partA.findIndex((l) => l.includes('TRACK (a)'));
    const logs = partA.map((l, i) => [d.log, { stage: '_log', entry: parseSandboxLog(l, aIdx !== -1 && i >= aIdx ? 'A' : 'SYS') }]);
    const tests = (evt.pr_test_results ?? []).map((r) => [d.test, { stage: '_test_result', result: r }]);
    return [...interleave(logs, tests), [0, evt]];
  }
  if (evt.stage === 'sandbox_track_b') {
    const own = evt.terminal_logs ?? [];
    const lines = [...new Set([...own.filter((l) => l.includes('TRACK (b)')), ...(ctx.trackBLogs ?? []), ...own])]
      .filter((l) => !ctx.emitted?.has(l));
    const logs = lines.map((l) => [d.log, { stage: '_log', entry: parseSandboxLog(l, 'B') }]);
    const muts = (evt.mutant_evaluations ?? []).map((m) => [d.mutant, { stage: '_mutant_result', evaluation: m }]);
    return [...interleave(logs, muts), [0, evt]];
  }
  return [[0, evt]];
}
