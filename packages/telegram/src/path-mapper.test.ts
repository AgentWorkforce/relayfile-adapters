import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTelegramMessageObjectId,
  createTelegramReactionObjectId,
  createTelegramThreadMessageObjectId,
  parseTelegramMessageObjectId,
  parseTelegramReactionObjectId,
  parseTelegramThreadMessageObjectId,
  telegramByDataCallbackAliasPath,
  telegramByTitleChatAliasPath,
  telegramByUserMessageAliasPath,
  telegramByUsernameChatAliasPath,
  telegramChatMetadataPath,
  telegramMessagePath,
  telegramReactionPath,
  telegramThreadMessagePath,
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

test('telegram thread message object ids round-trip to canonical paths', () => {
  const objectId = createTelegramThreadMessageObjectId(8587455921, 7, 42);
  assert.deepEqual(parseTelegramThreadMessageObjectId(objectId), {
    chatId: '8587455921',
    threadId: '7',
    messageId: '42',
  });
  assert.equal(
    telegramThreadMessagePath(8587455921, 7, 42, 'Senior Dev'),
    '/telegram/chats/8587455921__senior-dev/threads/7/messages/42/meta.json',
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
  assert.equal(
    telegramByUsernameChatAliasPath('@ReleaseRoom', -100123),
    '/telegram/chats/by-username/releaseroom__-100123.json',
  );
});

test('telegram message and callback aliases use flat pointer paths', () => {
  assert.equal(
    telegramByUserMessageAliasPath(8587455921, 8587455921, 42),
    '/telegram/messages/by-user/8587455921__8587455921__42.json',
  );
  assert.equal(
    telegramByDataCallbackAliasPath('Approve deploy', 'cb_1'),
    '/telegram/callback-queries/by-data/approve-deploy__cb_1.json',
  );
});
