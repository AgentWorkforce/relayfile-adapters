import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutManifest } from './layout.js';

const CANONICAL_ALIAS_SEGMENTS = new Set([
  'by-assignee',
  'by-creator',
  'by-edited',
  'by-id',
  'by-priority',
  'by-state',
  'by-title',
]);

test('layoutManifest exposes GitHub resources with canonical aliases and writeback schema pointers', () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, 'github');
  assert.deepEqual(manifest.aliasSegments, [
    'by-assignee',
    'by-creator',
    'by-edited',
    'by-id',
    'by-priority',
    'by-state',
    'by-title',
  ]);
  assert.ok(manifest.resources.length > 0);

  for (const resource of manifest.resources) {
    assert.ok(resource.path.startsWith('github/'));
    assert.doesNotMatch(resource.path, /^\//u);
    for (const alias of resource.aliasSegments) {
      assert.ok(CANONICAL_ALIAS_SEGMENTS.has(alias), `unexpected alias segment ${alias}`);
    }
    for (const writeback of resource.writebackResources) {
      assert.ok(writeback.path.startsWith('github/'));
      assert.doesNotMatch(writeback.path, /^\//u);
      assert.match(writeback.schemaId, /^github\/[a-z-]+$/u);
    }
  }
});

test('layoutManifest top-level aliasSegments contains the union of all resource alias segments', () => {
  const manifest = layoutManifest();
  const declared = new Set(manifest.aliasSegments);
  for (const resource of manifest.resources) {
    for (const alias of resource.aliasSegments) {
      assert.ok(
        declared.has(alias),
        `top-level aliasSegments missing ${alias} declared by resource ${resource.path}`,
      );
    }
  }
});
