import assert from 'node:assert/strict';
import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  SENDGRID_SIGNATURE_HEADER,
  SENDGRID_TIMESTAMP_HEADER,
  assertValidSendGridWebhookSignature,
  computeSendGridWebhookBodyHmac,
  normalizeSendGridWebhook,
  validateSendGridWebhookSignature,
  validateSendGridWebhookTimestamp,
} from '../index.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});

const publicKeyPem = publicKey.export({
  format: 'pem',
  type: 'spki',
});

const timestamp = '1774000000';
const rawPayload = JSON.stringify([
  {
    email: 'customer@example.com',
    event: 'delivered',
    sg_event_id: 'evt_123',
    sg_message_id: 'msg_123',
    timestamp: 1_774_000_000,
  },
]);

function signPayload(body: string, headerTimestamp = timestamp): string {
  return createSign('SHA256')
    .update(Buffer.concat([Buffer.from(headerTimestamp, 'utf8'), Buffer.from(body, 'utf8')]))
    .sign(privateKey)
    .toString('base64');
}

test('validateSendGridWebhookSignature accepts a known-good ECDSA signature', () => {
  const signature = signPayload(rawPayload);
  const headers = {
    [SENDGRID_SIGNATURE_HEADER]: signature,
    [SENDGRID_TIMESTAMP_HEADER]: timestamp,
    'X-Relay-Connection-Id': 'conn_sendgrid_123',
  };

  const result = validateSendGridWebhookSignature(rawPayload, headers, publicKeyPem);
  assert.equal(result.ok, true);
  assert.doesNotThrow(() => assertValidSendGridWebhookSignature(rawPayload, headers, publicKeyPem));

  const normalized = normalizeSendGridWebhook(rawPayload, headers);
  assert.equal(normalized.provider, 'sendgrid');
  assert.equal(normalized.connectionId, 'conn_sendgrid_123');
  assert.equal(normalized.eventType, 'event.delivered');
  assert.equal(normalized.objectType, 'event');
  assert.equal(normalized.objectId, 'evt_123');
});

test('computeSendGridWebhookBodyHmac matches a known-good HMAC fingerprint', () => {
  const secret = 'sendgrid-fingerprint-secret';
  const expected = createHmac('sha256', secret).update(rawPayload).digest('hex');

  assert.equal(computeSendGridWebhookBodyHmac(rawPayload, secret), expected);
});

test('validateSendGridWebhookSignature rejects a tampered body', () => {
  const signature = signPayload(rawPayload);
  const tamperedBody = rawPayload.replace('delivered', 'bounce');

  const result = validateSendGridWebhookSignature(tamperedBody, {
    [SENDGRID_SIGNATURE_HEADER]: signature,
    [SENDGRID_TIMESTAMP_HEADER]: timestamp,
  }, publicKeyPem);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-signature');
});

test('validateSendGridWebhookSignature rejects missing signature headers', () => {
  const result = validateSendGridWebhookSignature(rawPayload, {
    [SENDGRID_TIMESTAMP_HEADER]: timestamp,
  }, publicKeyPem);

  assert.deepEqual(result, { ok: false, reason: 'missing-signature' });
});

test('validateSendGridWebhookTimestamp rejects expired timestamps', () => {
  const result = validateSendGridWebhookTimestamp({
    [SENDGRID_TIMESTAMP_HEADER]: timestamp,
  }, 300_000, 1_774_301_000_000);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale-timestamp');
  assert.equal(result.webhookTimestamp, 1_774_000_000_000);
});
