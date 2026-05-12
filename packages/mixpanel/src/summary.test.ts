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

test('buildSummary derives Mixpanel event title with distinct_id stripped', () => {
  const summary = buildSummary({
    type: 'event',
    action: 'create',
    data: {
      event: 'Signed Up user_123',
      properties: {
        distinct_id: 'user_123',
        $insert_id: 'evt_123',
      },
    },
  });

  assert.deepEqual(summary, {
    title: 'Signed Up',
  });
  assertSummaryWithinBudget(summary);
});
