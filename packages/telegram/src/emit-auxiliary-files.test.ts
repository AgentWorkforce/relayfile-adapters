import assert from 'node:assert/strict';
import test from 'node:test';

import { emitTelegramAuxiliaryFiles } from './emit-auxiliary-files.js';

class MemoryClient {
  readonly files = new Map<string, string>();

  async writeFile(input: { path: string; content: string }): Promise<void> {
    this.files.set(input.path, input.content);
  }

  async deleteFile(input: { path: string }): Promise<void> {
    this.files.delete(input.path);
  }

  async readFile(input: { path: string }): Promise<{ content: string } | undefined> {
    const content = this.files.get(input.path);
    return content === undefined ? undefined : { content };
  }
}

test('telegram auxiliary emitter writes indexes, aliases, and message records', async () => {
  const client = new MemoryClient();
  const result = await emitTelegramAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    connectionId: 'conn_1',
    chats: [
      { id: '8587455921', title: 'Khaliq Gant', type: 'private', username: 'khaliq', updated: '2026-06-20T10:00:00Z' },
      { id: '123', title: 'Khaliq Gant', type: 'private', updated: '2026-06-20T09:00:00Z' },
    ],
    messages: [
      {
        id: '8587455921:42',
        chatId: '8587455921',
        chatTitle: 'Khaliq Gant',
        messageId: 42,
        fromUserId: 8587455921,
        text: 'hello telegram',
        updated: '2026-06-20T10:01:00Z',
      },
    ],
    callbackQueries: [
      { id: 'cb_1', data: 'approve', chatId: '8587455921', messageId: 42, updated: '2026-06-20T10:02:00Z' },
    ],
  });

  assert.equal(result.errors.length, 0);
  assert.ok(client.files.has('/telegram/_index.json'));
  assert.ok(client.files.has('/telegram/chats/_index.json'));
  assert.ok(client.files.has('/telegram/chats/8587455921__khaliq-gant/meta.json'));
  assert.ok(client.files.has('/telegram/chats/by-username/khaliq__8587455921.json'));
  assert.ok(client.files.has('/telegram/messages/by-user/8587455921__8587455921__42.json'));
  assert.ok(client.files.has('/telegram/callback-queries/by-data/approve__cb_1.json'));

  const chatIndex = JSON.parse(client.files.get('/telegram/chats/_index.json') ?? '[]');
  assert.equal(chatIndex[0].id, '8587455921');
  assert.equal(chatIndex[0].canonicalPath, '/telegram/chats/8587455921__khaliq-gant/meta.json');

  const message = JSON.parse(client.files.get('/telegram/chats/8587455921__khaliq-gant/messages/42/meta.json') ?? '{}');
  assert.equal(message.provider, 'telegram');
  assert.equal(message.connectionId, 'conn_1');
  assert.equal(message.record.text, 'hello telegram');
});

test('telegram auxiliary emitter deletes reaction child paths by reaction object id', async () => {
  const client = new MemoryClient();

  await emitTelegramAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    chats: [
      { id: '8587455921', title: 'Khaliq Gant', updated: '2026-06-20T10:00:00Z' },
    ],
    reactions: [
      {
        id: '8587455921:42:900',
        chatId: '8587455921',
        messageId: 42,
        updateId: 900,
        updated: '2026-06-20T10:02:00Z',
        raw: {},
      },
    ],
  });

  const reactionPath = '/telegram/chats/8587455921__khaliq-gant/messages/42/reactions/900.json';
  assert.ok(client.files.has(reactionPath));

  const result = await emitTelegramAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    chats: [
      { id: '8587455921', title: 'Khaliq Gant', updated: '2026-06-20T10:00:00Z' },
    ],
    reactions: [
      { id: '8587455921:42:900', _deleted: true },
    ],
  });

  assert.equal(result.errors.length, 0);
  assert.equal(client.files.has(reactionPath), false);
});

test('telegram auxiliary emitter deletes message canonical paths by message object id', async () => {
  const client = new MemoryClient();
  await emitTelegramAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    chats: [
      { id: '8587455921', title: 'Khaliq Gant', updated: '2026-06-20T10:00:00Z' },
    ],
    messages: [
      {
        id: '8587455921:42',
        chatId: '8587455921',
        chatTitle: 'Khaliq Gant',
        messageId: 42,
        text: 'hello telegram',
        updated: '2026-06-20T10:01:00Z',
      },
    ],
  });

  const messagePath = '/telegram/chats/8587455921__khaliq-gant/messages/42/meta.json';
  const oldBugUpdatePath = '/telegram/updates/8587455921_42.json';
  client.files.set(oldBugUpdatePath, '{"id":"8587455921:42"}');
  assert.ok(client.files.has(messagePath));

  const result = await emitTelegramAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    chats: [
      { id: '8587455921', title: 'Khaliq Gant', updated: '2026-06-20T10:00:00Z' },
    ],
    messages: [
      { id: '8587455921:42', _deleted: true },
    ],
  });

  assert.equal(result.errors.length, 0);
  assert.equal(client.files.has(messagePath), false);
  assert.equal(client.files.has(oldBugUpdatePath), true);
  const messageIndex = JSON.parse(client.files.get('/telegram/chats/8587455921__khaliq-gant/messages/_index.json') ?? '[]');
  assert.equal(messageIndex.some((row: { id?: string }) => row.id === '42'), false);
});

test('telegram auxiliary emitter ignores malformed reaction tombstones', async () => {
  const client = new MemoryClient();
  const unrelatedUpdatePath = '/telegram/updates/malformed.json';
  client.files.set(unrelatedUpdatePath, '{"id":"malformed"}');

  const result = await emitTelegramAuxiliaryFiles(client, {
    workspaceId: 'ws_1',
    reactions: [
      { id: 'malformed', _deleted: true },
    ],
  });

  assert.equal(result.errors.length, 0);
  assert.equal(client.files.has(unrelatedUpdatePath), true);
});
