import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertValidRampWebhookSignature,
  computeRampWebhookSignature,
  normalizeRampWebhook,
  validateRampWebhookSignature,
} from './webhook-normalizer.js';

test('Ramp webhook normalization separates event ids from object ids', () => {
  const payload = {
    id: 'evt_123',
    type: 'transactions.authorized',
    created_at: '2026-08-27T15:00:00.000Z',
    business_id: 'biz_123',
    object: { id: 'txn_123' },
  };

  const normalized = normalizeRampWebhook(payload, {
    'x-hookdeck-eventid': 'hd_123',
    'x-ramp-signature': 'sha256=abc',
  });

  assert.deepEqual(normalized, {
    provider: 'ramp',
    eventType: 'transactions.authorized',
    objectType: 'transaction',
    objectId: 'txn_123',
    eventId: 'evt_123',
    payload,
    businessId: 'biz_123',
    deliveryId: 'hd_123',
    signature: 'sha256=abc',
    lookupPath: '/ramp/transactions/by-id/txn_123.json',
  });
});

test('payments.updated refreshes the owning bill path rather than inventing a payments tree', () => {
  const normalized = normalizeRampWebhook({
    id: 'evt_pay_1',
    type: 'payments.updated',
    created_at: '2026-08-27T15:00:00.000Z',
    business_id: 'biz_123',
    object: { id: 'bill_123' },
  });

  assert.equal(normalized.objectType, 'bill');
  assert.equal(normalized.lookupPath, '/ramp/bills/by-id/bill_123.json');
});

test('transport events remain processable without pretending the event id is a resource id', () => {
  const normalized = normalizeRampWebhook({
    id: 'evt_verify_1',
    type: 'webhooks.verification',
    created_at: '2026-08-27T15:00:00.000Z',
    business_id: 'biz_123',
    challenge: 'ramp_challenge_123',
    object: {},
  });

  assert.equal(normalized.isTransportEvent, true);
  assert.equal(normalized.objectType, 'webhook');
  assert.equal(normalized.objectId, 'evt_verify_1');
  assert.equal(normalized.lookupPath, undefined);
});

test('Ramp webhook signatures verify against raw bytes', () => {
  const secret = 'ramp-secret';
  const raw = Buffer.from(
    JSON.stringify({
      id: 'evt_123',
      type: 'transactions.cleared',
      created_at: '2026-08-27T15:00:00.000Z',
      business_id: 'biz_123',
      object: { id: 'txn_123' },
    }),
    'utf8',
  );
  const signature = computeRampWebhookSignature(raw, secret);

  assert.deepEqual(
    validateRampWebhookSignature(raw, { 'x-ramp-signature': signature }, secret),
    {
      ok: true,
      expectedSignature: signature,
      receivedSignature: signature,
    },
  );
  assert.equal(
    validateRampWebhookSignature(raw, { 'x-ramp-signature': signature }, 'wrong-secret').ok,
    false,
  );
  assert.throws(
    () => assertValidRampWebhookSignature(Buffer.from(`${raw.toString('utf8')} `), { 'x-ramp-signature': signature }, secret),
    /Invalid Ramp webhook signature/u,
  );
});
