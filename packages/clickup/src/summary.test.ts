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

test('buildSummary derives ClickUp title, status, priority, tags, and history-driven fieldsChanged', () => {
  const summary = buildSummary({
    data: {
      name: 'Triage runtime backlog',
      status: { status: 'in progress' },
      priority: { priority: 'high' },
      tags: [{ name: 'ops' }, { name: 'grace@example.com' }],
    },
    history_items: [
      {
        field: 'status',
      },
    ],
  });

  assert.deepEqual(summary, {
    title: 'Triage runtime backlog',
    status: 'in progress',
    priority: 'high',
    tags: ['ops', '[redacted-email]'],
    fieldsChanged: ['status'],
  });
  assertSummaryWithinBudget(summary);
});
