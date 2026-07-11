import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import * as plannerContract from '../planner-contract.js';

test('planner-contract exposes only the Worker-safe Linear planning surface', () => {
  assert.deepEqual(Object.keys(plannerContract).sort(), [
    'LINEAR_OBJECT_TYPES',
    'linearStatePath',
    'linearStatesIndexPath',
    'normalizeNangoLinearModel',
  ]);
});

test('planner-contract maps every Linear Nango model including workflow states', () => {
  assert.deepEqual(
    [
      'LinearComment',
      'LinearCycle',
      'LinearIssue',
      'LinearLabel',
      'LinearMilestone',
      'LinearProject',
      'LinearRoadmap',
      'LinearState',
      'LinearTeam',
      'LinearUser',
    ].map(plannerContract.normalizeNangoLinearModel),
    [...plannerContract.LINEAR_OBJECT_TYPES],
  );
  assert.equal(plannerContract.normalizeNangoLinearModel('LinearIssueLabel'), 'label');
  assert.equal(plannerContract.normalizeNangoLinearModel('issues'), 'issue');
  assert.throws(
    () => plannerContract.normalizeNangoLinearModel('LinearUnknown'),
    /Unsupported Linear object type: LinearUnknown/u,
  );
});

test('planner-contract emits canonical Linear state paths', () => {
  assert.equal(
    plannerContract.linearStatePath('state/triage'),
    '/linear/states/state%2Ftriage.json',
  );
  assert.equal(plannerContract.linearStatesIndexPath(), '/linear/states/_index.json');
  assert.throws(
    () => plannerContract.linearStatePath('  '),
    /Linear path segment must be a non-empty string/u,
  );
});

test('planner-contract source stays import-free for Worker bundles', async () => {
  const source = await readFile(new URL('../planner-contract.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /^\s*import(?:\s|\()/mu);
  assert.doesNotMatch(source, /\bfrom\s+['"]/u);
  assert.doesNotMatch(source, /node:/u);
  assert.doesNotMatch(source, /@relayfile\//u);
});

test('package exports the Worker-safe planner-contract subpath', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, { types: string; import: string; default: string }>;
  };

  assert.deepEqual(packageJson.exports['./planner-contract'], {
    types: './dist/planner-contract.d.ts',
    import: './dist/planner-contract.js',
    default: './dist/planner-contract.js',
  });
});
