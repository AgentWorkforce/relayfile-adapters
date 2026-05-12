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

test('buildSummary derives Zendesk changed fields from ticket comments when no top-level changes block is present', () => {
  const summary = buildSummary({
    ticket: {
      subject: 'Customer cannot complete checkout',
      status: 'open',
      priority: 'high',
      comments: [
        {
          id: 1,
          body: 'Updated ticket status',
        },
      ],
    },
  });

  assert.deepEqual(summary, {
    title: 'Customer cannot complete checkout',
    status: 'open',
    priority: 'high',
    fieldsChanged: ['comments'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary redacts Zendesk subject PII and detects comment diffs against previous ticket state', () => {
  const summary = buildSummary({
    current_user: {
      id: 123,
      name: 'ops@example.com',
    },
    ticket: {
      subject: 'Customer jane@example.com called +1 (555) 123-4567 about checkout',
      status: 'open',
      priority: 'high',
      group_id: 55,
      brand_id: 'brand_1',
      tags: ['auth', 'urgent'],
      comments: [
        { id: 1, body: 'Initial request' },
        { id: 2, body: 'Investigating' },
      ],
    },
    previous: {
      comments: [
        { id: 1, body: 'Initial request' },
      ],
    },
    audit: {
      changes: [
        { field_name: 'status' },
      ],
    },
  });

  assert.deepEqual(summary, {
    title: 'Customer [redacted-email] called [redacted-number] about checkout',
    status: 'open',
    priority: 'high',
    labels: ['auth', 'urgent'],
    actor: {
      id: '123',
    },
    fieldsChanged: ['status', 'comments'],
    tags: ['group:55', 'brand:brand_1'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary caps oversized Zendesk summaries under the 1 KB envelope budget', () => {
  const summary = buildSummary({
    current_user: {
      id: 456,
      name: 'Agent Example',
    },
    ticket: {
      subject: `Escalation for jane@example.com ${'critical '.repeat(40)}call +1 555 123 4567`,
      status: 'pending',
      priority: 'urgent',
      tags: Array.from({ length: 30 }, (_, index) => `tag-${index}`),
      comments: [
        { id: 1, body: 'First comment' },
      ],
    },
    changes: Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`field_${index}`, { from: `value-${index}` }]),
    ),
  });

  assert.equal(summary.title?.length, 120);
  assert.equal(summary.title?.endsWith('...'), true);
  assert.equal(summary.labels?.length, 8);
  assert.equal(summary.fieldsChanged?.length, 12);
  assert.match(summary.title ?? '', /\[redacted-email\]|\[redacted-number\]/);
  assertSummaryWithinBudget(summary);
});

test('buildSummary marks Zendesk comments as changed when comments are removed', () => {
  const summary = buildSummary({
    ticket: {
      subject: 'Resolved duplicate comment thread',
      status: 'solved',
      priority: 'normal',
      comments: [],
    },
    previous: {
      comments: [
        { id: 1, body: 'Old internal note' },
      ],
    },
  });

  assert.deepEqual(summary, {
    title: 'Resolved duplicate comment thread',
    status: 'solved',
    priority: 'normal',
    fieldsChanged: ['comments'],
  });
  assertSummaryWithinBudget(summary);
});
