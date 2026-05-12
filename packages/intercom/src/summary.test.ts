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

test('buildSummary derives Intercom conversation message title and state', () => {
  const summary = buildSummary({
    type: 'notification_event',
    data: {
      item: {
        id: 'conv_123',
        type: 'conversation',
        state: 'open',
        source: {
          body: 'Hello from jane@example.com at +1 (415) 555-1212',
        },
      },
    },
  });

  assert.deepEqual(summary, {
    title: 'Hello from [redacted-email] at [redacted-number]',
    status: 'open',
  });
  assertSummaryWithinBudget(summary);
});
