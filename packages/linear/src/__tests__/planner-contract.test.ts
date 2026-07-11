import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

import * as plannerContract from '../planner-contract.js';

test('planner-contract exposes only the Worker planning surface', () => {
  assert.deepEqual(Object.keys(plannerContract).sort(), [
    'LINEAR_OBJECT_TYPES',
    'linearStatePath',
    'linearStatesIndexPath',
    'normalizeNangoLinearModel',
  ]);

  assert.equal(plannerContract.normalizeNangoLinearModel('LinearState'), 'state');
  for (const inheritedKey of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.throws(
      () => plannerContract.normalizeNangoLinearModel(inheritedKey),
      new RegExp(`Unsupported Linear object type: ${inheritedKey}`, 'u'),
    );
  }
  assert.equal(plannerContract.linearStatePath(' state/id '), '/linear/states/state%2Fid.json');
  assert.equal(plannerContract.linearStatesIndexPath(), '/linear/states/_index.json');
});

test('planner-contract public subpath has a pure Worker transitive import graph', async () => {
  const result = await build({
    absWorkingDir: new URL('../..', import.meta.url).pathname,
    bundle: true,
    conditions: ['worker', 'browser', 'import'],
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    platform: 'browser',
    stdin: {
      contents: `export * from '@relayfile/adapter-linear/planner-contract';`,
      loader: 'js',
      resolveDir: new URL('../..', import.meta.url).pathname,
      sourcefile: 'worker-entry.js',
    },
    write: false,
  });

  const runtimeInputs = Object.keys(result.metafile.inputs)
    .filter((input) => input !== 'worker-entry.js')
    .map((input) => input.replaceAll('\\\\', '/'));

  assert.deepEqual(runtimeInputs, ['dist/planner-contract.js']);

  const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  const importedPaths = Object.values(result.metafile.inputs)
    .flatMap((input) => input.imports)
    .map((entry) => entry.path);
  assert.deepEqual(importedPaths.filter((path) => nodeBuiltins.has(path)), []);
});
