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

test('buildSummary derives Asana task title, status, labels, and changed fields', () => {
  const summary = buildSummary({
    data: {
      name: 'Ship M2 review fixes',
      completed: false,
      tags: [{ name: 'runtime' }, { name: 'urgent' }],
    },
    events: [
      {
        action: 'changed',
        change: {
          action: 'changed',
          field: 'completed',
        },
        user: {
          gid: 'usr_asana_1',
          name: 'Ada Lovelace',
        },
      },
    ],
  });

  assert.deepEqual(summary, {
    title: 'Ship M2 review fixes',
    status: 'open',
    labels: ['runtime', 'urgent'],
    actor: {
      id: 'usr_asana_1',
      displayName: 'Ada Lovelace',
    },
    fieldsChanged: ['completed'],
    tags: ['action:changed'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary derives completed status and redacts Asana free-text PII', () => {
  const summary = buildSummary({
    data: {
      name: 'Follow up with jane@example.com at +1 (555) 123-4567',
      completed: true,
      tags: [{ name: 'customer' }],
    },
    events: [
      {
        action: 'changed',
        resource: {
          resource_type: 'task',
        },
        change: {
          action: {
            added_resource: {
              resource_type: 'story',
            },
          },
        },
        user: {
          gid: 'usr_asana_2',
          name: 'alerts@example.com',
        },
      },
    ],
  });

  assert.deepEqual(summary, {
    title: 'Follow up with [redacted-email] at [redacted-number]',
    status: 'done',
    labels: ['customer'],
    actor: {
      id: 'usr_asana_2',
    },
    fieldsChanged: ['resource:story'],
    tags: ['action:changed', 'resource:task'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary caps oversized Asana summaries under the 1 KB envelope budget', () => {
  const summary = buildSummary({
    data: {
      name: `Follow up ${'urgent '.repeat(40)}with jane@example.com and +1 555 123 4567`,
      completed: false,
      tags: Array.from({ length: 40 }, (_, index) => ({ name: `tag-${index}` })),
    },
    events: Array.from({ length: 20 }, (_, index) => ({
      action: 'changed',
      change: {
        field: `field_${index}`,
      },
      user: {
        gid: 'usr_asana_3',
        name: 'Ada Lovelace',
      },
    })),
  });

  assert.equal(summary.title?.length, 120);
  assert.equal(summary.title?.endsWith('...'), true);
  assert.equal(summary.labels?.length, 8);
  assert.equal(summary.fieldsChanged?.length, 12);
  assertSummaryWithinBudget(summary);
});
