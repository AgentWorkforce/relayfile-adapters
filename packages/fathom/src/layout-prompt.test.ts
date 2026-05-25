import assert from 'node:assert/strict';
import test from 'node:test';

import { FATHOM_LAYOUT_PROMPT, fathomLayoutPromptFile } from './layout-prompt.js';

test('fathomLayoutPromptFile returns populated markdown content with trailing newline', () => {
  const file = fathomLayoutPromptFile();

  assert.equal(file.path, '/fathom/LAYOUT.md');
  assert.equal(file.contentType, 'text/markdown; charset=utf-8');
  assert.ok(file.content.length > 0);
  assert.ok(file.content.endsWith('\n'));
  assert.ok(file.content.includes('# Fathom Mount Layout'));
  assert.ok(file.content.includes('/fathom/meetings/'));
  assert.ok(file.content.includes('Resolve by-id alias to canonical path'));
  assert.ok(file.content.startsWith(FATHOM_LAYOUT_PROMPT));
});
