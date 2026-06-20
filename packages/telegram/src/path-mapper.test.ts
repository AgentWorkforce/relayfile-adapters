import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTelegramMessageObjectId,
  createTelegramReactionObjectId,
  parseTelegramMessageObjectId,
  parseTelegramReactionObjectId,
  telegramByTitleChatAliasPath,
  telegramChatMetadataPath,
  telegramMessagePath,
  telegramReactionPath,
} from './path-mapper.js';

test('telegram message object ids round-trip to canonical paths', () => {
  const objectId = createTelegramMessageObjectId(8587455921, 42);
  assert.deepEqual(parseTelegramMessageObjectId(objectId), {
    chatId: '8587455921',
    messageId: '42',
  });
  assert.equal(
    telegramMessagePath(8587455921, 42, 'Senior Dev'),
    '/telegram/chats/8587455921__senior-dev/messages/42/meta.json',
  );
});

test('telegram reaction object ids round-trip to child reaction paths', () => {
  const objectId = createTelegramReactionObjectId(8587455921, 42, 630910858);
  assert.deepEqual(parseTelegramReactionObjectId(objectId), {
    chatId: '8587455921',
    messageId: '42',
    updateId: '630910858',
  });
  assert.equal(
    telegramReactionPath(8587455921, 42, 630910858, 'Senior Dev'),
    '/telegram/chats/8587455921__senior-dev/messages/42/reactions/630910858.json',
  );
});

test('telegram chat aliases use shared slug and deterministic collision suffixes', () => {
  assert.equal(
    telegramChatMetadataPath(-100123, 'Release Room'),
    '/telegram/chats/-100123__release-room/meta.json',
  );
  assert.equal(
    telegramByTitleChatAliasPath('Release Room', -100123, true),
    '/telegram/chats/by-title/release-room-bc8203a2__-100123.json',
  );
});
