import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  ASANA_HOOK_SECRET_HEADER,
  ASANA_HOOK_SIGNATURE_HEADER,
  ASANA_HOOK_TIMESTAMP_HEADER,
  assertValidAsanaWebhookSignature,
  handleAsanaWebhookHandshake,
  normalizeAsanaWebhook,
  validateAsanaWebhookSignature,
  validateAsanaWebhookTimestamp,
} from '../index.js';

const payload = {
  events: [
    {
      action: 'changed',
      created_at: '2026-05-01T10:00:00.000Z',
      resource: {
        gid: '12001',
        name: 'Ship Asana adapter',
        resource_type: 'task',
      },
      parent: {
        gid: 'project_1',
        name: 'Adapters',
        resource_type: 'project',
      },
      user: {
        gid: 'user_1',
        name: 'Ada',
        resource_type: 'user',
      },
    },
  ],
};

test('handshake echoes X-Hook-Secret for Asana webhook activation', () => {
  const handshake = handleAsanaWebhookHandshake({
    [ASANA_HOOK_SECRET_HEADER]: 'stored-secret',
  });

  assert.deepEqual(handshake, {
    kind: 'handshake',
    responseHeaders: {
      'X-Hook-Secret': 'stored-secret',
    },
    secret: 'stored-secret',
  });
});

test('accepts known-good HMAC signature and normalizes Asana webhook payload', () => {
  const rawPayload = JSON.stringify(payload);
  const secret = 'stored-secret';
  const signature = createHmac('sha256', secret).update(rawPayload).digest('hex');

  const validation = validateAsanaWebhookSignature(rawPayload, {
    [ASANA_HOOK_SIGNATURE_HEADER]: signature,
    [ASANA_HOOK_TIMESTAMP_HEADER]: '1777639200000',
    'X-Relay-Connection-Id': 'conn_asana_1',
  }, secret);
  assert.equal(validation.ok, true);

  const normalized = normalizeAsanaWebhook(rawPayload, {
    [ASANA_HOOK_SIGNATURE_HEADER]: signature,
    [ASANA_HOOK_TIMESTAMP_HEADER]: '1777639200000',
    'X-Relay-Connection-Id': 'conn_asana_1',
    'X-Relay-Provider-Config-Key': 'asana-primary',
  }, {
    nowMs: 1_777_639_200_000,
    webhookSecret: secret,
  });

  assert.equal(normalized.provider, 'asana');
  assert.equal(normalized.connectionId, 'conn_asana_1');
  assert.equal(normalized.eventType, 'task.changed');
  assert.equal(normalized.objectType, 'task');
  assert.equal(normalized.objectId, '12001');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_asana_1',
    provider: 'asana',
    providerConfigKey: 'asana-primary',
  });
});

test('rejects tampered body with invalid-signature result and throwing helper', () => {
  const rawPayload = JSON.stringify(payload);
  const tamperedPayload = JSON.stringify({
    events: [
      {
        action: 'changed',
        resource: {
          gid: '12001',
          name: 'Tampered',
          resource_type: 'task',
        },
      },
    ],
  });
  const secret = 'stored-secret';
  const signature = createHmac('sha256', secret).update(rawPayload).digest('hex');

  const invalid = validateAsanaWebhookSignature(tamperedPayload, {
    [ASANA_HOOK_SIGNATURE_HEADER]: signature,
  }, secret);

  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-signature');
  assert.throws(
    () => assertValidAsanaWebhookSignature(tamperedPayload, { [ASANA_HOOK_SIGNATURE_HEADER]: signature }, secret),
    /invalid-signature/,
  );
});

test('rejects missing signature header', () => {
  const rawPayload = JSON.stringify(payload);
  const missing = validateAsanaWebhookSignature(rawPayload, {}, 'stored-secret');

  assert.deepEqual(missing, {
    ok: false,
    reason: 'missing-signature',
  });
});

test('rejects expired timestamp when timestamp freshness is required', () => {
  const stale = validateAsanaWebhookTimestamp({
    [ASANA_HOOK_TIMESTAMP_HEADER]: '1777639200000',
  }, 60_000, 1_777_640_000_001, true);

  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');
});
