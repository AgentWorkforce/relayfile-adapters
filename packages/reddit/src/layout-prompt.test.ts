import assert from 'node:assert/strict';
import test from 'node:test';

import { REDDIT_LAYOUT_PROMPT, redditLayoutPromptFile } from './layout-prompt.js';

test('redditLayoutPromptFile emits non-empty prompt content', () => {
  const file = redditLayoutPromptFile();
  assert.equal(file.path, '/reddit/LAYOUT.md');
  assert.ok(file.content.length > 100);
  assert.ok(file.content.includes('Reddit Mount Layout'));
  assert.ok(file.content.includes(REDDIT_LAYOUT_PROMPT.trim().slice(0, 20)));
});
