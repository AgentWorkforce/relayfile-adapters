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

test('buildSummary derives compact Mailgun title and status fields', () => {
  const summary = buildSummary({
    'event-data': {
      event: 'delivered',
      severity: 'temporary',
      domain: 'mail.example.com',
      tags: ['outbound'],
    },
  });

  assert.deepEqual(summary, {
    title: 'delivered',
    status: 'temporary',
  });
  assertSummaryWithinBudget(summary);
});
