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

// The server filters the sandbox log in backend/main.py: the track A event carries every line except
// the "TRACK (b)" header, so the per-mutant "Running against Mn" lines and the scoring line arrive with it,
// while the track B event carries only the header and the scoring line. Track A therefore hands the
// mutant-execution lines to track B through ctx, and track B merges them under its header.
const isTrackBLine = (line) => /Running against M\d|Deterministic Scoring/.test(line);

// Server events arrive in batches; this turns one batch into [delayMs, event] steps.
// ctx is a per-run object used to pass the track B lines from the track A event to the track B event.
export function expandEvent(evt, { mode = 'replay', ctx = {} } = {}) {
  const d = DELAYS[mode] ?? DELAYS.replay;
  if (evt.stage === 'sandbox_track_a') {
    const lines = evt.terminal_logs ?? [];
    const partA = lines.filter((l) => !isTrackBLine(l));
    ctx.trackBLogs = lines.filter(isTrackBLine);
    const aIdx = partA.findIndex((l) => l.includes('TRACK (a)'));
    const logs = partA.map((l, i) => [d.log, { stage: '_log', entry: parseSandboxLog(l, aIdx !== -1 && i >= aIdx ? 'A' : 'SYS') }]);
    const tests = (evt.pr_test_results ?? []).map((r) => [d.test, { stage: '_test_result', result: r }]);
    return [...interleave(logs, tests), [0, evt]];
  }
  if (evt.stage === 'sandbox_track_b') {
    const stashed = ctx.trackBLogs ?? [];
    const own = (evt.terminal_logs ?? []).filter((l) => !stashed.includes(l));
    const headerIdx = own.findIndex((l) => l.includes('TRACK (b)'));
    const lines = [...own.slice(0, headerIdx + 1), ...stashed, ...own.slice(headerIdx + 1)];
    const logs = lines.map((l) => [d.log, { stage: '_log', entry: parseSandboxLog(l, 'B') }]);
    const muts = (evt.mutant_evaluations ?? []).map((m) => [d.mutant, { stage: '_mutant_result', evaluation: m }]);
    return [...interleave(logs, muts), [0, evt]];
  }
  return [[0, evt]];
}
