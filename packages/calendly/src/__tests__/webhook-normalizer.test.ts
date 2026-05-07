import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  CALENDLY_SIGNATURE_HEADER,
  assertValidCalendlyWebhookSignature,
  normalizeCalendlyWebhook,
  parseCalendlySignatureHeader,
  validateCalendlyWebhookSignature,
} from '../index.js';

const webhookPayload = {
  event: 'invitee.created',
  created_at: '2026-04-10T10:00:00.000Z',
  payload: {
    uri: 'https://api.calendly.com/scheduled_events/event_123/invitees/invitee_123',
    email: 'grace@example.com',
    name: 'Grace Hopper',
    event: 'https://api.calendly.com/scheduled_events/event_123',
  },
};

function signedHeaders(body: string, secret: string, timestamp: number): Record<string, string> {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return {
    [CALENDLY_SIGNATURE_HEADER]: `t=${timestamp},v1=${signature}`,
  };
}

test('validateCalendlyWebhookSignature accepts a known-good HMAC and normalizeCalendlyWebhook returns metadata', () => {
  const body = JSON.stringify(webhookPayload);
  const secret = 'calendly-signing-secret';
  const timestamp = 1_776_000_000;
  const headers = {
    ...signedHeaders(body, secret, timestamp),
    'X-Relay-Connection-Id': 'conn_calendly_123',
    'X-Relay-Provider-Config-Key': 'calendly-primary',
  };

  const result = validateCalendlyWebhookSignature(body, headers, secret, {
    nowMs: timestamp * 1000 + 60_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.timestamp, timestamp);

  const normalized = normalizeCalendlyWebhook(body, headers, {
    nowMs: timestamp * 1000 + 60_000,
    webhookSecret: secret,
  });
  assert.equal(normalized.provider, 'calendly');
  assert.equal(normalized.connectionId, 'conn_calendly_123');
  assert.equal(normalized.eventType, 'invitee.created');
  assert.equal(normalized.objectType, 'invitee');
  assert.equal(normalized.objectId, 'invitee_123');
  assert.equal(normalized.payload._connection && typeof normalized.payload._connection === 'object', true);
});

test('validateCalendlyWebhookSignature rejects a tampered body with the same signature header', () => {
  const body = JSON.stringify(webhookPayload);
  const tamperedBody = JSON.stringify({
    ...webhookPayload,
    payload: {
      ...webhookPayload.payload,
      email: 'attacker@example.com',
    },
  });
  const secret = 'calendly-signing-secret';
  const timestamp = 1_776_000_000;
  const headers = signedHeaders(body, secret, timestamp);

  const result = validateCalendlyWebhookSignature(tamperedBody, headers, secret, {
    nowMs: timestamp * 1000 + 60_000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-signature');
  assert.throws(
    () =>
      assertValidCalendlyWebhookSignature(tamperedBody, headers, secret, {
        nowMs: timestamp * 1000 + 60_000,
      }),
    /invalid-signature/,
  );
});

test('validateCalendlyWebhookSignature rejects missing signature headers', () => {
  const body = JSON.stringify(webhookPayload);
  const result = validateCalendlyWebhookSignature(body, {}, 'calendly-signing-secret');

  assert.deepEqual(result, {
    ok: false,
    reason: 'missing-signature',
  });
});

test('validateCalendlyWebhookSignature rejects expired timestamps older than three minutes', () => {
  const body = JSON.stringify(webhookPayload);
  const secret = 'calendly-signing-secret';
  const timestamp = 1_776_000_000;
  const headers = signedHeaders(body, secret, timestamp);

  const result = validateCalendlyWebhookSignature(body, headers, secret, {
    nowMs: timestamp * 1000 + 181_000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired-timestamp');
});

test('parseCalendlySignatureHeader rejects malformed signatures', () => {
  assert.equal(parseCalendlySignatureHeader('v1=abc'), undefined);
  assert.equal(parseCalendlySignatureHeader('t=not-a-number,v1=abc'), undefined);

  const result = validateCalendlyWebhookSignature(JSON.stringify(webhookPayload), {
    [CALENDLY_SIGNATURE_HEADER]: 't=1776000000,v1=not-hex',
  }, 'calendly-signing-secret', {
    nowMs: 1_776_000_000_000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'malformed-signature');
});
