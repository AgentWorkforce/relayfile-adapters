import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutManifest } from './layout.js';

const CANONICAL_ALIAS_SEGMENTS = new Set(['by-id', 'by-name', 'by-state', 'by-title']);

test('layoutManifest exposes Linear resources with canonical aliases and writeback schema pointers', () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, 'linear');
  assert.deepEqual(manifest.aliasSegments, ['by-id', 'by-title', 'by-state']);
  assert.ok(manifest.resources.length > 0);

  for (const resource of manifest.resources) {
    assert.ok(resource.path.startsWith('linear/'));
    assert.doesNotMatch(resource.path, /^\//u);
    for (const alias of resource.aliasSegments) {
      assert.ok(CANONICAL_ALIAS_SEGMENTS.has(alias), `unexpected alias segment ${alias}`);
    }
    for (const writeback of resource.writebackResources) {
      assert.ok(writeback.path.startsWith('linear/'));
      assert.doesNotMatch(writeback.path, /^\//u);
      assert.match(writeback.schemaId, /^linear\/[a-z-]+$/u);
    }
  }
});
