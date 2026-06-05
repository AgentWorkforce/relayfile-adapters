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
  assert.match(SLACK_LAYOUT_PROMPT, /\/discovery\/slack\/channels\/_index\.json/);
  assert.match(SLACK_LAYOUT_PROMPT, /\/discovery\/slack\/users\/_index\.json/);
  assert.match(SLACK_LAYOUT_PROMPT, /history-independent lookup indexes/);
  assert.match(SLACK_LAYOUT_PROMPT, /"updated": "2026-06-05T00:00:00\.000Z"/);
  assert.match(SLACK_LAYOUT_PROMPT, /\/slack\/channels\/C0ADE9B71CN__general\/messages/);
  assert.match(SLACK_LAYOUT_PROMPT, /\/slack\/users\/U0123ABCDEF__sam\/messages/);
  assert.doesNotMatch(SLACK_LAYOUT_PROMPT, /historical message records under `\/slack\/channels\/\*\*` or `\/slack\/users\/\*\*`/);
  // back-compat migration callout is required so consumers know to fall back.
  assert.match(SLACK_LAYOUT_PROMPT, /message\.json/);
  assert.match(SLACK_LAYOUT_PROMPT, /meta\.json/);
});
