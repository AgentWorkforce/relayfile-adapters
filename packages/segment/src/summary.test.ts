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

test('buildSummary derives Segment event title and type status', () => {
  const summary = buildSummary({
    type: 'track',
    event: 'Order Completed',
    properties: {
      orderId: 'ord_123',
    },
  });

  assert.deepEqual(summary, {
    title: 'Order Completed',
    status: 'track',
  });
  assertSummaryWithinBudget(summary);
});
