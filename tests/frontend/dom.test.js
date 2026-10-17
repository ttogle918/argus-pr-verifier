import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, esc } from '../../frontend/js/dom.js';

test('escapes interpolated values', () => {
  assert.equal(String(html`<p>${'<b>&"\''}</p>`), '<p>&lt;b&gt;&amp;&quot;&#39;</p>');
});

test('nests raw fragments and arrays without double escaping', () => {
  const items = ['a<', 'b'].map((x) => html`<li>${x}</li>`);
  assert.equal(String(html`<ul>${items}</ul>`), '<ul><li>a&lt;</li><li>b</li></ul>');
  assert.equal(String(html`${raw('<i>x</i>')}`), '<i>x</i>');
});

test('esc handles null and numbers', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(7), '7');
});
