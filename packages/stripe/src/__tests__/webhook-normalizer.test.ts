import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STRIPE_SIGNATURE_HEADER,
  assertValidStripeWebhookSignature,
  computeStripeWebhookSignature,
  normalizeStripeWebhook,
  validateStripeWebhookSignature,
} from '../index.js';

const secret = 'whsec_test_secret';
const timestamp = 1_778_134_400;

const customerEvent = {
  id: 'evt_123',
  object: 'event',
  api_version: '2025-02-24.acacia',
  created: timestamp,
  data: {
    object: {
      id: 'cus_123',
      object: 'customer',
      email: 'billing@example.com',
      name: 'Example Inc.',
    },
    previous_attributes: {
      email: 'old@example.com',
    },
  },
  livemode: false,
  pending_webhooks: 1,
  request: {
    id: 'req_123',
    idempotency_key: 'idem_123',
  },
  type: 'customer.updated',
};

function signedHeaders(rawPayload: string, signedAt = timestamp): Record<string, string> {
  const signature = computeStripeWebhookSignature(rawPayload, secret, signedAt);
  return {
    [STRIPE_SIGNATURE_HEADER]: `t=${signedAt},v1=${signature}`,
    'X-Relay-Connection-Id': 'conn_stripe_123',
    'X-Relay-Provider-Config-Key': 'stripe-primary',
  };
}

test('normalizeStripeWebhook accepts a known-good HMAC signature and builds a normalized webhook', () => {
  const rawPayload = JSON.stringify(customerEvent);
  const normalized = normalizeStripeWebhook(rawPayload, signedHeaders(rawPayload), {
    now: timestamp,
    webhookSecret: secret,
  });

  assert.equal(normalized.provider, 'stripe');
  assert.equal(normalized.connectionId, 'conn_stripe_123');
  assert.equal(normalized.eventType, 'customer.updated');
  assert.equal(normalized.objectType, 'customer');
  assert.equal(normalized.objectId, 'cus_123');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_stripe_123',
    deliveryId: 'evt_123',
    provider: 'stripe',
    providerConfigKey: 'stripe-primary',
  });
  assert.equal((normalized.payload._stripe_event as Record<string, unknown>).eventId, 'evt_123');
});

test('validateStripeWebhookSignature rejects a tampered body with the original signature', () => {
  const rawPayload = JSON.stringify(customerEvent);
  const tamperedPayload = JSON.stringify({
    ...customerEvent,
    data: {
      object: {
        ...customerEvent.data.object,
        email: 'attacker@example.com',
      },
    },
  });

  const result = validateStripeWebhookSignature(tamperedPayload, signedHeaders(rawPayload), secret, {
    now: timestamp,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-signature');
  assert.throws(
    () => assertValidStripeWebhookSignature(tamperedPayload, signedHeaders(rawPayload), secret, { now: timestamp }),
    /invalid-signature/,
  );
});

test('validateStripeWebhookSignature rejects missing Stripe-Signature headers', () => {
  const rawPayload = JSON.stringify(customerEvent);
  const result = validateStripeWebhookSignature(rawPayload, {}, secret, { now: timestamp });

  assert.deepEqual(result, { ok: false, reason: 'missing-signature' });
  assert.throws(
    () => normalizeStripeWebhook(rawPayload, {}, { now: timestamp, webhookSecret: secret }),
    /missing-signature/,
  );
});

test('validateStripeWebhookSignature rejects expired timestamps beyond five minutes', () => {
  const rawPayload = JSON.stringify(customerEvent);
  const result = validateStripeWebhookSignature(rawPayload, signedHeaders(rawPayload), secret, {
    now: timestamp + 301,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired-timestamp');
  assert.equal(result.timestamp, timestamp);
});

test('validateStripeWebhookSignature rejects malformed signature headers', () => {
  const rawPayload = JSON.stringify(customerEvent);
  const result = validateStripeWebhookSignature(rawPayload, {
    [STRIPE_SIGNATURE_HEADER]: 't=not-a-timestamp,v1=abc',
  }, secret, { now: timestamp });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'malformed-signature');
});
