import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReadOnlyFieldError, resolveDeleteRequest, resolveWritebackRequest } from '../writeback.js';

describe('slack writeback', () => {
  describe('post_message', () => {
    it('posts a plain-string body to a channel-name slug path', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/customer-success/messages/draft@message.json',
        'Hello team!',
      );
      assert.strictEqual(req.action, 'post_message');
      assert.strictEqual(req.endpoint, '/api/chat.postMessage');
      assert.deepStrictEqual(req.body, { channel: '#customer-success', text: 'Hello team!' });
    });

    it('uses raw channel id when the segment matches Slack id shape', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/C01ABC1234/messages/draft@message.json',
        'Hello team!',
      );
      assert.strictEqual((req.body as { channel: string }).channel, 'C01ABC1234');
    });

    it('extracts canonical channel id from <slug>--<id> path (round-trip safe)', () => {
      // path-mapper.channelSegment(name, id) emits this form so writeback can
      // recover the canonical id even when the slug is lossy (e.g. names with
      // underscores that slugify into hyphens).
      const req = resolveWritebackRequest(
        '/slack/channels/customer-success--C01ABC1234/messages/draft@message.json',
        'Hello team!',
      );
      assert.strictEqual((req.body as { channel: string }).channel, 'C01ABC1234');
    });

    it('honors `channel` payload override over path-derived channel', () => {
      // Escape hatch when the path uses a lossy slug — agent passes the
      // canonical id (or a different channel entirely) in the JSON payload.
      const req = resolveWritebackRequest(
        '/slack/channels/customer-success/messages/draft@message.json',
        JSON.stringify({ text: 'hi', channel: 'C01ABC1234' }),
      );
      assert.strictEqual((req.body as { channel: string }).channel, 'C01ABC1234');
    });

    it('forwards JSON object payload with text, blocks, attachments, and overrides', () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*hi*' } }];
      const req = resolveWritebackRequest(
        '/slack/channels/customer-success/messages/draft@message.json',
        JSON.stringify({
          text: 'fallback',
          blocks,
          username: 'Sage',
          icon_emoji: ':robot_face:',
          unfurl_links: false,
          mrkdwn: true,
        }),
      );
      assert.deepStrictEqual(req.body, {
        channel: '#customer-success',
        text: 'fallback',
        blocks,
        username: 'Sage',
        icon_emoji: ':robot_face:',
        unfurl_links: false,
        mrkdwn: true,
      });
    });

    it('rejects an empty body', () => {
      assert.throws(
        () => resolveWritebackRequest('/slack/channels/general/messages/draft@message.json', ''),
        /requires a non-empty body/,
      );
    });

    it('rejects a JSON object that has no text/blocks/attachments', () => {
      assert.throws(
        () =>
          resolveWritebackRequest(
            '/slack/channels/general/messages/draft@message.json',
            JSON.stringify({ username: 'NoBody' }),
          ),
        /requires `text`, `blocks`, or `attachments`/,
      );
    });

    it('rejects read-only fields in JSON payloads', () => {
      assert.throws(
        () =>
          resolveWritebackRequest(
            '/slack/channels/general/messages/draft@message.json',
            JSON.stringify({ id: '1762445678.001234', text: 'Hello' }),
          ),
        (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'id',
      );
    });
  });

  describe('reply_in_thread', () => {
    it('reverses the tsToken (underscore → dot) and sets thread_ts', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/customer-success/messages/1762445678_001234/replies/draft@reply.json',
        'Following up here.',
      );
      assert.strictEqual(req.action, 'reply_in_thread');
      assert.deepStrictEqual(req.body, {
        channel: '#customer-success',
        text: 'Following up here.',
        thread_ts: '1762445678.001234',
      });
    });

    it('handles subjectSlug--tsToken message segment', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/customer-success/messages/onboarding-acme--1762445678_001234/replies/draft@reply.json',
        'Reply body.',
      );
      assert.strictEqual(
        (req.body as { thread_ts: string }).thread_ts,
        '1762445678.001234',
      );
    });

    it('honors reply_broadcast on thread replies only', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/general/messages/1762445678_001234/replies/draft@reply.json',
        JSON.stringify({ text: 'announce', reply_broadcast: true }),
      );
      assert.strictEqual((req.body as { reply_broadcast: boolean }).reply_broadcast, true);
    });

    it('honors reply_broadcast when thread_ts comes from payload (top-level route)', () => {
      // top-level messages/draft@message.json route + payload thread_ts → still a reply
      const req = resolveWritebackRequest(
        '/slack/channels/general/messages/draft@message.json',
        JSON.stringify({
          text: 'announce',
          thread_ts: '1762445678.001234',
          reply_broadcast: true,
        }),
      );
      assert.strictEqual(req.action, 'reply_in_thread');
      assert.strictEqual((req.body as { thread_ts: string }).thread_ts, '1762445678.001234');
      assert.strictEqual((req.body as { reply_broadcast: boolean }).reply_broadcast, true);
    });

    it('does not set reply_broadcast on a top-level message with no thread context', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/general/messages/draft@message.json',
        JSON.stringify({ text: 'plain', reply_broadcast: true }),
      );
      assert.strictEqual(req.action, 'post_message');
      assert.strictEqual('reply_broadcast' in (req.body as object), false);
    });
  });

  describe('add_reaction', () => {
    it('accepts a bare emoji name', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/general/messages/1762445678_001234/reactions/draft@reaction.json',
        'eyes',
      );
      assert.strictEqual(req.action, 'add_reaction');
      assert.strictEqual(req.endpoint, '/api/reactions.add');
      assert.deepStrictEqual(req.body, {
        channel: '#general',
        timestamp: '1762445678.001234',
        name: 'eyes',
      });
    });

    it('strips surrounding colons from the emoji name', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/general/messages/1762445678_001234/reactions/draft@reaction.json',
        ':white_check_mark:',
      );
      assert.strictEqual((req.body as { name: string }).name, 'white_check_mark');
    });

    it('accepts JSON {name} payload', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/general/messages/1762445678_001234/reactions/draft@reaction.json',
        JSON.stringify({ name: 'rocket' }),
      );
      assert.strictEqual((req.body as { name: string }).name, 'rocket');
    });

    it('rejects missing emoji name', () => {
      assert.throws(
        () =>
          resolveWritebackRequest(
            '/slack/channels/general/messages/1762445678_001234/reactions/draft@reaction.json',
            JSON.stringify({}),
          ),
        /requires `name`/,
      );
    });

    it('extracts canonical channel id from <slug>--<id> reaction path', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/customer-success--C01ABC1234/messages/1762445678_001234/reactions/draft@reaction.json',
        'eyes',
      );
      assert.strictEqual((req.body as { channel: string }).channel, 'C01ABC1234');
    });

    it('honors `channel` payload override on reactions', () => {
      const req = resolveWritebackRequest(
        '/slack/channels/customer-success/messages/1762445678_001234/reactions/draft@reaction.json',
        JSON.stringify({ name: 'rocket', channel: 'C01ABC1234' }),
      );
      assert.strictEqual((req.body as { channel: string }).channel, 'C01ABC1234');
    });
  });

  describe('unmatched paths', () => {
    it('throws for unrecognized paths', () => {
      assert.throws(
        () => resolveWritebackRequest('/slack/users/U01ABC.json', '{}'),
        /No Slack writeback rule matched/,
      );
    });
  });

  describe('delete', () => {
    it('maps canonical messages and reactions to Slack delete calls', () => {
      assert.deepStrictEqual(
        resolveDeleteRequest('/slack/channels/general/messages/1762445678_001234.json'),
        {
          action: 'delete_message',
          method: 'POST',
          endpoint: '/api/chat.delete',
          body: {
            channel: '#general',
            ts: '1762445678.001234',
          },
        },
      );
      assert.deepStrictEqual(
        resolveDeleteRequest('/slack/channels/general/messages/1762445678_001234/reactions/eyes.json'),
        {
          action: 'remove_reaction',
          method: 'POST',
          endpoint: '/api/reactions.remove',
          body: {
            channel: '#general',
            timestamp: '1762445678.001234',
            name: 'eyes',
          },
        },
      );
      assert.throws(
        () => resolveDeleteRequest('/slack/channels/general/messages/draft@message.json'),
        /No Slack delete writeback rule matched/,
      );
    });
  });
});
