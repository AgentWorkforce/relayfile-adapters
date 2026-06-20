import assert from 'node:assert/strict';
import test from 'node:test';

import { TELEGRAM_LAYOUT_PROMPT, telegramLayoutPromptFile } from './layout-prompt.js';

test('telegram layout prompt is provider-specific and substantial', () => {
  assert.ok(TELEGRAM_LAYOUT_PROMPT.length > 1000);
  assert.match(TELEGRAM_LAYOUT_PROMPT, /BotFather/);
  assert.match(TELEGRAM_LAYOUT_PROMPT, /\/telegram\/chats/);
  assert.match(TELEGRAM_LAYOUT_PROMPT, /inline queries/);

  const file = telegramLayoutPromptFile();
  assert.equal(file.path, '/telegram/LAYOUT.md');
  assert.equal(file.contentType, 'text/markdown; charset=utf-8');
});
