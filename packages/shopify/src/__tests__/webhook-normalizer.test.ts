import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  SHOPIFY_HMAC_HEADER,
  SHOPIFY_TOPIC_HEADER,
  SHOPIFY_TRIGGERED_AT_HEADER,
  assertValidShopifyWebhookSignature,
  computeShopifyWebhookSignature,
  normalizeShopifyWebhook,
  validateShopifyWebhookSignature,
  validateShopifyWebhookTimestamp,
} from '../index.js';

const orderPayload = {
  id: 450789469,
  admin_graphql_api_id: 'gid://shopify/Order/450789469',
  name: '#1001',
  email: 'buyer@example.com',
  total_price: '199.00',
  line_items: [
    { id: 1, product_id: 632910392, title: 'Relay Tee', quantity: 1 },
  ],
};

test('normalizeShopifyWebhook accepts known-good base64 HMAC and builds a normalized order event', () => {
  const rawBody = JSON.stringify(orderPayload);
  const secret = 'shopify-webhook-secret';
  const signature = createHmac('sha256', secret).update(rawBody).digest('base64');

  const normalized = normalizeShopifyWebhook(rawBody, {
    [SHOPIFY_HMAC_HEADER]: signature,
    [SHOPIFY_TOPIC_HEADER]: 'orders/create',
    'X-Shopify-Shop-Domain': 'relayfile-test.myshopify.com',
    'X-Shopify-Webhook-Id': 'webhook_123',
    'X-Relay-Connection-Id': 'conn_shopify_123',
  }, {
    webhookSecret: secret,
  });

  assert.equal(normalized.provider, 'shopify');
  assert.equal(normalized.connectionId, 'conn_shopify_123');
  assert.equal(normalized.eventType, 'order.create');
  assert.equal(normalized.objectType, 'order');
  assert.equal(normalized.objectId, '450789469');
  const webhook = normalized.payload._webhook as Record<string, unknown>;
  assert.equal(webhook.topic, 'orders/create');
  assert.equal(webhook.shopDomain, 'relayfile-test.myshopify.com');
});

test('validateShopifyWebhookSignature rejects a tampered body', () => {
  const rawBody = JSON.stringify(orderPayload);
  const secret = 'shopify-webhook-secret';
  const signature = computeShopifyWebhookSignature(rawBody, secret);
  const tamperedBody = JSON.stringify({ ...orderPayload, total_price: '1.00' });

  const result = validateShopifyWebhookSignature(tamperedBody, {
    [SHOPIFY_HMAC_HEADER]: signature,
  }, secret);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-signature');
  assert.throws(
    () => assertValidShopifyWebhookSignature(tamperedBody, { [SHOPIFY_HMAC_HEADER]: signature }, secret),
    /invalid-signature/,
  );
});

test('validateShopifyWebhookSignature rejects missing and malformed HMAC headers', () => {
  const rawBody = JSON.stringify(orderPayload);
  const secret = 'shopify-webhook-secret';

  assert.deepEqual(validateShopifyWebhookSignature(rawBody, {}, secret), {
    ok: false,
    reason: 'missing-signature',
  });

  assert.deepEqual(validateShopifyWebhookSignature(rawBody, {
    [SHOPIFY_HMAC_HEADER]: 'not base64 ***',
  }, secret), {
    ok: false,
    reason: 'malformed-signature',
    receivedSignature: 'not base64 ***',
  });
});

test('validateShopifyWebhookTimestamp rejects expired triggered-at timestamps when required', () => {
  const stale = validateShopifyWebhookTimestamp({
    [SHOPIFY_TRIGGERED_AT_HEADER]: '2026-03-28T10:00:00.000Z',
  }, 60_000, Date.parse('2026-03-28T10:02:00.001Z'), true);

  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');

  const missing = validateShopifyWebhookTimestamp({}, 60_000, Date.parse('2026-03-28T10:02:00.001Z'), true);
  assert.deepEqual(missing, { ok: false, reason: 'missing-timestamp' });
});

test('normalizeShopifyWebhook rejects expired timestamps through options', () => {
  const rawBody = JSON.stringify(orderPayload);
  const secret = 'shopify-webhook-secret';
  const signature = computeShopifyWebhookSignature(rawBody, secret);

  assert.throws(
    () => normalizeShopifyWebhook(rawBody, {
      [SHOPIFY_HMAC_HEADER]: signature,
      [SHOPIFY_TOPIC_HEADER]: 'orders/create',
      [SHOPIFY_TRIGGERED_AT_HEADER]: '2026-03-28T10:00:00.000Z',
    }, {
      nowMs: Date.parse('2026-03-28T10:06:00.000Z'),
      requireTimestamp: true,
      toleranceMs: 60_000,
      webhookSecret: secret,
    }),
    /stale-timestamp/,
  );
});
