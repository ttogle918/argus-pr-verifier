import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseBuffer } from '../../frontend/js/sse.js';

test('parses complete frames and keeps the partial tail', () => {
  const buf = 'data: {"stage":"a"}\n\ndata: {"stage":"b"}\n\ndata: {"sta';
  const { events, rest } = parseSseBuffer(buf);
  assert.deepEqual(events.map((e) => e.stage), ['a', 'b']);
  assert.equal(rest, 'data: {"sta');
});

test('skips malformed and empty frames', () => {
  const { events, rest } = parseSseBuffer('\n\ndata: not-json\n\n: comment\n\ndata: {"stage":"ok"}\n\n');
  assert.deepEqual(events, [{ stage: 'ok' }]);
  assert.equal(rest, '');
});
