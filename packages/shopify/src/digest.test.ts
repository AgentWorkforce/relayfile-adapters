import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Shopify bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'shopify',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter: Parameters<DigestContext['changeEvents']>[0]) {
      assert.deepEqual(filter, { providers: ['shopify'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'fulfilled',
          canonicalPath: '/shopify/orders/summer-sale--1001.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'product.create',
          canonicalPath: 'shopify/products/blue-widget--2001.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'shopify',
    bullets: [
      {
        text: 'product blue-widget was created',
        canonicalPath: 'shopify/products/blue-widget--2001.json',
      },
      {
        text: 'order summer-sale was fulfilled',
        canonicalPath: 'shopify/orders/summer-sale--1001.json',
      },
    ],
  });
});

test('digest classifies fulfilled, canceled, paid, and deleted Shopify actions', async () => {
  const ctx: DigestContext = {
    provider: 'shopify',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'orders/fulfilled',
          canonicalPath: 'shopify/orders/order-a--100.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'orders/cancelled',
          canonicalPath: 'shopify/orders/order-b--101.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'orders/paid',
          canonicalPath: 'shopify/orders/order-c--102.json',
        },
        {
          id: 'evt-4',
          timestamp: '2026-05-12T11:00:00.000Z',
          action: 'products/deleted',
          canonicalPath: 'shopify/products/old-product--200.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'shopify',
    bullets: [
      {
        text: 'order order-a was fulfilled',
        canonicalPath: 'shopify/orders/order-a--100.json',
      },
      {
        text: 'order order-b was canceled',
        canonicalPath: 'shopify/orders/order-b--101.json',
      },
      {
        text: 'order order-c was paid',
        canonicalPath: 'shopify/orders/order-c--102.json',
      },
      {
        text: 'product old-product was deleted',
        canonicalPath: 'shopify/products/old-product--200.json',
      },
    ],
  });
});

test('digest identifies customers and fulfillments by resource path', async () => {
  const ctx: DigestContext = {
    provider: 'shopify',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'shopify/customers/jane-doe--3001.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: 'shopify/fulfillments/ship-1--4001.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'shopify',
    bullets: [
      {
        text: 'customer jane-doe was created',
        canonicalPath: 'shopify/customers/jane-doe--3001.json',
      },
      {
        text: 'fulfillment ship-1 was updated',
        canonicalPath: 'shopify/fulfillments/ship-1--4001.json',
      },
    ],
  });
});

test('digest returns null for an empty Shopify event window', async () => {
  const ctx: DigestContext = {
    provider: 'shopify',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
