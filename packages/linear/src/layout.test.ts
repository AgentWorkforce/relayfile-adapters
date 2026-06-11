import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutManifest } from './layout.js';

const CANONICAL_ALIAS_SEGMENTS = new Set([
  'by-assignee',
  'by-creator',
  'by-edited',
  'by-id',
  'by-name',
  'by-priority',
  'by-state',
  'by-title',
  'by-uuid',
]);

test('layoutManifest exposes Linear resources with canonical aliases and writeback schema pointers', () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, 'linear');
  assert.deepEqual(manifest.aliasSegments, [
    'by-assignee',
    'by-creator',
    'by-edited',
    'by-id',
    'by-name',
    'by-priority',
    'by-title',
    'by-state',
    'by-uuid',
  ]);
  assert.ok(manifest.resources.length > 0);
  assert.ok(manifest.resources.some((resource) => resource.path === 'linear/states'));

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
