import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  CLICKUP_DELIVERY_HEADER,
  CLICKUP_SIGNATURE_HEADER,
  CLICKUP_TIMESTAMP_HEADER,
  assertValidClickUpWebhookSignature,
  computeClickUpWebhookSignature,
  normalizeClickUpWebhook,
  validateClickUpWebhookSignature,
  validateClickUpWebhookTimestamp,
} from '../index.js';

const taskPayload = {
  event: 'taskCreated',
  task_id: 'task_123',
  webhook_id: 'webhook_123',
  data: {
    id: 'task_123',
    name: 'Ship webhook normalizer',
  },
};

test('normalizeClickUpWebhook extracts event, object, and connection metadata', () => {
  const normalized = normalizeClickUpWebhook(taskPayload, {
    [CLICKUP_DELIVERY_HEADER]: 'delivery_123',
    'X-Relay-Connection-Id': 'conn_clickup_123',
    'X-Relay-Provider-Config-Key': 'clickup-primary',
    'X-Request-Id': 'req_123',
  });

  assert.equal(normalized.provider, 'clickup');
  assert.equal(normalized.connectionId, 'conn_clickup_123');
  assert.equal(normalized.eventType, 'task.created');
  assert.equal(normalized.objectType, 'task');
  assert.equal(normalized.objectId, 'task_123');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_clickup_123',
    deliveryId: 'delivery_123',
    provider: 'clickup',
    providerConfigKey: 'clickup-primary',
    requestId: 'req_123',
  });
});

test('validateClickUpWebhookSignature accepts a known-good HMAC', () => {
  const rawPayload = JSON.stringify(taskPayload);
  const secret = 'clickup-secret';
  const signature = createHmac('sha256', secret).update(rawPayload).digest('hex');

  assert.equal(signature, computeClickUpWebhookSignature(rawPayload, secret));
  const valid = validateClickUpWebhookSignature(rawPayload, {
    [CLICKUP_SIGNATURE_HEADER]: signature,
  }, secret);

  assert.equal(valid.ok, true);
  assert.equal(valid.expectedSignature, signature);
  assert.doesNotThrow(() =>
    assertValidClickUpWebhookSignature(rawPayload, { [CLICKUP_SIGNATURE_HEADER]: signature }, secret),
  );
});

test('validateClickUpWebhookSignature rejects a tampered raw body', () => {
  const rawPayload = JSON.stringify(taskPayload);
  const tamperedPayload = JSON.stringify({
    ...taskPayload,
    data: { id: 'task_123', name: 'Tampered body' },
  });
  const secret = 'clickup-secret';
  const signature = createHmac('sha256', secret).update(rawPayload).digest('hex');

  const invalid = validateClickUpWebhookSignature(tamperedPayload, {
    [CLICKUP_SIGNATURE_HEADER]: signature,
  }, secret);

  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-signature');
});

test('validateClickUpWebhookSignature rejects missing signatures', () => {
  const rawPayload = JSON.stringify(taskPayload);

  const missing = validateClickUpWebhookSignature(rawPayload, {}, 'clickup-secret');

  assert.deepEqual(missing, { ok: false, reason: 'missing-signature' });
});

test('validateClickUpWebhookTimestamp rejects expired timestamps', () => {
  const stale = validateClickUpWebhookTimestamp(
    taskPayload,
    { [CLICKUP_TIMESTAMP_HEADER]: '1743155200000' },
    60_000,
    1_743_155_400_001,
  );

  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');
});

test('validateClickUpWebhookTimestamp accepts headers passed as entry arrays', () => {
  const fresh = validateClickUpWebhookTimestamp(
    [[CLICKUP_TIMESTAMP_HEADER, '1743155400000']],
    {},
    60_000,
    1_743_155_401_000,
  );

  assert.equal(fresh.ok, true);
  assert.equal(fresh.webhookTimestamp, 1_743_155_400_000);
});
