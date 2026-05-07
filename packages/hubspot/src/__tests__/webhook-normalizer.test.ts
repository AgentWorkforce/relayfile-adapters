import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HUBSPOT_REQUEST_TIMESTAMP_HEADER,
  HUBSPOT_SIGNATURE_V3_HEADER,
  assertValidHubSpotWebhookSignature,
  computeHubSpotSignatureV3,
  normalizeHubSpotWebhook,
  normalizeHubSpotWebhookBatch,
  validateHubSpotWebhookSignature,
} from '../index.js';

const body = '[{"subscriptionType":"contact.creation","objectId":101,"portalId":202,"occurredAt":1743155200000}]';
const method = 'POST';
const requestUri = 'https://example.com/webhooks/hubspot?portal=202';
const timestamp = '1743155200000';
const secret = 'hubspot-client-secret';
const knownGoodSignature = '2jkzXb9wIRJF5tbWZbSQ3ySXnkiXfFUiLjpv8V2meH0=';

test('validateHubSpotWebhookSignature accepts a known-good v3 HMAC signature', () => {
  const result = validateHubSpotWebhookSignature({
    body,
    clientSecret: secret,
    headers: {
      [HUBSPOT_REQUEST_TIMESTAMP_HEADER]: timestamp,
      [HUBSPOT_SIGNATURE_V3_HEADER]: knownGoodSignature,
    },
    nowMs: Number(timestamp) + 30_000,
    requestMethod: method,
    requestUri,
  });

  assert.equal(computeHubSpotSignatureV3({
    body,
    clientSecret: secret,
    requestMethod: method,
    requestTimestamp: timestamp,
    requestUri,
  }), knownGoodSignature);
  assert.equal(result.ok, true);
  assert.doesNotThrow(() =>
    assertValidHubSpotWebhookSignature({
      body,
      clientSecret: secret,
      headers: {
        [HUBSPOT_REQUEST_TIMESTAMP_HEADER]: timestamp,
        [HUBSPOT_SIGNATURE_V3_HEADER]: knownGoodSignature,
      },
      nowMs: Number(timestamp) + 30_000,
      requestMethod: method,
      requestUri,
    }),
  );
});

test('validateHubSpotWebhookSignature rejects a tampered body', () => {
  const result = validateHubSpotWebhookSignature({
    body: body.replace('101', '999'),
    clientSecret: secret,
    headers: {
      [HUBSPOT_REQUEST_TIMESTAMP_HEADER]: timestamp,
      [HUBSPOT_SIGNATURE_V3_HEADER]: knownGoodSignature,
    },
    nowMs: Number(timestamp) + 30_000,
    requestMethod: method,
    requestUri,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-signature');
});

test('validateHubSpotWebhookSignature rejects a missing signature header', () => {
  const result = validateHubSpotWebhookSignature({
    body,
    clientSecret: secret,
    headers: {
      [HUBSPOT_REQUEST_TIMESTAMP_HEADER]: timestamp,
    },
    nowMs: Number(timestamp) + 30_000,
    requestMethod: method,
    requestUri,
  });

  assert.deepEqual(result, { ok: false, reason: 'missing-signature' });
});

test('validateHubSpotWebhookSignature rejects an expired timestamp', () => {
  const result = validateHubSpotWebhookSignature({
    body,
    clientSecret: secret,
    headers: {
      [HUBSPOT_REQUEST_TIMESTAMP_HEADER]: timestamp,
      [HUBSPOT_SIGNATURE_V3_HEADER]: knownGoodSignature,
    },
    nowMs: Number(timestamp) + 300_001,
    requestMethod: method,
    requestUri,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired-timestamp');
});

test('normalizeHubSpotWebhook constructs normalized webhook metadata', () => {
  const normalized = normalizeHubSpotWebhook(body, {
    [HUBSPOT_REQUEST_TIMESTAMP_HEADER]: timestamp,
    [HUBSPOT_SIGNATURE_V3_HEADER]: knownGoodSignature,
    'X-Relay-Connection-Id': 'conn_hubspot_123',
    'X-Relay-Provider-Config-Key': 'hubspot-primary',
    'X-Request-Id': 'req_123',
  });

  assert.equal(normalized.provider, 'hubspot');
  assert.equal(normalized.connectionId, 'conn_hubspot_123');
  assert.equal(normalized.eventType, 'contact.created');
  assert.equal(normalized.objectType, 'contact');
  assert.equal(normalized.objectId, '101');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_hubspot_123',
    provider: 'hubspot',
    providerConfigKey: 'hubspot-primary',
    requestId: 'req_123',
  });
  assert.deepEqual(normalized.payload._webhook, {
    eventType: 'contact.created',
    objectId: '101',
    objectType: 'contact',
    occurredAt: 1743155200000,
    portalId: 202,
    signature: knownGoodSignature,
    subscriptionType: 'contact.creation',
    timestamp: 1743155200000,
  });
});

test('normalizeHubSpotWebhookBatch normalizes every primary CRM object type', () => {
  const normalized = normalizeHubSpotWebhookBatch([
    { objectId: 101, subscriptionType: 'contact.creation' },
    { objectId: 201, subscriptionType: 'company.propertyChange' },
    { objectId: 301, subscriptionType: 'deal.deletion' },
    { objectId: 401, subscriptionType: 'ticket.propertyChange' },
  ]);

  assert.deepEqual(normalized.map((event) => `${event.objectType}:${event.eventType}:${event.objectId}`), [
    'contact:contact.created:101',
    'company:company.propertyChange:201',
    'deal:deal.deleted:301',
    'ticket:ticket.propertyChange:401',
  ]);
});
