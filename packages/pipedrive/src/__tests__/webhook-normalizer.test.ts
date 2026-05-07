import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  PIPEDRIVE_AUTHORIZATION_HEADER,
  PIPEDRIVE_TIMESTAMP_HEADER,
  assertValidPipedriveWebhookBasicAuth,
  computePipedriveBasicAuthorization,
  computePipedriveBodyDigest,
  normalizePipedriveWebhook,
  validatePipedriveWebhookBasicAuth,
  validatePipedriveWebhookTimestamp,
  type PipedriveAdapterConfig,
} from '../index.js';

const credentials = {
  username: 'relayfile',
  password: 'pipedrive-secret',
};

const config: PipedriveAdapterConfig = {
  webhookBasicAuth: credentials,
};

const dealPayload = {
  action: 'updated',
  object: 'deal',
  current: {
    id: 101,
    title: 'Enterprise renewal',
    value: 12500,
    person_id: { id: 201, name: 'Ada Lovelace' },
    org_id: { id: 301, name: 'Acme Corp' },
  },
  previous: {
    value: 10000,
  },
  timestamp: 1_743_155_200_000,
};

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    [PIPEDRIVE_AUTHORIZATION_HEADER]: computePipedriveBasicAuthorization(credentials),
    ...extra,
  };
}

test('normalizePipedriveWebhook extracts normalized event and connection metadata', () => {
  const normalized = normalizePipedriveWebhook(JSON.stringify(dealPayload), authHeaders({
    'X-Relay-Connection-Id': 'conn_pipedrive_123',
    'X-Relay-Provider-Config-Key': 'pipedrive-primary',
    'X-Request-Id': 'req_123',
  }), config);

  assert.equal(normalized.provider, 'pipedrive');
  assert.equal(normalized.connectionId, 'conn_pipedrive_123');
  assert.equal(normalized.eventType, 'deal.updated');
  assert.equal(normalized.objectType, 'deal');
  assert.equal(normalized.objectId, '101');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_pipedrive_123',
    provider: 'pipedrive',
    providerConfigKey: 'pipedrive-primary',
    requestId: 'req_123',
  });
  assert.deepEqual(normalized.payload._webhook, {
    action: 'updated',
    eventType: 'deal.updated',
    objectId: '101',
    objectType: 'deal',
    previousData: {
      value: 10000,
    },
    webhookTimestamp: 1_743_155_200_000,
  });
});

test('known-good Basic Auth accept case uses timing-safe comparison and stable HMAC body digest', () => {
  const rawPayload = JSON.stringify(dealPayload);
  const result = validatePipedriveWebhookBasicAuth(authHeaders(), credentials);

  assert.equal(result.ok, true);
  assert.doesNotThrow(() => assertValidPipedriveWebhookBasicAuth(authHeaders(), credentials));
  assert.equal(
    computePipedriveBodyDigest(rawPayload, 'test-digest'),
    createHmac('sha256', 'test-digest').update(rawPayload).digest('hex'),
  );
});

test('tampered body reject case fails normalization even with valid Basic Auth', () => {
  const tamperedPayload = JSON.stringify({
    ...dealPayload,
    current: {
      title: 'Enterprise renewal',
    },
  });

  assert.throws(
    () => normalizePipedriveWebhook(tamperedPayload, authHeaders(), config),
    /object identifier/,
  );
});

test('validatePipedriveWebhookBasicAuth rejects missing Authorization header', () => {
  const result = validatePipedriveWebhookBasicAuth({}, credentials);

  assert.deepEqual(result, {
    ok: false,
    reason: 'missing-authorization',
    expectedAuthorization: computePipedriveBasicAuthorization(credentials),
  });
  assert.throws(
    () => assertValidPipedriveWebhookBasicAuth({}, credentials),
    /missing-authorization/,
  );
});

test('validatePipedriveWebhookTimestamp rejects expired timestamps', () => {
  const fresh = validatePipedriveWebhookTimestamp(
    dealPayload,
    authHeaders({ [PIPEDRIVE_TIMESTAMP_HEADER]: '1743155200000' }),
    60_000,
    1_743_155_230_000,
  );
  assert.equal(fresh.ok, true);

  const stale = validatePipedriveWebhookTimestamp(
    dealPayload,
    authHeaders({ [PIPEDRIVE_TIMESTAMP_HEADER]: '1743155200000' }),
    60_000,
    1_743_155_400_001,
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');
});
