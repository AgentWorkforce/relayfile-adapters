import assert from 'node:assert/strict';
import test from 'node:test';

import { RAMP_LAYOUT_PROMPT, rampLayoutPromptFile } from './layout-prompt.js';

test('rampLayoutPromptFile emits a provider-specific root guide', () => {
  const file = rampLayoutPromptFile();

  assert.equal(file.path, '/ramp/LAYOUT.md');
  assert.equal(file.contentType, 'text/markdown; charset=utf-8');
  assert.ok(file.content.length > 1000);
  assert.match(file.content, /_index\.json/u);
  assert.match(file.content, /by-id/u);
  assert.match(file.content, /Hookdeck/u);
  assert.match(file.content, /jq/u);
  assert.match(file.content, /\*\*no\*\* `\/ramp\/payments\/` tree/u);
});

test('Ramp layout prompt ends with a trailing newline when materialized', () => {
  const file = rampLayoutPromptFile();
  assert.equal(file.content.at(-1), '\n');
  assert.ok(RAMP_LAYOUT_PROMPT.length > 1000);
});
