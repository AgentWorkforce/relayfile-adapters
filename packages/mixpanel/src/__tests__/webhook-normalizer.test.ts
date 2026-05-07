import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  MIXPANEL_AUTHORIZATION_HEADER,
  assertValidMixpanelWebhookAuthorization,
  computeMixpanelPayloadFingerprint,
  expectedMixpanelAuthorization,
  normalizeMixpanelWebhook,
  validateMixpanelWebhookAuthorization,
  validateMixpanelWebhookTimestamp,
  type MixpanelAdapterConfig,
} from '../index.js';

const config: MixpanelAdapterConfig = {
  webhookPass: 'pass',
  webhookTimestampToleranceMs: 60_000,
  webhookUser: 'user',
};

const eventPayload = {
  action: 'create',
  projectId: 'project_123',
  timestamp: 1_743_155_200_000,
  type: 'event',
  data: {
    event: 'Signed Up',
    properties: {
      $insert_id: 'evt_123',
      distinct_id: 'user_123',
      time: 1_743_155_200,
    },
  },
};

function authHeader(): string {
  return expectedMixpanelAuthorization(config);
}

test('normalizeMixpanelWebhook accepts valid Basic auth and normalizes event metadata', () => {
  const normalized = normalizeMixpanelWebhook(
    JSON.stringify(eventPayload),
    {
      [MIXPANEL_AUTHORIZATION_HEADER]: authHeader(),
      'X-Relay-Connection-Id': 'conn_mixpanel_123',
      'X-Relay-Provider-Config-Key': 'mixpanel-primary',
      'X-Request-Id': 'req_123',
    },
    config,
    { now: 1_743_155_230_000 },
  );

  assert.equal(normalized.provider, 'mixpanel');
  assert.equal(normalized.connectionId, 'conn_mixpanel_123');
  assert.equal(normalized.eventType, 'event.create');
  assert.equal(normalized.objectType, 'event');
  assert.equal(normalized.objectId, 'evt_123');
  assert.equal(normalized.payload.event, 'Signed Up');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_mixpanel_123',
    provider: 'mixpanel',
    providerConfigKey: 'mixpanel-primary',
    requestId: 'req_123',
  });
});

test('validateMixpanelWebhookAuthorization rejects missing and invalid authorization headers', () => {
  const missing = validateMixpanelWebhookAuthorization({}, config);
  assert.deepEqual(missing, { ok: false, reason: 'missing-authorization' });

  const invalid = validateMixpanelWebhookAuthorization({
    [MIXPANEL_AUTHORIZATION_HEADER]: 'Basic definitely-wrong',
  }, config);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-authorization');

  assert.throws(
    () => assertValidMixpanelWebhookAuthorization({}, config),
    /missing-authorization/,
  );
});

test('normalizeMixpanelWebhook rejects a tampered body that no longer contains an object id', () => {
  const tamperedPayload = {
    ...eventPayload,
    data: {
      properties: {
        mp_lib: 'tampered',
      },
    },
  };

  assert.throws(
    () =>
      normalizeMixpanelWebhook(
        tamperedPayload,
        { [MIXPANEL_AUTHORIZATION_HEADER]: authHeader() },
        config,
        { now: 1_743_155_230_000 },
      ),
    /object identifier/,
  );
});

test('validateMixpanelWebhookTimestamp rejects expired timestamps', () => {
  const fresh = validateMixpanelWebhookTimestamp(
    eventPayload,
    { [MIXPANEL_AUTHORIZATION_HEADER]: authHeader() },
    config,
    1_743_155_230_000,
  );
  assert.equal(fresh.ok, true);

  const stale = validateMixpanelWebhookTimestamp(
    eventPayload,
    { [MIXPANEL_AUTHORIZATION_HEADER]: authHeader() },
    config,
    1_743_155_400_001,
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');
});

test('computeMixpanelPayloadFingerprint uses node crypto HMAC as an audit fingerprint, not auth', () => {
  const rawPayload = JSON.stringify(eventPayload);
  const secret = 'fingerprint-secret';
  const expected = createHmac('sha256', secret).update(rawPayload).digest('hex');

  assert.equal(computeMixpanelPayloadFingerprint(rawPayload, secret), expected);
});
