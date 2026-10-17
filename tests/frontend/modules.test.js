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

test('no Hangul in the frontend sources', () => {
  for (const f of own) {
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
