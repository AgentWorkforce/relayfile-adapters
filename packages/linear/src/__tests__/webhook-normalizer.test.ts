import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  LINEAR_DELIVERY_HEADER,
  LINEAR_SIGNATURE_HEADER,
  assertValidLinearWebhookSignature,
  normalizeLinearWebhook,
  validateLinearWebhookSignature,
  validateLinearWebhookTimestamp,
} from '../index.ts';

const issuePayload = {
  action: 'create',
  type: 'Issue',
  createdAt: '2026-03-28T10:00:00.000Z',
  organizationId: 'org_123',
  webhookTimestamp: 1_743_155_200_000,
  webhookId: 'webhook_123',
  data: {
    id: 'issue_123',
    identifier: 'ENG-123',
    title: 'Ship webhook normalizer',
  },
};

test('normalizeLinearWebhook extracts normalized event metadata and connection metadata', () => {
  const normalized = normalizeLinearWebhook(issuePayload, {
    [LINEAR_DELIVERY_HEADER]: 'delivery_123',
    'Linear-Event': 'Issue',
    'X-Relay-Connection-Id': 'conn_linear_123',
    'X-Relay-Provider-Config-Key': 'linear',
  });

  assert.equal(normalized.provider, 'linear');
  assert.equal(normalized.connectionId, 'conn_linear_123');
  assert.equal(normalized.eventType, 'issue.create');
  assert.equal(normalized.objectType, 'issue');
  assert.equal(normalized.objectId, 'issue_123');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_linear_123',
    deliveryId: 'delivery_123',
    provider: 'linear',
    providerConfigKey: 'linear',
  });
});

test('validateLinearWebhookSignature accepts the expected HMAC and rejects invalid signatures', () => {
  const rawPayload = JSON.stringify(issuePayload);
  const secret = 'linear-secret';
  const signature = createHmac('sha256', secret).update(rawPayload).digest('hex');

  const valid = validateLinearWebhookSignature(rawPayload, {
    [LINEAR_SIGNATURE_HEADER]: signature,
  }, secret);
  assert.equal(valid.ok, true);

  const invalid = validateLinearWebhookSignature(rawPayload, {
    [LINEAR_SIGNATURE_HEADER]: 'deadbeef',
  }, secret);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-signature');

  assert.doesNotThrow(() =>
    assertValidLinearWebhookSignature(rawPayload, { [LINEAR_SIGNATURE_HEADER]: signature }, secret),
  );
});

test('validateLinearWebhookTimestamp enforces freshness', () => {
  const fresh = validateLinearWebhookTimestamp(issuePayload, 60_000, 1_743_155_230_000);
  assert.equal(fresh.ok, true);

  const stale = validateLinearWebhookTimestamp(issuePayload, 60_000, 1_743_155_400_001);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');
});
