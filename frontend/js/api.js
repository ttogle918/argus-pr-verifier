import { parseSseBuffer } from './sse.js';

function detailMessage(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail.map((d) => d?.msg).filter(Boolean);
    if (msgs.length) return msgs.join('; ');
  }
  return JSON.stringify(detail);
}

async function asJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(detailMessage(body.detail) || `HTTP ${res.status}`);
  return body;
}

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(asJson);

export const api = {
  listPrs: () => fetch('/api/prs').then(asJson),
  applyPatch: (prId, phase) => post('/api/prs/apply-patch', { pr_id: prId, phase_mode: phase }),
  exportBundle: (prId) => post('/api/prs/export-bundle', { pr_id: prId }),
  addMutant: (body) => post('/api/verify/add-mutant', body),
  recordDecision: (body) => post('/api/decision', body),
  liveDast: (body) => post('/api/verify/live-dast', body),
  importGithub: (url, scope) =>
    fetch(`/api/github/pr?url=${encodeURIComponent(url)}&scope_override=${encodeURIComponent(scope)}`).then(asJson),
  importCustom: (body) => post('/api/prs/custom', body),
  importUpload: (body) => post('/api/prs/upload', body),

  // Calls onEvent(evt) for each SSE event, awaiting it before reading on (playback relies on this).
  async streamVerify(body, onEvent, signal) {
    const res = await fetch('/api/verify/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseBuffer(buffer);
      buffer = rest;
      for (const evt of events) await onEvent(evt);
    }
  },
};
