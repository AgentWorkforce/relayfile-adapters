import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutManifest } from './layout.js';

const CANONICAL_ALIAS_SEGMENTS = new Set([
  'by-assignee',
  'by-creator',
  'by-id',
  'by-name',
  'by-priority',
  'by-state',
  'by-title',
]);

test('layoutManifest exposes Jira resources with canonical aliases and writeback schema pointers', () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, 'jira');
  assert.deepEqual(manifest.aliasSegments, [
    'by-assignee',
    'by-creator',
    'by-id',
    'by-priority',
    'by-title',
    'by-state',
  ]);

  for (const resource of manifest.resources) {
    assert.ok(resource.path.startsWith('jira/'));
    assert.doesNotMatch(resource.path, /^\//u);
    for (const alias of resource.aliasSegments) {
      assert.ok(CANONICAL_ALIAS_SEGMENTS.has(alias), `unexpected alias segment ${alias}`);
    }
    for (const writeback of resource.writebackResources) {
      assert.ok(writeback.path.startsWith('jira/'));
      assert.doesNotMatch(writeback.path, /^\//u);
      assert.match(writeback.schemaId, /^jira\/[a-z-]+$/u);
    }
  }
});
