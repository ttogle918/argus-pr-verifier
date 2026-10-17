// Splits a text/event-stream buffer into complete JSON events and the unfinished remainder.
export function parseSseBuffer(buffer) {
  const events = [];
  let rest = buffer;
  let idx;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const frame = rest.slice(0, idx).trim();
    rest = rest.slice(idx + 2);
    if (!frame) continue;
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // Malformed frame: skip it, keep streaming.
    }
  }
  return { events, rest };
}
