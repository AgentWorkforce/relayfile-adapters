import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary derives Shopify order title, status, labels, and topic-driven fieldsChanged', () => {
  assert.deepEqual(
    buildSummary({
      topic: 'orders/updated',
      shop_domain: 'example.myshopify.com',
      data: {
        name: '#1001',
        fulfillment_status: 'fulfilled',
        tags: 'vip, wholesale',
      },
    }),
    {
      title: '#1001',
      status: 'fulfilled',
      labels: ['vip', 'wholesale'],
      fieldsChanged: ['orders/updated'],
      tags: ['shop:example.myshopify.com'],
    },
  );
});
