import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRONTEND = fileURLToPath(new URL('../../frontend/', import.meta.url));
const rel = (f) => relative(FRONTEND, f).split('\\').join('/');
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(FRONTEND);
const own = files.filter((f) => /^(index\.html|css\/|js\/)/.test(rel(f)));
const jsFiles = own.filter((f) => rel(f).startsWith('js/') && f.endsWith('.js'));
const sources = () => jsFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

test('every module except main.js imports in Node (syntax + named exports resolve)', async () => {
  for (const f of jsFiles.filter((x) => rel(x) !== 'js/main.js')) {
    await assert.doesNotReject(import(pathToFileURL(f).href), rel(f));
  }
});

test("main.js imports point at existing files and exported names", async () => {
  const main = join(FRONTEND, 'js', 'main.js');
  const src = readFileSync(main, 'utf8');
  for (const m of src.matchAll(/import\s+(?:\{([^}]*)\}|\*\s+as\s+\w+)\s+from\s+'([^']+)'/g)) {
    const target = resolve(dirname(main), m[2]);
    assert.ok(existsSync(target), `missing ${m[2]}`);
    if (!m[1]) continue;
    const mod = await import(pathToFileURL(target).href);
    for (const name of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      assert.ok(name in mod, `${m[2]} does not export ${name}`);
    }
  }
});

// Korean copy lives only in the translation tables under js/i18n/.
test('no Hangul in the frontend sources outside js/i18n/', () => {
  for (const f of own.filter((x) => !rel(x).startsWith('js/i18n/'))) {
    const hit = readFileSync(f, 'utf8').match(/[\uAC00-\uD7A3]+/);
    assert.equal(hit, null, `${rel(f)} contains "${hit?.[0]}"`);
  }
});

test('index.html links exactly the stylesheets in css/', () => {
  const html = readFileSync(join(FRONTEND, 'index.html'), 'utf8');
  const linked = [...html.matchAll(/href="(css\/[^"]+)"/g)].map((m) => m[1]).sort();
  const onDisk = own.map(rel).filter((r) => r.startsWith('css/')).sort();
  assert.deepEqual(linked, onDisk);
});

// Every data-testid named in the plan's contract must be rendered somewhere (scripts/e2e_frontend.py relies on them).
const CONTRACT_TESTIDS = [
  'nav-start', 'nav-run', 'nav-verify', 'nav-decide', 'mode-chip', 'sample-chip',
  'pr-option', 'phase-option', 'mode-option', 'scope-select', 'run-button', 'open-diff', 'open-import',
  'run-status', 'stage', 'scene', 'scene-eye', 'caught-counter', 'lane', 'lane-test', 'log-line', 'log-filter',
  'stop-button', 'open-run-details', 'continue-verify', 'blocked-panel', 'blocked-threat', 'error-panel',
  'retry-button', 'live-fallback-banner',
  'score-big', 'matrix', 'matrix-row', 'matrix-cell', 'matrix-col', 'mutant-verdict', 'mutant-detail',
  'open-mutant-form', 'continue-decide',
  'verdict-chip', 'score-hero', 'defect-card', 'finding', 'residual-risk', 'fix-snippet', 'apply-patch',
  'patch-section', 'patch-attempt', 'copy-prompt', 'reviewer-note', 'approve-button', 'reject-button',
  'decision-stamp', 'change-decision', 'open-export', 'download-report',
  'overlay-close', 'import-tab', 'upload-input', 'upload-submit', 'github-url', 'github-preset', 'github-fetch',
  'paste-title', 'paste-repo', 'paste-diff', 'fill-injection-sample', 'paste-submit', 'import-status',
  'dast-run', 'dast-row', 'invariant-item',
  'mutant-title', 'mutant-category', 'mutant-outcome', 'mutant-submit', 'mutant-preview',
  'export-tab', 'export-code', 'export-copy',
];

test('every contract data-testid is rendered by some module', () => {
  const src = sources();
  const missing = CONTRACT_TESTIDS.filter((id) => {
    // Literal attribute, setAttribute/dataset, a quoted id passed to a renderer helper, or a `nav-${view}`-style template.
    const literal = new RegExp(`(data-testid=["']${id}["']|testid *[=:] *["']${id}["']|testId *[=:] *["']${id}["']|'data-testid', *'${id}'|['"]${id}['"])`);
    const prefix = id.includes('-') && src.includes(`data-testid="${id.split('-')[0]}-$` + '{');
    return !(literal.test(src) || prefix);
  });
  assert.deepEqual(missing, []);
});

test('every overlay name is created via createOverlay', () => {
  const src = sources();
  for (const name of ['import', 'diff', 'run-details', 'mutant', 'export']) {
    assert.match(src, new RegExp(`name: *['"]${name}['"]`), `overlay ${name}`);
  }
});
