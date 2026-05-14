import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutManifest } from '../src/layout.js';
import { gitLabLayoutPromptFile } from '../src/layout-prompt.js';

test('layoutManifest exposes GitLab resources with canonical aliases and writeback schema pointers', () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, 'gitlab');
  assert.deepEqual(manifest.aliasSegments, ['by-id', 'by-ref', 'by-status', 'by-title']);
  assert.ok(manifest.resources.length > 0);

  for (const resource of manifest.resources) {
    assert.ok(resource.path.startsWith('gitlab/'));
    assert.doesNotMatch(resource.path, /^\//u);
    for (const alias of resource.aliasSegments) {
      assert.ok(manifest.aliasSegments.includes(alias));
    }
    for (const writeback of resource.writebackResources) {
      assert.ok(writeback.path.startsWith('gitlab/'));
      assert.doesNotMatch(writeback.path, /^\//u);
      assert.match(writeback.schemaId, /^gitlab\/[a-z-]+$/u);
    }
  }
});

test('gitLabLayoutPromptFile emits a provider-specific root guide', () => {
  const file = gitLabLayoutPromptFile();

  assert.equal(file.path, '/gitlab/LAYOUT.md');
  assert.equal(file.contentType, 'text/markdown; charset=utf-8');
  assert.ok(file.content.length > 1000);
  assert.match(file.content, /\bls\b/u);
  assert.match(file.content, /_index\.json/u);
  assert.match(file.content, /by-id/u);
  assert.match(file.content, /by-title/u);
  assert.match(file.content, /by-ref/u);
  assert.match(file.content, /jq/u);
});
