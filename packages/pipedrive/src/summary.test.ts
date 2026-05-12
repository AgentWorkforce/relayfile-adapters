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

test('buildSummary derives Pipedrive deal title, status, and pipeline tag', () => {
  const summary = buildSummary({
    current: {
      title: 'Enterprise renewal',
      status: 'open',
      pipeline_id: {
        id: 17,
        name: 'Enterprise',
      },
    },
  });

  assert.deepEqual(summary, {
    title: 'Enterprise renewal',
    status: 'open',
    tags: ['pipeline:Enterprise'],
  });
  assertSummaryWithinBudget(summary);
});
