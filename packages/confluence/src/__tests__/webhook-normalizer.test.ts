import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  CONFLUENCE_DELIVERY_HEADER,
  CONFLUENCE_SIGNATURE_HEADER,
  assertValidConfluenceWebhookSignature,
  normalizeConfluenceWebhook,
  validateConfluenceWebhookSignature,
  validateConfluenceWebhookTimestamp,
} from '../index.js';

const pagePayload = {
  webhookEvent: 'page_updated',
  timestamp: 1_743_155_200_000,
  webhookId: 'webhook_123',
  page: {
    id: '98765',
    title: 'Release Plan',
    spaceId: '12345',
    status: 'current',
  },
};

test('normalizeConfluenceWebhook canonicalizes Atlassian webhookEvent and extracts subject', () => {
  const normalized = normalizeConfluenceWebhook(pagePayload, {
    [CONFLUENCE_DELIVERY_HEADER]: 'delivery_123',
    'X-Relay-Connection-Id': 'conn_confluence_123',
    'X-Relay-Provider-Config-Key': 'confluence',
  });

  assert.equal(normalized.provider, 'confluence');
  assert.equal(normalized.connectionId, 'conn_confluence_123');
  assert.equal(normalized.providerConfigKey, 'confluence');
  assert.equal(normalized.eventType, 'page.update');
  assert.equal(normalized.objectType, 'page');
  assert.equal(normalized.objectId, '98765');
  assert.equal((normalized.payload as { id: string }).id, '98765');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_confluence_123',
    deliveryId: 'delivery_123',
    provider: 'confluence',
    providerConfigKey: 'confluence',
  });
});

test('normalizeConfluenceWebhook handles trashed events as remove and accepts dot-notation eventType', () => {
  const removed = normalizeConfluenceWebhook(
    {
      webhookEvent: 'page_trashed',
      page: { id: '98765', title: 'Release Plan' },
    },
    {},
  );
  assert.equal(removed.eventType, 'page.remove');

  const explicit = normalizeConfluenceWebhook(
    {
      eventType: 'space.update',
      space: { id: '12345', name: 'Engineering' },
    },
    {},
  );
  assert.equal(explicit.eventType, 'space.update');
  assert.equal(explicit.objectType, 'space');
  assert.equal(explicit.objectId, '12345');
});

test('validateConfluenceWebhookSignature accepts the expected HMAC and rejects invalid signatures', () => {
  const rawPayload = JSON.stringify(pagePayload);
  const secret = 'confluence-secret';
  const signature = createHmac('sha256', secret).update(rawPayload).digest('hex');

  const valid = validateConfluenceWebhookSignature(
    rawPayload,
    { [CONFLUENCE_SIGNATURE_HEADER]: signature },
    secret,
  );
  assert.equal(valid.ok, true);

  const invalid = validateConfluenceWebhookSignature(
    rawPayload,
    { [CONFLUENCE_SIGNATURE_HEADER]: 'deadbeef' },
    secret,
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-signature');

  assert.doesNotThrow(() =>
    assertValidConfluenceWebhookSignature(
      rawPayload,
      { [CONFLUENCE_SIGNATURE_HEADER]: signature },
      secret,
    ),
  );
});

test('validateConfluenceWebhookTimestamp enforces freshness', () => {
  const fresh = validateConfluenceWebhookTimestamp(pagePayload, 60_000, 1_743_155_230_000);
  assert.equal(fresh.ok, true);

  const stale = validateConfluenceWebhookTimestamp(pagePayload, 60_000, 1_743_155_400_001);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');
});
