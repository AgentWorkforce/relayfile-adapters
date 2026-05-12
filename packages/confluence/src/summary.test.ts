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

test('buildSummary derives Confluence title, status, actor, labels, and changed fields', () => {
  const summary = buildSummary({
    content: {
      title: 'Runbook update',
      type: 'page',
      status: 'current',
      space: { key: 'OPS' },
      metadata: {
        labels: {
          results: [{ name: 'runbook' }, { name: 'support' }],
        },
      },
      version: {
        by: {
          accountId: 'usr_conf_1',
          displayName: 'Ada Lovelace',
        },
      },
    },
    changes: {
      body: true,
      title: true,
    },
  });

  assert.deepEqual(summary, {
    title: 'Runbook update',
    status: 'current',
    labels: ['runbook', 'support'],
    actor: {
      id: 'usr_conf_1',
      displayName: 'Ada Lovelace',
    },
    fieldsChanged: ['body', 'title'],
    tags: ['space:OPS', 'type:page'],
  });
  assertSummaryWithinBudget(summary);
});

