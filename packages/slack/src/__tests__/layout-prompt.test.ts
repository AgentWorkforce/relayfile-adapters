import assert from 'node:assert/strict';
import test from 'node:test';

import { SLACK_LAYOUT_PROMPT, slackLayoutPromptFile } from '../layout-prompt.js';

test('slackLayoutPromptFile points at /slack/LAYOUT.md and is markdown', () => {
  const file = slackLayoutPromptFile();
  assert.equal(file.path, '/slack/LAYOUT.md');
  assert.equal(file.contentType, 'text/markdown; charset=utf-8');
  assert.ok(file.content.length > 0);
  assert.ok(file.content.endsWith('\n'));
});

test('SLACK_LAYOUT_PROMPT documents v2 directory conventions', () => {
  assert.match(SLACK_LAYOUT_PROMPT, /<id>__<slug>/);
  assert.match(SLACK_LAYOUT_PROMPT, /_index\.json/);
  assert.match(SLACK_LAYOUT_PROMPT, /by-name/);
  assert.match(SLACK_LAYOUT_PROMPT, /bots/);
  assert.match(SLACK_LAYOUT_PROMPT, /is_bot/);
  // back-compat migration callout is required so consumers know to fall back.
  assert.match(SLACK_LAYOUT_PROMPT, /message\.json/);
  assert.match(SLACK_LAYOUT_PROMPT, /meta\.json/);
});
