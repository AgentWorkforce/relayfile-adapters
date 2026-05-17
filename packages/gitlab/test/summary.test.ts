import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from '../src/summary.js';

const MAX_SUMMARY_JSON_LENGTH = 1024;

function assertSummaryWithinBudget(summary: unknown): void {
  const serialized = JSON.stringify(summary);
  assert.ok(
    serialized.length < MAX_SUMMARY_JSON_LENGTH,
    `expected summary JSON under ${MAX_SUMMARY_JSON_LENGTH} bytes, got ${serialized.length}`,
  );
}

test('buildSummary derives GitLab title, status, labels, actor, and changed fields', () => {
  const summary = buildSummary({
    object_kind: 'merge_request',
    project: {
      path_with_namespace: 'acme/platform',
    },
    object_attributes: {
      title: 'Ship proactive runtime',
      state: 'opened',
      labels: [{ title: 'platform' }, { title: 'priority::high' }],
      author: {
        id: 'usr_gitlab_1',
        username: 'ada',
      },
    },
    changes: {
      title: { previous: 'Old title', current: 'Ship proactive runtime' },
      assignee_id: { previous: null, current: 1 },
    },
  });

  assert.deepEqual(summary, {
    title: 'Ship proactive runtime',
    status: 'opened',
    labels: ['platform', 'priority::high'],
    actor: {
      id: 'usr_gitlab_1',
      displayName: 'ada',
    },
    fieldsChanged: ['title', 'assignee_id'],
    tags: ['kind:merge_request', 'project:acme/platform'],
  });
  assertSummaryWithinBudget(summary);
});
