import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutManifest } from '../src/layout.js';
import { gitLabLayoutPromptFile } from '../src/layout-prompt.js';
import { resources } from '../src/resources.js';

test('layoutManifest exposes GitLab resources with canonical aliases and writeback schema pointers', () => {
  const manifest = layoutManifest();

  assert.equal(manifest.provider, 'gitlab');
  assert.deepEqual(manifest.aliasSegments, [
    'by-assignee',
    'by-creator',
    'by-id',
    'by-priority',
    'by-ref',
    'by-state',
    'by-status',
    'by-title',
  ]);
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
  assert.match(file.content, /by-assignee/u);
  assert.match(file.content, /by-creator/u);
  assert.match(file.content, /by-priority/u);
  assert.match(file.content, /by-ref/u);
  assert.match(file.content, /jq/u);
});

test('GitLab LAYOUT advertises every declared writeback resource', () => {
  const content = gitLabLayoutPromptFile().content;
  for (const resource of resources) assert.ok(content.includes(resource.path), `missing ${resource.path}`);
  const manifestPaths = layoutManifest().resources.flatMap((resource) => resource.writebackResources.map((writeback) => writeback.path));
  for (const path of ['gitlab/projects/**/issues', 'gitlab/projects/**/merge-requests', 'gitlab/projects/**/merge_requests', 'gitlab/projects/**/refs']) assert.ok(manifestPaths.includes(path), `missing ${path}`);
});
