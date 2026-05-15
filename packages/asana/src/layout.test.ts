import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutManifest } from './layout.js';

test('layoutManifest advertises materialized Asana task lookup aliases', () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, 'asana');
  assert.deepEqual(manifest.aliasSegments, ['by-assignee', 'by-creator', 'by-id', 'by-priority', 'by-state']);

  const tasks = manifest.resources.find((resource) => resource.path === 'asana/tasks');
  assert.ok(tasks);
  assert.deepEqual(tasks.aliasSegments, ['by-id', 'by-state', 'by-assignee', 'by-creator', 'by-priority']);
  assert.deepEqual(tasks.writebackResources, [{ path: 'asana/tasks', schemaId: 'asana/task' }]);
});
