import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  TeamsAdapter,
  bulkIngestTeam,
  computePath,
  createSubscription,
  createValidationResponse,
  defaultSubscriptionResources,
  extractMessageRelations,
  extractValidationToken,
  materializeMessage,
  parseResourceUrl,
  parseTeamsPath,
  processNotifications,
  renewSubscription,
  deleteSubscription,
  resolveWriteback,
  shouldRenewSubscription,
  validateClientState,
} from '../src/index.ts';
import type { TeamsChatMessage } from '../src/types.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('validation helpers', () => {
  it('extracts validation tokens and builds the required plain-text response', () => {
    const validation = extractValidationToken({ validationToken: 'token-123' });

    assert.deepStrictEqual(validation, {
      isValidation: true,
      validationToken: 'token-123',
    });

    assert.deepStrictEqual(createValidationResponse('token-123'), {
      statusCode: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'token-123',
    });
  });

  it('verifies clientState and drops mismatched notifications', async () => {
    assert.strictEqual(validateClientState({ clientState: 'expected' }, 'expected'), true);
    assert.strictEqual(validateClientState({ clientState: 'wrong' }, 'expected'), false);

    const fetchImpl = mock.fn();
    const events = await processNotifications(
      {
        value: [
          {
            subscriptionId: 'sub-1',
            changeType: 'created',
            resource: '/teams/team-1/channels/channel-1/messages/message-1',
            clientState: 'wrong',
          },
        ],
      },
      {
        config: {
          accessToken: 'token',
          connectionId: 'conn-1',
          clientState: 'expected',
          fetchImpl,
        },
      },
    );

    assert.deepStrictEqual(events, []);
    assert.strictEqual(fetchImpl.mock.calls.length, 0);
  });

  it('fetches the full Graph resource when resourceData is only an id stub', async () => {
    const fetchImpl = mock.fn(async () =>
      jsonResponse({
        id: 'message-1',
        body: { contentType: 'html', content: '<p>Hello Team</p>' },
        channelIdentity: { teamId: 'team-1', channelId: 'channel-1' },
      }),
    );

    const events = await processNotifications(
      {
        value: [
          {
            subscriptionId: 'sub-1',
            changeType: 'created',
            resource: '/teams/team-1/channels/channel-1/messages/message-1',
            clientState: 'client-state',
            resourceData: { id: 'message-1', '@odata.type': '#microsoft.graph.chatMessage' },
          },
        ],
      },
      {
        config: {
          accessToken: 'token',
          clientState: 'client-state',
          fetchImpl,
        },
      },
    );

    assert.strictEqual(fetchImpl.mock.calls.length, 1);
    assert.strictEqual(events[0]?.objectType, 'message');
    assert.strictEqual((events[0]?.payload.body as { content: string }).content, '<p>Hello Team</p>');
  });
});

describe('path mapping', () => {
  it('maps and parses all supported VFS resource types', () => {
    assert.strictEqual(computePath('team', 'team-1'), '/teams/team-1/metadata.json');
    assert.strictEqual(computePath('channel', 'team-1:channel-1'), '/teams/team-1/channels/channel-1/metadata.json');
    assert.strictEqual(computePath('message', 'team-1:channel-1:message-1'),
      '/teams/team-1/channels/channel-1/messages/message-1.json',
    );
    assert.strictEqual(computePath('reply', 'team-1:channel-1:message-1:reply-1'),
      '/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1.json',
    );
    assert.strictEqual(computePath('tab', 'team-1:channel-1:tab-1'),
      '/teams/team-1/channels/channel-1/tabs/tab-1.json',
    );
    assert.strictEqual(computePath('member', 'team-1:user-1'), '/teams/team-1/members/user-1.json');
    assert.strictEqual(computePath('chat', 'chat-1'), '/teams/chats/chat-1/metadata.json');
    assert.strictEqual(computePath('chat_message', 'chat-1:message-1'), '/teams/chats/chat-1/messages/message-1.json');
    assert.strictEqual(computePath('reaction', 'team-1:channel-1:message-1:like:user-1'),
      '/teams/team-1/channels/channel-1/messages/message-1/reactions/like--user-1.json',
    );

    assert.deepStrictEqual(parseTeamsPath('/teams/team-1/channels/channel-1/messages/message-1.json'), {
      objectType: 'message',
      parts: { teamId: 'team-1', channelId: 'channel-1', messageId: 'message-1' },
    });

    assert.deepStrictEqual(parseResourceUrl('/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1'), {
      objectType: 'reply',
      parts: {
        teamId: 'team-1',
        channelId: 'channel-1',
        messageId: 'message-1',
        replyId: 'reply-1',
      },
    });
  });
});

describe('message ingestion', () => {
  const baseMessage: TeamsChatMessage = {
    id: 'message-1',
    body: { contentType: 'html', content: '<p>Hello <a href="https://relay.dev">relay</a></p>' },
    from: { user: { id: 'user-1', displayName: 'User One' } },
    mentions: [{ id: 0, mentioned: { user: { id: 'user-2' } }, mentionText: 'User Two' }],
  };

  it('materializes channel replies under reply paths', () => {
    const reply = materializeMessage('team-1', 'channel-1', {
      ...baseMessage,
      id: 'reply-1',
      replyToId: 'message-1',
    });

    assert.strictEqual(reply.objectType, 'reply');
    assert.strictEqual(reply.path, '/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1.json');
  });

  it('extracts message relations for sender, mentions, links, and parents', () => {
    const relations = extractMessageRelations('team-1', 'channel-1', {
      ...baseMessage,
      replyToId: 'message-1',
    });

    assert.ok(relations.includes('team:team-1'));
    assert.ok(relations.includes('channel:team-1:channel-1'));
    assert.ok(relations.includes('user:user-1'));
    assert.ok(relations.includes('mentions:user:user-2'));
    assert.ok(relations.includes('reply_to:team-1:channel-1:message-1'));
    assert.ok(relations.includes('link:https://relay.dev'));
  });
});

describe('writeback routing', () => {
  it('resolves channel messages, replies, and chat messages from VFS paths', () => {
    assert.deepStrictEqual(
      resolveWriteback('/teams/team-1/channels/channel-1/messages/message-1.json', {
        body: { content: '<p>Hello team</p>' },
      }),
      {
        objectType: 'message',
        objectId: 'team-1:channel-1:message-1',
        method: 'POST',
        url: 'https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages',
        body: { body: { contentType: 'html', content: '<p>Hello team</p>' } },
      },
    );

    const replyResult = resolveWriteback('/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1.json', {
      text: '<p>Hello thread</p>',
    });
    assert.strictEqual(replyResult?.objectType, 'reply');
    assert.strictEqual(replyResult?.objectId, 'team-1:channel-1:message-1:reply-1');
    assert.strictEqual(replyResult?.url, 'https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/message-1/replies');

    const chatResult = resolveWriteback('/teams/chats/chat-1/messages/message-1.json', '<p>Hello chat</p>');
    assert.strictEqual(chatResult?.objectType, 'chat_message');
    assert.strictEqual(chatResult?.objectId, 'chat-1:message-1');
    assert.strictEqual(chatResult?.url, 'https://graph.microsoft.com/v1.0/chats/chat-1/messages');
  });
});

describe('subscription lifecycle', () => {
  it('creates, renews, and deletes subscriptions with Graph semantics', async () => {
    let callCount = 0;
    const responses = [
      jsonResponse({
        id: 'sub-1',
        resource: '/teams/getAllMessages',
        changeType: 'created,updated,deleted',
        notificationUrl: 'https://example.com/teams',
        expirationDateTime: '2026-01-01T00:55:00.000Z',
      }),
      jsonResponse({
        id: 'sub-1',
        resource: '/teams/getAllMessages',
        changeType: 'created,updated,deleted',
        notificationUrl: 'https://example.com/teams',
        expirationDateTime: '2026-01-01T00:59:00.000Z',
      }),
      new Response(null, { status: 204 }),
    ];
    const fetchImpl = mock.fn(async () => responses[callCount++]!);

    const config = {
      accessToken: 'token',
      clientState: 'client-state',
      includeResourceData: true,
      encryptionCertificate: 'certificate',
      encryptionCertificateId: 'cert-1',
      fetchImpl,
    };

    const created = await createSubscription(config, {
      resource: '/teams/getAllMessages',
      changeType: 'created,updated,deleted',
      notificationUrl: 'https://example.com/teams',
      expirationDateTime: '2026-01-01T00:55:00.000Z',
    });
    assert.strictEqual(created.id, 'sub-1');

    const renewed = await renewSubscription(config, 'sub-1', '2026-01-01T00:59:00.000Z');
    assert.strictEqual(renewed.expirationDateTime, '2026-01-01T00:59:00.000Z');

    const deleteResult = await deleteSubscription(config, 'sub-1');
    assert.strictEqual(deleteResult, undefined);

    assert.strictEqual(defaultSubscriptionResources('tenant', {
      notificationUrl: 'https://example.com/teams',
      clientState: 'client-state',
      includeResourceData: true,
    }).length, 4);

    assert.strictEqual(shouldRenewSubscription('2026-01-01T00:59:00.000Z', 5 * 60_000, Date.parse('2026-01-01T00:55:30.000Z')),
      true);
    assert.strictEqual(shouldRenewSubscription('2026-01-01T00:59:00.000Z', 5 * 60_000, Date.parse('2026-01-01T00:50:00.000Z')),
      false);
  });
});

describe('adapter ingest', () => {
  it('writes normalized channel messages and derived reaction files', async () => {
    const writes: Array<{ path: string; baseRevision: string; content: string }> = [];
    const client = {
      async readFile() {
        throw new Error('not found');
      },
      async writeFile(input: { path: string; baseRevision: string; content: string }) {
        writes.push(input);
        return {
          opId: `op-${writes.length}`,
          status: 'queued' as const,
          targetRevision: `rev-${writes.length}`,
        };
      },
    };

    const fetchImpl = mock.fn(async () =>
      jsonResponse({
        id: 'message-1',
        body: {
          contentType: 'html',
          content: '<p>Hello Team</p>',
        },
        channelIdentity: {
          teamId: 'team-1',
          channelId: 'channel-1',
        },
        from: {
          user: { id: 'user-1' },
        },
        reactions: [
          {
            reactionType: 'like',
            user: { user: { id: 'user-2' } },
          },
        ],
      }),
    );

    const adapter = new TeamsAdapter(client as never, {
      accessToken: 'token',
      connectionId: 'conn-1',
      clientState: 'client-state',
      fetchImpl,
    });

    const response = await adapter.ingestWebhook('ws-1', {
      body: {
        value: [
          {
            subscriptionId: 'sub-1',
            changeType: 'created',
            resource: '/teams/team-1/channels/channel-1/messages/message-1',
            clientState: 'client-state',
          },
        ],
      },
    });

    assert.strictEqual(response.status, 'queued');
    assert.deepStrictEqual(writes.map((entry) => entry.path), [
      '/teams/team-1/channels/channel-1/messages/message-1.json',
      '/teams/team-1/channels/channel-1/messages/message-1/reactions/like--user-2.json',
    ]);
    assert.strictEqual(writes[0]?.baseRevision, '0');
  });

  it('maps deleted replies from the Graph resource path when the payload is sparse', async () => {
    const writes: Array<{ path: string }> = [];
    const client = {
      async readFile() {
        throw new Error('not found');
      },
      async writeFile(input: { path: string }) {
        writes.push(input);
        return { opId: 'op-1', status: 'queued' as const, targetRevision: 'rev-1' };
      },
    };

    const adapter = new TeamsAdapter(client as never, {
      accessToken: 'token',
      clientState: 'client-state',
      fetchImpl: mock.fn(),
    });

    await adapter.ingestWebhook('ws-1', {
      body: {
        value: [
          {
            subscriptionId: 'sub-1',
            changeType: 'deleted',
            resource: '/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1',
            clientState: 'client-state',
          },
        ],
      },
    });

    assert.deepStrictEqual(writes.map((entry) => entry.path), [
      '/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1.json',
    ]);
  });
});

describe('bulk ingest pagination', () => {
  it('follows @odata.nextLink for channel message pages', async () => {
    let callCount = 0;
    const responses = [
      jsonResponse({ id: 'team-1' }),
      jsonResponse({ value: [] }),
      jsonResponse({ value: [{ id: 'channel-1' }] }),
      jsonResponse({
        value: [{ id: 'message-1', body: { content: '<p>First</p>' } }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages?$skiptoken=abc',
      }),
      jsonResponse({
        value: [{ id: 'message-2', body: { content: '<p>Second</p>' } }],
      }),
      jsonResponse({ value: [] }),
      jsonResponse({ value: [] }),
    ];
    const fetchImpl = mock.fn(async () => responses[callCount++]!);

    const result = await bulkIngestTeam(
      { accessToken: 'token', fetchImpl },
      'team-1',
      { includeReplies: true },
    );

    assert.deepStrictEqual(result.files
      .filter((file) => file.objectType === 'message')
      .map((file) => file.path), [
        '/teams/team-1/channels/channel-1/messages/message-1.json',
        '/teams/team-1/channels/channel-1/messages/message-2.json',
      ]);
    assert.strictEqual(fetchImpl.mock.calls[4]?.arguments[0],
      'https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages?$skiptoken=abc',
    );
  });
});
