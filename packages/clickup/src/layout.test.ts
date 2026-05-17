import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutManifest } from './layout.js';

test('layoutManifest advertises materialized ClickUp task lookup aliases', () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, 'clickup');
  assert.deepEqual(manifest.aliasSegments, ['by-assignee', 'by-creator', 'by-id', 'by-priority', 'by-state']);

  const tasks = manifest.resources.find((resource) => resource.path === 'clickup/tasks');
  assert.ok(tasks);
  assert.deepEqual(tasks.aliasSegments, ['by-id', 'by-state', 'by-assignee', 'by-creator', 'by-priority']);
  assert.deepEqual(tasks.writebackResources, [{ path: 'clickup/tasks', schemaId: 'clickup/task' }]);
});
