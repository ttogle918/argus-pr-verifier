import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, getLang, setLang, onLangChange } from '../../frontend/js/i18n.js';
import { KO, KO_PARTS } from '../../frontend/js/i18n/ko.js';
import { STAGE_LABEL, ATTACKER_LABEL, verdictInfo, phaseLabels } from '../../frontend/js/derive.js';

const JS = fileURLToPath(new URL('../../frontend/js/', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const sources = walk(JS).filter((f) => f.endsWith('.js') && !relative(JS, f).startsWith('i18n'));

// Every t('literal') / t("literal") key in the sources, unescaped.
function literalKeys() {
  const keys = new Map();
  for (const f of sources) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\((['"])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
      keys.set(Function(`return ${m[1]}${m[2]}${m[1]}`)(), relative(JS, f));
    }
  }
  return keys;
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('English is the default and t() returns the English text', () => {
  assert.equal(getLang(), 'en');
  assert.equal(t('Run'), 'Run');
  assert.equal(t('No such key {n}', { n: 3 }), 'No such key 3');
  assert.equal(t('{a} and {b}', { a: 1 }), '1 and {b}');
});

test('setLang switches the table, notifies listeners, and ignores unknown languages', () => {
  const seen = [];
  const off = onLangChange((l) => seen.push(l));
  setLang('ko');
  assert.equal(t('Run'), KO.Run);
  assert.equal(t('{caught} of {total} hidden mutants caught.', { caught: 7, total: 8 }).includes('7'), true);
  assert.equal(t('Not translated'), 'Not translated');
  setLang('xx');
  assert.equal(getLang(), 'ko');
  assert.equal(verdictInfo('APPROVE_RECOMMENDED').label, KO['Approve recommended']);
  assert.equal(phaseLabels('phase2_full').repro, KO['2/2 repro']);
  setLang('en');
  off();
  assert.deepEqual(seen, ['ko', 'en']);
  assert.equal(verdictInfo('APPROVE_RECOMMENDED').label, 'Approve recommended');
});

test('every t() literal in the frontend has a Korean translation', () => {
  const missing = [...literalKeys()].filter(([k]) => !(k in KO)).map(([k, f]) => `${f}: ${k}`);
  assert.deepEqual(missing, []);
});

test('stage and attacker labels have Korean translations', () => {
  for (const label of [...Object.values(STAGE_LABEL), ...Object.values(ATTACKER_LABEL)]) assert.ok(label in KO, label);
});

test('translations keep the same placeholders and are not empty', () => {
  for (const [k, v] of Object.entries(KO)) {
    assert.ok(typeof v === 'string' && v.trim(), `empty translation for ${k}`);
    assert.deepEqual(placeholders(v), placeholders(k), k);
  }
});

test('a key shared by two tables has the same translation in both', () => {
  const seen = new Map();
  for (const [part, table] of Object.entries(KO_PARTS)) {
    for (const [k, v] of Object.entries(table)) {
      if (seen.has(k)) assert.equal(v, seen.get(k).v, `${k}: ${seen.get(k).part} vs ${part}`);
      else seen.set(k, { v, part });
    }
  }
});
