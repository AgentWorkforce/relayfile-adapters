import assert from 'node:assert/strict';
import test from 'node:test';

import { TelegramAdapter, TELEGRAM_SUPPORTED_EVENTS } from './adapter.js';

test('telegram adapter advertises Bot API update event names', () => {
  const adapter = new TelegramAdapter();
  assert.ok(adapter.supportedEvents().includes('message'));
  assert.ok(adapter.supportedEvents().includes('inline_query'));
  assert.ok(adapter.supportedEvents().includes('message_reaction'));
  assert.deepEqual(adapter.supportedEvents(), [...TELEGRAM_SUPPORTED_EVENTS]);
});

test('telegram adapter declares chat-oriented scope keys', () => {
  const adapter = new TelegramAdapter();
  assert.deepEqual(adapter.supportedScopeKeys(), ['chatId', 'messageThreadId', 'userId']);
});
