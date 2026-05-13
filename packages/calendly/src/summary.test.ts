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

test('buildSummary derives Calendly event title and status from the webhook payload', () => {
  const summary = buildSummary({
    event: 'invitee.canceled',
    payload: {
      name: 'Demo call with jane@example.com',
      status: 'canceled',
      location: {
        type: 'zoom',
      },
    },
  });

  assert.deepEqual(summary, {
    title: 'Demo call with [redacted-email]',
    status: 'canceled',
  });
  assertSummaryWithinBudget(summary);
});
