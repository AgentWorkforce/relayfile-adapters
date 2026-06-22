import assert from 'node:assert/strict';
import test from 'node:test';

import { TelegramAdapter, TELEGRAM_SUPPORTED_EVENTS } from './adapter.js';
import { findResourceByPath } from './resources.js';

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

test('telegram message item resource wins for numeric edit paths without swallowing create drafts', () => {
  assert.equal(
    findResourceByPath('/telegram/chats/C123/messages/42.json')?.path,
    '/telegram/chats/{chatId}/messages/{messageId}.json',
  );
  assert.equal(
    findResourceByPath('/telegram/chats/C123/messages/relayfile-writeback--messages-1.json')?.path,
    '/telegram/chats/{chatId}/messages',
  );
});
