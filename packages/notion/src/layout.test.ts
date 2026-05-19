import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutManifest } from './layout.js';

const CANONICAL_ALIAS_SEGMENTS = new Set(['by-database', 'by-edited', 'by-id', 'by-name', 'by-parent', 'by-state', 'by-title']);

test('layoutManifest exposes Notion resources with canonical aliases and writeback schema pointers', () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, 'notion');
  assert.deepEqual(manifest.aliasSegments, ['by-database', 'by-edited', 'by-id', 'by-name', 'by-parent', 'by-title']);
  assert.ok(manifest.resources.length > 0);
  assert.deepEqual(
    manifest.resources.find((resource) => resource.path === 'notion/pages')?.writebackResources,
    [
      { path: 'notion/pages/*', schemaId: 'notion/page' },
      { path: 'notion/pages/*/properties', schemaId: 'notion/page-properties' },
      { path: 'notion/pages/*/content', schemaId: 'notion/page-content' },
      { path: 'notion/pages/*/comments', schemaId: 'notion/comment' },
    ],
  );
  assert.deepEqual(
    manifest.resources.find((resource) => resource.path === 'notion/databases')?.writebackResources,
    [
      { path: 'notion/databases', schemaId: 'notion/database' },
      { path: 'notion/databases/*/pages', schemaId: 'notion/page' },
      { path: 'notion/databases/*/pages/*', schemaId: 'notion/page' },
      { path: 'notion/databases/*/pages/*/properties', schemaId: 'notion/page-properties' },
      { path: 'notion/databases/*/pages/*/content', schemaId: 'notion/page-content' },
      { path: 'notion/databases/*/pages/*/comments', schemaId: 'notion/comment' },
    ],
  );

  for (const resource of manifest.resources) {
    assert.ok(resource.path.startsWith('notion/'));
    assert.doesNotMatch(resource.path, /^\//u);
    for (const alias of resource.aliasSegments) {
      assert.ok(CANONICAL_ALIAS_SEGMENTS.has(alias), `unexpected alias segment ${alias}`);
    }
    for (const writeback of resource.writebackResources) {
      assert.ok(writeback.path.startsWith('notion/'));
      assert.doesNotMatch(writeback.path, /^\//u);
      assert.match(writeback.schemaId, /^notion\/[a-z-]+$/u);
    }
  }
});
