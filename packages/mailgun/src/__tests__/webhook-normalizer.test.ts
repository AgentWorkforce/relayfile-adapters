import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  MAILGUN_DOMAIN_HEADER,
  MAILGUN_SIGNATURE_HEADER,
  MAILGUN_TIMESTAMP_HEADER,
  MAILGUN_TOKEN_HEADER,
  assertValidMailgunWebhookSignature,
  normalizeMailgunWebhook,
  validateMailgunWebhookSignature,
  validateMailgunWebhookTimestamp,
} from '../index.js';

const apiKey = 'mailgun-api-key';
const timestamp = '1778140800';
const token = 'mailgun-token-123';
const signature = createHmac('sha256', apiKey).update(`${timestamp}${token}`).digest('hex');

function signedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signature: {
      timestamp,
      token,
      signature,
    },
    'event-data': {
      id: 'event_123',
      event: 'delivered',
      domain: 'mg.example.com',
      recipient: 'user@example.net',
      message: {
        id: 'message_123',
        subject: 'Receipt',
      },
    },
    ...overrides,
  };
}

test('normalizeMailgunWebhook extracts normalized event and connection metadata', () => {
  const normalized = normalizeMailgunWebhook(signedPayload(), {
    [MAILGUN_DOMAIN_HEADER]: 'mg.example.com',
    'X-Relay-Connection-Id': 'conn_mailgun_123',
    'X-Relay-Provider-Config-Key': 'mailgun-primary',
    'X-Request-Id': 'req_123',
  });

  assert.equal(normalized.provider, 'mailgun');
  assert.equal(normalized.connectionId, 'conn_mailgun_123');
  assert.equal(normalized.eventType, 'event.delivered');
  assert.equal(normalized.objectType, 'event');
  assert.equal(normalized.objectId, 'event_123');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_mailgun_123',
    domain: 'mg.example.com',
    provider: 'mailgun',
    providerConfigKey: 'mailgun-primary',
    requestId: 'req_123',
  });
});

test('validateMailgunWebhookSignature accepts known-good HMAC payload signatures', () => {
  const rawPayload = JSON.stringify(signedPayload());
  const result = validateMailgunWebhookSignature(rawPayload, {}, apiKey);

  assert.equal(result.ok, true);
  assert.equal(result.expectedSignature, signature);
  assert.doesNotThrow(() => assertValidMailgunWebhookSignature(rawPayload, {}, apiKey));
});

test('validateMailgunWebhookSignature rejects tampered body signature material', () => {
  const tampered = signedPayload({
    signature: {
      timestamp,
      token: 'mailgun-token-tampered',
      signature,
    },
  });

  const result = validateMailgunWebhookSignature(JSON.stringify(tampered), {}, apiKey);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-signature');
});

test('validateMailgunWebhookSignature rejects missing signature headers when payload signature is absent', () => {
  const payloadWithoutSignature = {
    'event-data': {
      id: 'event_123',
      event: 'delivered',
    },
  };

  const result = validateMailgunWebhookSignature(JSON.stringify(payloadWithoutSignature), {}, apiKey);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-header');
});

test('validateMailgunWebhookSignature accepts header signature fields as fallback', () => {
  const payloadWithoutSignature = {
    'event-data': {
      id: 'event_123',
      event: 'delivered',
    },
  };

  const result = validateMailgunWebhookSignature(JSON.stringify(payloadWithoutSignature), {
    [MAILGUN_SIGNATURE_HEADER]: signature,
    [MAILGUN_TIMESTAMP_HEADER]: timestamp,
    [MAILGUN_TOKEN_HEADER]: token,
  }, apiKey);

  assert.equal(result.ok, true);
});

test('validateMailgunWebhookTimestamp rejects expired timestamps', () => {
  const expired = validateMailgunWebhookTimestamp(
    signedPayload(),
    60_000,
    (Number(timestamp) * 1000) + 120_001,
  );

  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'stale-timestamp');
});
