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

test('buildSummary derives SendGrid event title, subject tags, and sg_event_id fieldsChanged', () => {
  const summary = buildSummary({
    events: [
      {
        event: 'delivered',
        subject: 'Launch plan for jane@example.com',
        sg_event_id: 'evt_123',
      },
    ],
  });

  assert.deepEqual(summary, {
    title: 'delivered',
    tags: ['Launch plan for [redacted-email]'],
    fieldsChanged: ['evt_123'],
  });
  assertSummaryWithinBudget(summary);
});
