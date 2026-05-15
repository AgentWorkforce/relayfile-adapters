import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Stripe bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'stripe',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['stripe'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'charge.succeeded',
          canonicalPath: '/stripe/charges/ch_abc123.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'customer.created',
          canonicalPath: 'stripe/customers/cus_xyz789.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'stripe',
    bullets: [
      {
        text: 'customer cus_xyz789 was created',
        canonicalPath: 'stripe/customers/cus_xyz789.json',
      },
      {
        text: 'charge ch_abc123 succeeded',
        canonicalPath: 'stripe/charges/ch_abc123.json',
      },
    ],
  });
});

test('digest classifies Stripe terminal states: succeeded, failed, refunded, canceled, voided', async () => {
  const ctx: DigestContext = {
    provider: 'stripe',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'payment_intent.succeeded',
          canonicalPath: 'stripe/payment-intents/pi_001.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'charge.failed',
          canonicalPath: 'stripe/charges/ch_002.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'charge.refunded',
          canonicalPath: 'stripe/charges/ch_003.json',
        },
        {
          id: 'evt-4',
          timestamp: '2026-05-12T11:00:00.000Z',
          action: 'subscription.canceled',
          canonicalPath: 'stripe/subscriptions/sub_004.json',
        },
        {
          id: 'evt-5',
          timestamp: '2026-05-12T12:00:00.000Z',
          action: 'invoice.voided',
          canonicalPath: 'stripe/invoices/in_005.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'stripe',
    bullets: [
      {
        text: 'payment intent pi_001 succeeded',
        canonicalPath: 'stripe/payment-intents/pi_001.json',
      },
      {
        text: 'charge ch_002 failed',
        canonicalPath: 'stripe/charges/ch_002.json',
      },
      {
        text: 'charge ch_003 was refunded',
        canonicalPath: 'stripe/charges/ch_003.json',
      },
      {
        text: 'subscription sub_004 was canceled',
        canonicalPath: 'stripe/subscriptions/sub_004.json',
      },
      {
        text: 'invoice in_005 was voided',
        canonicalPath: 'stripe/invoices/in_005.json',
      },
    ],
  });
});

test('digest classifies finalized and paid invoice states', async () => {
  const ctx: DigestContext = {
    provider: 'stripe',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'invoice.finalized',
          canonicalPath: 'stripe/invoices/in_010.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'invoice.paid',
          canonicalPath: 'stripe/invoices/in_011.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'stripe',
    bullets: [
      {
        text: 'invoice in_010 was finalized',
        canonicalPath: 'stripe/invoices/in_010.json',
      },
      {
        text: 'invoice in_011 was paid',
        canonicalPath: 'stripe/invoices/in_011.json',
      },
    ],
  });
});

test('digest returns null for an empty Stripe event window', async () => {
  const ctx: DigestContext = {
    provider: 'stripe',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
