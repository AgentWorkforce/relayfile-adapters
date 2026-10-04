import assert from 'node:assert/strict';
import test from 'node:test';

import { ReadOnlyFieldError, resolveJiraWritebackRequest } from '../writeback.js';

test('jira project create accepts the required project key', () => {
  assert.deepEqual(
    resolveJiraWritebackRequest(
      '/jira/projects/new-project.json',
      JSON.stringify({ key: 'OPS', name: 'Ops', projectTypeKey: 'software', leadAccountId: 'abc' }),
    ),
    {
      action: 'create_project',
      method: 'POST',
      endpoint: '/rest/api/3/project',
      body: { key: 'OPS', name: 'Ops', projectTypeKey: 'software', leadAccountId: 'abc' },
    },
  );
});

test('jira project create still rejects server-managed fields', () => {
  assert.throws(
    () =>
      resolveJiraWritebackRequest(
        '/jira/projects/new-project.json',
        JSON.stringify({ id: '10000', key: 'OPS', name: 'Ops', projectTypeKey: 'software', leadAccountId: 'abc' }),
      ),
    ReadOnlyFieldError,
  );
});

test('jira project update still treats key as read-only', () => {
  assert.throws(
    () => resolveJiraWritebackRequest('/jira/projects/10000.json', JSON.stringify({ key: 'NEW' })),
    ReadOnlyFieldError,
  );
});
