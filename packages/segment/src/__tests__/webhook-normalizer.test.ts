import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  SEGMENT_SIGNATURE_HEADER,
  SEGMENT_SOURCE_ID_HEADER,
  SEGMENT_TIMESTAMP_HEADER,
  assertValidSegmentWebhookSignature,
  normalizeSegmentWebhook,
  validateSegmentWebhookSignature,
  validateSegmentWebhookTimestamp,
} from '../index.js';

const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);

function sign(rawBody: string, secret: string): string {
  return createHmac('sha1', secret).update(rawBody).digest('hex');
}

test('normalizeSegmentWebhook accepts a known-good HMAC-SHA1 signature', () => {
  const rawBody = JSON.stringify({
    type: 'track',
    messageId: 'msg_123',
    userId: 'user_123',
    event: 'Signed Up',
    writeKey: 'source_123',
  });
  const signature = sign(rawBody, 'segment-secret');

  const normalized = normalizeSegmentWebhook(
    rawBody,
    {
      [SEGMENT_SIGNATURE_HEADER]: signature,
      [SEGMENT_SOURCE_ID_HEADER]: 'source_123',
      [SEGMENT_TIMESTAMP_HEADER]: String(Math.floor(NOW / 1000)),
      'X-Relay-Connection-Id': 'conn_segment_123',
    },
    {
      now: NOW,
      sourceSecrets: {
        source_123: 'segment-secret',
      },
    },
  );

  assert.equal(normalized.provider, 'segment');
  assert.equal(normalized.connectionId, 'conn_segment_123');
  assert.equal(normalized.eventType, 'track.upsert');
  assert.equal(normalized.objectType, 'track');
  assert.equal(normalized.objectId, 'msg_123');
  assert.equal(normalized.payload._webhook && typeof normalized.payload._webhook, 'object');
});

test('validateSegmentWebhookSignature rejects a tampered body', () => {
  const rawBody = JSON.stringify({
    type: 'identify',
    userId: 'user_123',
    traits: {
      plan: 'free',
    },
  });
  const signature = sign(rawBody, 'segment-secret');
  const tamperedBody = JSON.stringify({
    type: 'identify',
    userId: 'user_123',
    traits: {
      plan: 'enterprise',
    },
  });

  const result = validateSegmentWebhookSignature(
    tamperedBody,
    { [SEGMENT_SIGNATURE_HEADER]: signature },
    'segment-secret',
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-signature');
  assert.throws(
    () => assertValidSegmentWebhookSignature(tamperedBody, { [SEGMENT_SIGNATURE_HEADER]: signature }, 'segment-secret'),
    /invalid-signature/,
  );
});

test('normalizeSegmentWebhook requires raw request bytes for signature validation', () => {
  const rawBody = JSON.stringify({
    type: 'track',
    messageId: 'msg_123',
    userId: 'user_123',
    event: 'Signed Up',
  });
  const signature = sign(rawBody, 'segment-secret');

  assert.throws(
    () =>
      normalizeSegmentWebhook(
        JSON.parse(rawBody) as Record<string, unknown>,
        {
          [SEGMENT_SIGNATURE_HEADER]: signature,
          [SEGMENT_TIMESTAMP_HEADER]: String(Math.floor(NOW / 1000)),
        },
        {
          now: NOW,
          secret: 'segment-secret',
        },
      ),
    /original raw request body/,
  );
});

test('validateSegmentWebhookSignature rejects missing signature headers', () => {
  const rawBody = JSON.stringify({
    type: 'page',
    messageId: 'msg_page_123',
    name: 'Home',
  });

  const result = validateSegmentWebhookSignature(rawBody, {}, 'segment-secret');

  assert.deepEqual(result, { ok: false, reason: 'missing-signature' });
});

test('validateSegmentWebhookTimestamp rejects expired timestamp headers', () => {
  const result = validateSegmentWebhookTimestamp(
    {
      [SEGMENT_TIMESTAMP_HEADER]: String(Math.floor((NOW - 10 * 60 * 1000) / 1000)),
    },
    {
      now: NOW,
      toleranceSeconds: 300,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired-timestamp');
  assert.equal(result.timestamp, NOW - 10 * 60 * 1000);
});
