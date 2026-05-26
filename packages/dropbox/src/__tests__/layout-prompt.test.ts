import assert from 'node:assert/strict';
import test from 'node:test';

import { dropboxLayoutPromptFile } from '../layout-prompt.js';
import { resources } from '../resources.js';

test('dropboxLayoutPromptFile returns markdown at the expected path', () => {
  const file = dropboxLayoutPromptFile();
  assert.equal(file.path, '/dropbox/LAYOUT.md');
  assert.equal(file.contentType, 'text/markdown; charset=utf-8');
});

test('dropboxLayoutPromptFile advertises all discovery schemas', () => {
  const content = dropboxLayoutPromptFile().content;
  for (const resource of resources) {
    assert.match(content, new RegExp(escapeRegExp(resource.schema), 'u'));
  }
});

test('dropboxLayoutPromptFile includes metadata-only note and alias subtrees', () => {
  const content = dropboxLayoutPromptFile().content;
  assert.ok(content.length >= 900, 'layout content unexpectedly short');
  assert.match(content, /metadata only/u);
  assert.match(content, /by-id/u);
  assert.match(content, /by-path/u);
  assert.equal(content.endsWith('\n'), true);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
