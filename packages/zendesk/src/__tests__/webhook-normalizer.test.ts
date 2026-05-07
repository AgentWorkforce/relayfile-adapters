import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ZENDESK_SIGNATURE_HEADER,
  ZENDESK_SIGNATURE_TIMESTAMP_HEADER,
  assertValidZendeskWebhookSignature,
  computeZendeskWebhookSignature,
  normalizeZendeskWebhook,
  validateZendeskWebhookSignature,
  validateZendeskWebhookTimestamp,
} from '../index.js';

const rawTicketPayload = JSON.stringify({
  event_type: 'ticket.updated',
  ticket: {
    id: 123,
    subject: 'Cannot log in',
    status: 'open',
  },
});

// Real Zendesk sends the timestamp header in ISO 8601 UTC format
// (e.g. "2021-03-25T05:09:27Z") — confirmed by the verifying-webhooks
// reference. The HMAC input is the raw header string concatenated with
// the body, so this fixture must use that exact format. A millisecond
// fixture passes our internal validation but doesn't reflect production:
// the signature we'd compute against ms differs from the signature Zendesk
// signs with ISO 8601, so production webhooks would fail verification.
const timestamp = '2024-01-15T12:00:00Z';
const timestampEpochMs = Date.parse(timestamp); // 1_705_320_000_000
const secret = 'zendesk-secret';
const knownGoodSignature = '5TncuXWaIPS6N52iK6ZdIfE3Ru4lDjMfqka/CndZBTY=';

test('normalizeZendeskWebhook extracts normalized event metadata and connection metadata', () => {
  const normalized = normalizeZendeskWebhook(rawTicketPayload, {
    'X-Relay-Connection-Id': 'conn_zendesk_123',
    'X-Relay-Provider-Config-Key': 'zendesk-primary',
    'X-Request-Id': 'req_123',
  });

  assert.equal(normalized.provider, 'zendesk');
  assert.equal(normalized.connectionId, 'conn_zendesk_123');
  assert.equal(normalized.eventType, 'ticket.updated');
  assert.equal(normalized.objectType, 'ticket');
  assert.equal(normalized.objectId, '123');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_zendesk_123',
    provider: 'zendesk',
    providerConfigKey: 'zendesk-primary',
    requestId: 'req_123',
  });
});

test('validateZendeskWebhookSignature accepts a known-good HMAC-SHA256 signature', () => {
  assert.equal(computeZendeskWebhookSignature(rawTicketPayload, timestamp, secret), knownGoodSignature);

  const valid = validateZendeskWebhookSignature(
    rawTicketPayload,
    {
      [ZENDESK_SIGNATURE_HEADER]: knownGoodSignature,
      [ZENDESK_SIGNATURE_TIMESTAMP_HEADER]: timestamp,
    },
    secret,
    timestampEpochMs + 30_000,
  );

  assert.equal(valid.ok, true);
  assert.equal(valid.expectedSignature, knownGoodSignature);
  assert.doesNotThrow(() =>
    assertValidZendeskWebhookSignature(
      rawTicketPayload,
      {
        [ZENDESK_SIGNATURE_HEADER]: knownGoodSignature,
        [ZENDESK_SIGNATURE_TIMESTAMP_HEADER]: timestamp,
      },
      secret,
      timestampEpochMs + 30_000,
    ),
  );
});

test('validateZendeskWebhookSignature rejects a tampered raw body', () => {
  const tamperedPayload = JSON.stringify({
    event_type: 'ticket.updated',
    ticket: {
      id: 123,
      subject: 'Cannot log in',
      status: 'solved',
    },
  });

  const invalid = validateZendeskWebhookSignature(
    tamperedPayload,
    {
      [ZENDESK_SIGNATURE_HEADER]: knownGoodSignature,
      [ZENDESK_SIGNATURE_TIMESTAMP_HEADER]: timestamp,
    },
    secret,
    timestampEpochMs + 30_000,
  );

  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-signature');
});

test('validateZendeskWebhookSignature rejects a missing signature header', () => {
  const missing = validateZendeskWebhookSignature(
    rawTicketPayload,
    {
      [ZENDESK_SIGNATURE_TIMESTAMP_HEADER]: timestamp,
    },
    secret,
    timestampEpochMs + 30_000,
  );

  assert.deepEqual(missing, {
    ok: false,
    reason: 'missing-signature',
    webhookTimestamp: timestampEpochMs,
  });
});

test('validateZendeskWebhookSignature rejects parsed payloads and malformed base64', () => {
  const parsedPayload = JSON.parse(rawTicketPayload) as never;

  assert.throws(
    () => validateZendeskWebhookSignature(
      parsedPayload,
      {
        [ZENDESK_SIGNATURE_HEADER]: knownGoodSignature,
        [ZENDESK_SIGNATURE_TIMESTAMP_HEADER]: timestamp,
      },
      secret,
      timestampEpochMs + 30_000,
    ),
    /raw request body/,
  );

  const malformed = validateZendeskWebhookSignature(
    rawTicketPayload,
    {
      [ZENDESK_SIGNATURE_HEADER]: 'a=bc',
      [ZENDESK_SIGNATURE_TIMESTAMP_HEADER]: timestamp,
    },
    secret,
    timestampEpochMs + 30_000,
  );

  assert.equal(malformed.ok, false);
  assert.equal(malformed.reason, 'malformed-signature');
});

test('validateZendeskWebhookSignature rejects expired timestamps', () => {
  const expired = validateZendeskWebhookSignature(
    rawTicketPayload,
    {
      [ZENDESK_SIGNATURE_HEADER]: knownGoodSignature,
      [ZENDESK_SIGNATURE_TIMESTAMP_HEADER]: timestamp,
    },
    secret,
    timestampEpochMs + 300_001,
  );

  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'expired-timestamp');

  const timestampOnly = validateZendeskWebhookTimestamp(
    {
      [ZENDESK_SIGNATURE_TIMESTAMP_HEADER]: timestamp,
    },
    300_000,
    timestampEpochMs + 300_001,
  );
  assert.equal(timestampOnly.ok, false);
  assert.equal(timestampOnly.reason, 'expired-timestamp');
});
