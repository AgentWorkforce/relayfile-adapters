import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SLACK_SUPPORTED_EVENTS,
  SlackAdapter,
  SlackWebhookSignatureError,
  assertSlackWebhookSignature,
  computeSlackPath,
  computeSlackWebhookSignature,
  createSlackMessageObjectId,
  createSlackReactionObjectId,
  createSlackThreadObjectId,
  createSlackThreadReplyObjectId,
  createSlackUrlVerificationResponse,
  normalizeSlackWebhook,
  validateSlackWebhookSignature,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
} from '../index.js';

function createProvider(): ConnectionProvider {
  return {
    name: 'mock-slack-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return {
        status: 200,
        headers: {},
        data: null as never,
      };
    },
    async healthCheck() {
      return true;
    },
  };
}

function createClient(): RelayFileClientLike {
  return {
    async writeFile() {
      return {};
    },
  };
}

function createAdapter(client: RelayFileClientLike = createClient()): SlackAdapter {
  return new SlackAdapter(client, createProvider(), {
    signingSecret: 'signing-secret',
  });
}

test('SlackAdapter.name and supported events are stable', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'slack');
  assert.deepEqual(SLACK_SUPPORTED_EVENTS, [
    'channel.archived',
    'channel.created',
    'channel.deleted',
    'channel.member_joined',
    'channel.member_left',
    'channel.renamed',
    'channel.unarchived',
    'group.archived',
    'group.deleted',
    'group.renamed',
    'group.unarchived',
    'message.created',
    'message.deleted',
    'message.updated',
    'reaction.added',
    'reaction.removed',
    'user.changed',
    'user.joined',
  ]);
  assert.deepEqual(adapter.supportedEvents(), [...SLACK_SUPPORTED_EVENTS]);
});

test('normalizeSlackWebhook normalizes message and reaction envelopes', () => {
  const messageEnvelope = {
    type: 'event_callback' as const,
    event_id: 'Ev-message',
    event_time: 1_711_111_111,
    event: {
      type: 'message' as const,
      channel: 'C123',
      text: 'hello relayfile',
      ts: '1711111111.000100',
      user: 'U123',
    },
  };

  assert.deepEqual(
    normalizeSlackWebhook(messageEnvelope, { 'x-connection-id': 'conn-message' }),
    {
      provider: 'slack',
      connectionId: 'conn-message',
      eventType: 'message.created',
      objectType: 'message',
      objectId: createSlackMessageObjectId('C123', '1711111111.000100'),
      payload: {
        type: 'message',
        channel: 'C123',
        text: 'hello relayfile',
        ts: '1711111111.000100',
        user: 'U123',
      },
    },
  );

  const reactionEnvelope = {
    type: 'event_callback' as const,
    event_id: 'Ev-reaction',
    event_time: 1_711_111_222,
    event: {
      type: 'reaction_added' as const,
      event_ts: '1711111222.000200',
      reaction: 'eyes',
      user: 'U777',
      thread_ts: '1711111111.000100',
      item: {
        type: 'message' as const,
        channel: 'C123',
        ts: '1711111111.000100',
      },
    },
  };

  assert.deepEqual(normalizeSlackWebhook(reactionEnvelope), {
    provider: 'slack',
    eventType: 'reaction.added',
    objectType: 'reaction',
    objectId: createSlackReactionObjectId({
      targetType: 'thread',
      channelId: 'C123',
      threadTs: '1711111111.000100',
      reaction: 'eyes',
      userId: 'U777',
    }),
    payload: {
      type: 'reaction_added',
      event_ts: '1711111222.000200',
      reaction: 'eyes',
      user: 'U777',
      thread_ts: '1711111111.000100',
      item: {
        type: 'message',
        channel: 'C123',
        ts: '1711111111.000100',
      },
    },
  });
});

test('normalizeSlackWebhook normalizes subscribed channel, group, and user events', () => {
  const cases = [
    {
      event: { type: 'channel_archive', channel: 'C123', event_ts: '1711111000.000100' },
      eventType: 'channel.archived',
      objectType: 'channel',
      objectId: 'C123',
    },
    {
      event: {
        type: 'channel_created',
        channel: { id: 'C234', name: 'new-channel', created: 1_711_111_000 },
        event_ts: '1711111000.000200',
      },
      eventType: 'channel.created',
      objectType: 'channel',
      objectId: 'C234',
    },
    {
      event: { type: 'channel_deleted', channel: 'C345', event_ts: '1711111000.000300' },
      eventType: 'channel.deleted',
      objectType: 'channel',
      objectId: 'C345',
    },
    {
      event: {
        type: 'channel_rename',
        channel: { id: 'C456', name: 'renamed-channel', created: 1_711_111_000 },
        event_ts: '1711111000.000400',
      },
      eventType: 'channel.renamed',
      objectType: 'channel',
      objectId: 'C456',
    },
    {
      event: { type: 'channel_unarchive', channel: 'C567', event_ts: '1711111000.000500' },
      eventType: 'channel.unarchived',
      objectType: 'channel',
      objectId: 'C567',
    },
    {
      event: { type: 'group_archive', channel: 'G123', event_ts: '1711111000.000600' },
      eventType: 'group.archived',
      objectType: 'channel',
      objectId: 'G123',
    },
    {
      event: { type: 'group_deleted', channel: 'G234', event_ts: '1711111000.000700' },
      eventType: 'group.deleted',
      objectType: 'channel',
      objectId: 'G234',
    },
    {
      event: {
        type: 'group_rename',
        channel: { id: 'G345', name: 'renamed-group', created: 1_711_111_000 },
        event_ts: '1711111000.000800',
      },
      eventType: 'group.renamed',
      objectType: 'channel',
      objectId: 'G345',
    },
    {
      event: { type: 'group_unarchive', channel: 'G456', event_ts: '1711111000.000900' },
      eventType: 'group.unarchived',
      objectType: 'channel',
      objectId: 'G456',
    },
    {
      event: {
        type: 'member_joined_channel',
        channel: 'C678',
        event_ts: '1711111000.001000',
        user: 'U123',
      },
      eventType: 'channel.member_joined',
      objectType: 'channel',
      objectId: 'C678',
    },
    {
      event: {
        type: 'member_left_channel',
        channel: 'C789',
        event_ts: '1711111000.001100',
        user: 'U123',
      },
      eventType: 'channel.member_left',
      objectType: 'channel',
      objectId: 'C789',
    },
    {
      event: {
        type: 'team_join',
        event_ts: '1711111000.001200',
        user: { id: 'U234', name: 'joined-user' },
      },
      eventType: 'user.joined',
      objectType: 'user',
      objectId: 'U234',
    },
    {
      event: {
        type: 'user_change',
        event_ts: '1711111000.001300',
        user: { id: 'U345', name: 'changed-user' },
      },
      eventType: 'user.changed',
      objectType: 'user',
      objectId: 'U345',
    },
  ];

  for (const { event, eventType, objectType, objectId } of cases) {
    const normalized = normalizeSlackWebhook({
      type: 'event_callback',
      event_id: `Ev-${event.type}`,
      event_time: 1_711_111_000,
      event,
    });

    assert.equal(normalized.eventType, eventType);
    assert.equal(normalized.objectType, objectType);
    assert.equal(normalized.objectId, objectId);
    assert.deepEqual(normalized.payload, event);
  }
});

test('signature validation rejects invalid signatures and handles url_verification', () => {
  const rawPayload = JSON.stringify({
    type: 'url_verification',
    challenge: 'challenge-token',
  });

  const normalized = normalizeSlackWebhook(rawPayload);
  assert.deepEqual(normalized, {
    provider: 'slack',
    eventType: 'url_verification',
    objectType: 'challenge',
    objectId: 'challenge-token',
    payload: {
      type: 'url_verification',
      challenge: 'challenge-token',
    },
  });

  assert.deepEqual(createSlackUrlVerificationResponse(normalized), {
    challenge: 'challenge-token',
  });

  assert.deepEqual(
    validateSlackWebhookSignature(rawPayload, {}, 'signing-secret', {
      now: 1_711_111_111,
    }),
    {
      ok: false,
      reason: 'missing_signature',
    },
  );

  const timestamp = 1_711_111_111;
  const mismatchedHeaders = {
    'x-slack-request-timestamp': String(timestamp),
    'x-slack-signature': computeSlackWebhookSignature(rawPayload, 'wrong-secret', timestamp),
  };

  assert.throws(
    () =>
      assertSlackWebhookSignature(rawPayload, mismatchedHeaders, 'signing-secret', {
        now: timestamp,
      }),
    (error: unknown) => {
      assert.ok(error instanceof SlackWebhookSignatureError);
      assert.equal(error.validation.ok, false);
      assert.equal(error.validation.reason, 'signature_mismatch');
      return true;
    },
  );
});

test('message and thread path mapping is deterministic', () => {
  const adapter = createAdapter();
  const messageId = createSlackMessageObjectId('C123', '1711111111.000100');
  const threadId = createSlackThreadObjectId('C123', '1711111111.000100');
  const replyId = createSlackThreadReplyObjectId(
    'C123',
    '1711111111.000100',
    '1711111222.000200',
  );

  // v2 canonical filename is `meta.json` (matches adapter-github, adapter-linear,
  // adapter-jira, adapter-confluence). adapter-slack <= 0.2.2 wrote `message.json`;
  // readers should fall back via `slackMessageReadCandidatePaths`.
  assert.equal(
    adapter.computePath('message', messageId),
    '/slack/channels/C123/messages/1711111111_000100/meta.json',
  );
  assert.equal(
    computeSlackPath('message', messageId),
    '/slack/channels/C123/messages/1711111111_000100/meta.json',
  );

  assert.equal(
    adapter.computePath('thread', threadId),
    '/slack/channels/C123/threads/1711111111_000100/meta.json',
  );
  assert.equal(
    computeSlackPath('thread', threadId),
    '/slack/channels/C123/threads/1711111111_000100/meta.json',
  );

  assert.equal(
    adapter.computePath('thread_reply', replyId),
    '/slack/channels/C123/threads/1711111111_000100/replies/1711111222_000200.json',
  );
  assert.equal(
    computeSlackPath('thread_reply', replyId),
    '/slack/channels/C123/threads/1711111111_000100/replies/1711111222_000200.json',
  );
});

test('computeSemantics extracts mentions, links, reactions, and thread depth', () => {
  const adapter = createAdapter();
  const replyObjectId = createSlackThreadReplyObjectId(
    'C123',
    '1711111111.000100',
    '1711111222.000200',
  );

  const semantics = adapter.computeSemantics('thread_reply', replyObjectId, {
    type: 'message',
    channel: 'C123',
    channel_type: 'channel',
    user: 'U123',
    item_user: 'U999',
    thread_ts: '1711111111.000100',
    ts: '1711111222.000200',
    text: 'Hello <@U234> <#C777|ops> <!here> https://relay.dev <mailto:test@example.com|mail>',
    attachments: [
      {
        text: 'Attachment mention <@U345>',
        title_link: 'https://example.com/docs',
      },
    ],
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Review https://slack.com/docs too',
        },
      },
    ],
    reaction: 'eyes',
    reactions: [
      { name: 'thumbsup', count: 2 },
      { name: 'eyes' },
    ],
  });

  assert.equal(semantics.properties?.event_type, 'message');
  assert.equal(semantics.properties?.object_id, replyObjectId);
  assert.equal(semantics.properties?.object_type, 'thread_reply');
  assert.equal(semantics.properties?.channel_id, 'C123');
  assert.equal(semantics.properties?.channel_type, 'channel');
  assert.equal(semantics.properties?.user_id, 'U123');
  assert.equal(semantics.properties?.item_user_id, 'U999');
  assert.equal(semantics.properties?.thread_ts, '1711111111.000100');
  assert.equal(semantics.properties?.message_ts, '1711111222.000200');
  assert.equal(semantics.properties?.mention_count, '4');
  assert.equal(semantics.properties?.link_count, '4');
  assert.equal(semantics.properties?.reaction_count, '2');
  assert.equal(semantics.properties?.thread_depth, '1');

  assert.ok(semantics.relations?.includes('channel:C123'));
  assert.ok(semantics.relations?.includes('user:U123'));
  assert.ok(semantics.relations?.includes('subject_user:U999'));
  assert.ok(semantics.relations?.includes('mentions:user:U234'));
  assert.ok(semantics.relations?.includes('mentions:user:U345'));
  assert.ok(semantics.relations?.includes('mentions:channel:C777'));
  assert.ok(semantics.relations?.includes('mentions:special:here'));
  assert.ok(semantics.relations?.includes('link:https://relay.dev'));
  assert.ok(semantics.relations?.includes('link:mailto:test@example.com'));
  assert.ok(semantics.relations?.includes('link:https://example.com/docs'));
  assert.ok(semantics.relations?.includes('link:https://slack.com/docs'));
  assert.ok(semantics.relations?.includes('reaction:eyes'));
  assert.ok(semantics.relations?.includes('reaction:thumbsup:2'));
  assert.ok(semantics.relations?.includes('thread:C123:1711111111.000100'));
  assert.ok(semantics.relations?.includes('reply_to:C123:1711111111.000100'));

  assert.ok(semantics.permissions?.includes('scope:workspace'));

  assert.ok(semantics.comments?.includes('mention:user:U234'));
  assert.ok(semantics.comments?.includes('mention:channel:C777'));
  assert.ok(semantics.comments?.includes('mention:special:here'));
  assert.ok(semantics.comments?.includes('link:https://relay.dev'));
  assert.ok(semantics.comments?.includes('reaction:thumbsup:2'));
  assert.ok(semantics.comments?.includes('thread_depth:1'));

  const rootThreadSemantics = adapter.computeSemantics(
    'thread',
    createSlackThreadObjectId('C123', '1711111111.000100'),
    {
      type: 'message',
      channel: 'C123',
      ts: '1711111111.000100',
      thread_ts: '1711111111.000100',
    },
  );

  assert.equal(rootThreadSemantics.properties?.thread_depth, '0');
  assert.ok(rootThreadSemantics.comments?.includes('thread_depth:0'));
});

test('computeSemantics extracts user ids from Slack user objects', () => {
  const adapter = createAdapter();

  const semantics = adapter.computeSemantics('user', 'U234', {
    type: 'team_join',
    event_ts: '1711111000.001200',
    user: { id: 'U234', name: 'joined-user' },
  });

  assert.equal(semantics.properties?.user_id, 'U234');
  assert.ok(semantics.relations?.includes('user:U234'));
});

test('ingestWebhook keeps explicit user events canonical as users', async () => {
  const writes: Parameters<RelayFileClientLike['writeFile']>[0][] = [];
  const adapter = createAdapter({
    async writeFile(input) {
      writes.push(input);
      return {};
    },
  });

  const result = await adapter.ingestWebhook('workspace-id', {
    provider: 'slack',
    eventType: 'user.joined',
    objectType: 'message',
    objectId: 'fallback-object-id',
    payload: {
      type: 'message',
      text: 'Malformed payload shape should not override explicit user event type.',
      user: { id: 'U234', name: 'joined-user' },
    },
  });

  assert.deepEqual(result.paths, ['/slack/users/U234__joined-user/meta.json']);
  assert.equal(writes[0]?.path, '/slack/users/U234__joined-user/meta.json');
  assert.equal(writes[0]?.semantics?.properties?.object_type, 'user');
  assert.equal(writes[0]?.semantics?.properties?.object_id, 'U234');
  assert.equal(writes[0]?.semantics?.properties?.user_id, 'U234');
  assert.ok(writes[0]?.semantics?.relations?.includes('user:U234'));
});

test('barrel exports compile and import cleanly', async () => {
  const barrel = await import('../index.js');

  assert.equal(barrel.SlackAdapter, SlackAdapter);
  assert.equal(barrel.normalizeSlackWebhook, normalizeSlackWebhook);
  assert.equal(barrel.computeSlackPath, computeSlackPath);
  assert.equal(barrel.createSlackUrlVerificationResponse, createSlackUrlVerificationResponse);
});
