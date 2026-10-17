import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFinding } from '../../frontend/js/views/decide.js';
import { diffLineClass, bundleFile } from '../../frontend/js/overlays/export.js';

test('splitFinding peels a leading severity prefix', () => {
  assert.deepEqual(splitFinding('CRITICAL: Negative refund'), { sev: 'CRITICAL', text: 'Negative refund' });
  assert.deepEqual(splitFinding('HIGH: Race'), { sev: 'HIGH', text: 'Race' });
  assert.deepEqual(splitFinding('VERIFICATION BENCHMARK: 7 of 8'), { sev: null, text: 'VERIFICATION BENCHMARK: 7 of 8' });
});

test('diffLineClass classifies unified diff lines', () => {
  assert.equal(diffLineClass('+++ b/x.py'), 'code__line--meta');
  assert.equal(diffLineClass('--- a/x.py'), 'code__line--meta');
  assert.equal(diffLineClass('@@ -1,2 +1,3 @@'), 'code__line--meta');
  assert.equal(diffLineClass('+new'), 'code__line--add');
  assert.equal(diffLineClass('-old'), 'code__line--del');
  assert.equal(diffLineClass(' ctx'), '');
});

test('bundleFile maps tabs to bundle fields', () => {
  const b = {
    patch_id: 'patch_1', production_patch_diff: '--- a/s.py\n+++ b/s.py\n+x', ci_workflow_snippet: 'name: ci',
    regression_test_file: { file_path: 'tests/t.py', pytest_content: 'def test(): pass' },
  };
  assert.equal(bundleFile(b, 'tests').path, 'tests/t.py');
  assert.equal(bundleFile(b, 'tests').proven, true);
  assert.equal(bundleFile(b, 'patch').path, 's.py · patch_1');
  assert.equal(bundleFile(b, 'ci').path, '.github/workflows/argus-security-regression.yml');
});
