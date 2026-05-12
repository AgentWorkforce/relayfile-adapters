import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

const MAX_SUMMARY_JSON_LENGTH = 1024;

function assertSummaryWithinBudget(summary: unknown): void {
  const serialized = JSON.stringify(summary);
  assert.ok(
    serialized.length < MAX_SUMMARY_JSON_LENGTH,
    `expected summary JSON under ${MAX_SUMMARY_JSON_LENGTH} bytes, got ${serialized.length}`,
  );
}

test('buildSummary derives Shopify title, status, tags, and topic-driven fieldsChanged', () => {
  const summary = buildSummary({
    topic: 'orders/updated',
    data: {
      name: '#1001',
      fulfillment_status: 'fulfilled',
      tags: 'vip, jane@example.com',
    },
  });

  assert.deepEqual(summary, {
    title: '#1001',
    status: 'fulfilled',
    tags: ['vip', '[redacted-email]'],
    fieldsChanged: ['orders/updated'],
  });
  assertSummaryWithinBudget(summary);
});
