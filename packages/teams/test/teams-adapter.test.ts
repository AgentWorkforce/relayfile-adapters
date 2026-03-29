import { describe, expect, it, vi } from 'vitest';

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

    expect(validation).toEqual({
      isValidation: true,
      validationToken: 'token-123',
    });

    expect(createValidationResponse('token-123')).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'token-123',
    });
  });

  it('verifies clientState and drops mismatched notifications', async () => {
    expect(validateClientState({ clientState: 'expected' }, 'expected')).toBe(true);
    expect(validateClientState({ clientState: 'wrong' }, 'expected')).toBe(false);

    const fetchImpl = vi.fn();
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

    expect(events).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches the full Graph resource when resourceData is only an id stub', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
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

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(events[0]?.objectType).toBe('message');
    expect((events[0]?.payload.body as { content: string }).content).toBe('<p>Hello Team</p>');
  });
});

describe('path mapping', () => {
  it('maps and parses all supported VFS resource types', () => {
    expect(computePath('team', 'team-1')).toBe('/teams/team-1/metadata.json');
    expect(computePath('channel', 'team-1:channel-1')).toBe('/teams/team-1/channels/channel-1/metadata.json');
    expect(computePath('message', 'team-1:channel-1:message-1')).toBe(
      '/teams/team-1/channels/channel-1/messages/message-1.json',
    );
    expect(computePath('reply', 'team-1:channel-1:message-1:reply-1')).toBe(
      '/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1.json',
    );
    expect(computePath('tab', 'team-1:channel-1:tab-1')).toBe(
      '/teams/team-1/channels/channel-1/tabs/tab-1.json',
    );
    expect(computePath('member', 'team-1:user-1')).toBe('/teams/team-1/members/user-1.json');
    expect(computePath('chat', 'chat-1')).toBe('/teams/chats/chat-1/metadata.json');
    expect(computePath('chat_message', 'chat-1:message-1')).toBe('/teams/chats/chat-1/messages/message-1.json');
    expect(computePath('reaction', 'team-1:channel-1:message-1:like:user-1')).toBe(
      '/teams/team-1/channels/channel-1/messages/message-1/reactions/like--user-1.json',
    );

    expect(parseTeamsPath('/teams/team-1/channels/channel-1/messages/message-1.json')).toEqual({
      objectType: 'message',
      parts: { teamId: 'team-1', channelId: 'channel-1', messageId: 'message-1' },
    });

    expect(parseResourceUrl('/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1')).toEqual({
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

    expect(reply.objectType).toBe('reply');
    expect(reply.path).toBe('/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1.json');
  });

  it('extracts message relations for sender, mentions, links, and parents', () => {
    const relations = extractMessageRelations('team-1', 'channel-1', {
      ...baseMessage,
      replyToId: 'message-1',
    });

    expect(relations).toContain('team:team-1');
    expect(relations).toContain('channel:team-1:channel-1');
    expect(relations).toContain('user:user-1');
    expect(relations).toContain('mentions:user:user-2');
    expect(relations).toContain('reply_to:team-1:channel-1:message-1');
    expect(relations).toContain('link:https://relay.dev');
  });
});

describe('writeback routing', () => {
  it('resolves channel messages, replies, and chat messages from VFS paths', () => {
    expect(
      resolveWriteback('/teams/team-1/channels/channel-1/messages/message-1.json', {
        body: { content: '<p>Hello team</p>' },
      }),
    ).toEqual({
      objectType: 'message',
      objectId: 'team-1:channel-1:message-1',
      method: 'POST',
      url: 'https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages',
      body: { body: { contentType: 'html', content: '<p>Hello team</p>' } },
    });

    expect(
      resolveWriteback('/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1.json', {
        text: '<p>Hello thread</p>',
      }),
    )?.toMatchObject({
      objectType: 'reply',
      objectId: 'team-1:channel-1:message-1:reply-1',
      url: 'https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/message-1/replies',
    });

    expect(
      resolveWriteback('/teams/chats/chat-1/messages/message-1.json', '<p>Hello chat</p>'),
    )?.toMatchObject({
      objectType: 'chat_message',
      objectId: 'chat-1:message-1',
      url: 'https://graph.microsoft.com/v1.0/chats/chat-1/messages',
    });
  });
});

describe('subscription lifecycle', () => {
  it('creates, renews, and deletes subscriptions with Graph semantics', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'sub-1',
          resource: '/teams/getAllMessages',
          changeType: 'created,updated,deleted',
          notificationUrl: 'https://example.com/teams',
          expirationDateTime: '2026-01-01T00:55:00.000Z',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'sub-1',
          resource: '/teams/getAllMessages',
          changeType: 'created,updated,deleted',
          notificationUrl: 'https://example.com/teams',
          expirationDateTime: '2026-01-01T00:59:00.000Z',
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

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
    expect(created.id).toBe('sub-1');

    const renewed = await renewSubscription(config, 'sub-1', '2026-01-01T00:59:00.000Z');
    expect(renewed.expirationDateTime).toBe('2026-01-01T00:59:00.000Z');

    await expect(deleteSubscription(config, 'sub-1')).resolves.toBeUndefined();

    expect(defaultSubscriptionResources('tenant', {
      notificationUrl: 'https://example.com/teams',
      clientState: 'client-state',
      includeResourceData: true,
    })).toHaveLength(4);

    expect(shouldRenewSubscription('2026-01-01T00:59:00.000Z', 5 * 60_000, Date.parse('2026-01-01T00:55:30.000Z')))
      .toBe(true);
    expect(shouldRenewSubscription('2026-01-01T00:59:00.000Z', 5 * 60_000, Date.parse('2026-01-01T00:50:00.000Z')))
      .toBe(false);
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

    const fetchImpl = vi.fn().mockResolvedValue(
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

    expect(response.status).toBe('queued');
    expect(writes.map((entry) => entry.path)).toEqual([
      '/teams/team-1/channels/channel-1/messages/message-1.json',
      '/teams/team-1/channels/channel-1/messages/message-1/reactions/like--user-2.json',
    ]);
    expect(writes[0]?.baseRevision).toBe('0');
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
      fetchImpl: vi.fn(),
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

    expect(writes.map((entry) => entry.path)).toEqual([
      '/teams/team-1/channels/channel-1/messages/message-1/replies/reply-1.json',
    ]);
  });
});

describe('bulk ingest pagination', () => {
  it('follows @odata.nextLink for channel message pages', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'team-1' }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }))
      .mockResolvedValueOnce(jsonResponse({ value: [{ id: 'channel-1' }] }))
      .mockResolvedValueOnce(jsonResponse({
        value: [{ id: 'message-1', body: { content: '<p>First</p>' } }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages?$skiptoken=abc',
      }))
      .mockResolvedValueOnce(jsonResponse({
        value: [{ id: 'message-2', body: { content: '<p>Second</p>' } }],
      }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }));

    const result = await bulkIngestTeam(
      { accessToken: 'token', fetchImpl },
      'team-1',
      { includeReplies: true },
    );

    expect(result.files
      .filter((file) => file.objectType === 'message')
      .map((file) => file.path)).toEqual([
        '/teams/team-1/channels/channel-1/messages/message-1.json',
        '/teams/team-1/channels/channel-1/messages/message-2.json',
      ]);
    expect(fetchImpl.mock.calls[4]?.[0]).toBe(
      'https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages?$skiptoken=abc',
    );
  });
});
