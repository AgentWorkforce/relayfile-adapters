import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutManifest } from './layout.js';

const CANONICAL_ALIAS_SEGMENTS = new Set([
  'by-id',
  'by-edited',
  'by-key',
  'by-name',
  'by-parent',
  'by-space',
  'by-state',
  'by-title',
]);

test('layoutManifest exposes Confluence resources with canonical aliases and writeback schema pointers', () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, 'confluence');
  assert.deepEqual(manifest.aliasSegments, ['by-edited', 'by-id', 'by-key', 'by-parent', 'by-space', 'by-state', 'by-title']);

  for (const resource of manifest.resources) {
    assert.ok(resource.path.startsWith('confluence/'));
    assert.doesNotMatch(resource.path, /^\//u);
    for (const alias of resource.aliasSegments) {
      assert.ok(CANONICAL_ALIAS_SEGMENTS.has(alias), `unexpected alias segment ${alias}`);
    }
    for (const writeback of resource.writebackResources) {
      assert.ok(writeback.path.startsWith('confluence/'));
      assert.doesNotMatch(writeback.path, /^\//u);
      assert.match(writeback.schemaId, /^confluence\/[a-z-]+$/u);
    }
  }
});
