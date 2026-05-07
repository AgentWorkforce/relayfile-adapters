import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  INTERCOM_SIGNATURE_HEADER,
  INTERCOM_TIMESTAMP_HEADER,
  assertValidIntercomWebhookSignature,
  computeIntercomWebhookSignature,
  normalizeIntercomWebhook,
  validateIntercomWebhookSignature,
  validateIntercomWebhookTimestamp,
} from '../index.js';

const conversationPayload = {
  type: 'notification_event',
  topic: 'conversation.user.created',
  app_id: 'app_123',
  id: 'notif_123',
  created_at: 1_746_600_000,
  data: {
    type: 'notification_event_data',
    item: {
      id: 'conv_123',
      type: 'conversation',
      state: 'open',
      source: {
        body: 'Hello',
      },
    },
  },
};

test('normalizeIntercomWebhook extracts normalized metadata and connection metadata', () => {
  const normalized = normalizeIntercomWebhook(conversationPayload, {
    'X-Relay-Connection-Id': 'conn_intercom_123',
    'X-Relay-Provider-Config-Key': 'intercom',
    'X-Request-Id': 'req_123',
  });

  assert.equal(normalized.provider, 'intercom');
  assert.equal(normalized.connectionId, 'conn_intercom_123');
  assert.equal(normalized.eventType, 'conversation.created');
  assert.equal(normalized.objectType, 'conversation');
  assert.equal(normalized.objectId, 'conv_123');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_intercom_123',
    provider: 'intercom',
    providerConfigKey: 'intercom',
    requestId: 'req_123',
  });
  assert.deepEqual(normalized.payload._webhook, {
    action: 'created',
    appId: 'app_123',
    createdAt: '2025-05-07T06:40:00.000Z',
    eventType: 'conversation.created',
    objectId: 'conv_123',
    objectType: 'conversation',
    topic: 'conversation.user.created',
    type: 'notification_event',
    webhookId: 'notif_123',
  });
});

test('validateIntercomWebhookSignature accepts known-good HMAC-SHA1 signatures', () => {
  const rawPayload = JSON.stringify(conversationPayload);
  const secret = 'intercom-secret';
  const expected = `sha1=${createHmac('sha1', secret).update(rawPayload).digest('hex')}`;

  assert.equal(computeIntercomWebhookSignature(rawPayload, secret), expected);
  const valid = validateIntercomWebhookSignature(rawPayload, {
    [INTERCOM_SIGNATURE_HEADER]: expected,
  }, secret);
  assert.equal(valid.ok, true);
  assert.equal(valid.expectedSignature, expected);
  assert.doesNotThrow(() =>
    assertValidIntercomWebhookSignature(rawPayload, { [INTERCOM_SIGNATURE_HEADER]: expected }, secret),
  );
});

test('validateIntercomWebhookSignature rejects tampered webhook bodies', () => {
  const rawPayload = JSON.stringify(conversationPayload);
  const tamperedPayload = JSON.stringify({
    ...conversationPayload,
    topic: 'conversation.user.updated',
  });
  const secret = 'intercom-secret';
  const validSignature = computeIntercomWebhookSignature(rawPayload, secret);

  const invalid = validateIntercomWebhookSignature(tamperedPayload, {
    [INTERCOM_SIGNATURE_HEADER]: validSignature,
  }, secret);

  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-signature');
  assert.equal(invalid.receivedSignature, validSignature);
});

test('validateIntercomWebhookSignature rejects missing signature headers', () => {
  const rawPayload = JSON.stringify(conversationPayload);
  const missing = validateIntercomWebhookSignature(rawPayload, {}, 'intercom-secret');

  assert.deepEqual(missing, {
    ok: false,
    reason: 'missing-signature',
  });
  assert.throws(
    () => assertValidIntercomWebhookSignature(rawPayload, {}, 'intercom-secret'),
    /missing-signature/,
  );
});

test('validateIntercomWebhookTimestamp rejects expired timestamps when supplied', () => {
  const fresh = validateIntercomWebhookTimestamp({
    [INTERCOM_TIMESTAMP_HEADER]: '1746600000',
  }, 60_000, 1_746_600_030_000);
  assert.equal(fresh.ok, true);

  const stale = validateIntercomWebhookTimestamp({
    [INTERCOM_TIMESTAMP_HEADER]: '1746600000',
  }, 60_000, 1_746_600_120_001);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');
});
