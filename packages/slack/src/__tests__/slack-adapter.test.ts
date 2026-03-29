import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
  type RelayFileClientLike,
} from '../index.js';

const SUPPORTED_EVENTS = [
  'channel.archived',
  'channel.created',
  'channel.member_joined',
  'channel.member_left',
  'channel.renamed',
  'channel.unarchived',
  'message.created',
  'message.deleted',
  'message.updated',
  'reaction.added',
  'reaction.removed',
];

function createProvider(): ConnectionProvider {
  return {
    name: 'mock-slack-provider',
    async proxy() {
      return {
        status: 200,
        headers: {},
        data: null,
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
  assert.deepEqual(adapter.supportedEvents(), SUPPORTED_EVENTS);
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

  assert.equal(
    adapter.computePath('message', messageId),
    '/slack/channels/C123/messages/1711111111_000100/message.json',
  );
  assert.equal(
    computeSlackPath('message', messageId),
    '/slack/channels/C123/messages/1711111111_000100/message.json',
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

test('barrel exports compile and import cleanly', async () => {
  const barrel = await import('../index.js');

  assert.equal(barrel.SlackAdapter, SlackAdapter);
  assert.equal(barrel.normalizeSlackWebhook, normalizeSlackWebhook);
  assert.equal(barrel.computeSlackPath, computeSlackPath);
  assert.equal(barrel.createSlackUrlVerificationResponse, createSlackUrlVerificationResponse);
});
