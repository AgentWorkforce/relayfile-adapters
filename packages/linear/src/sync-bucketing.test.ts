import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { syncRecordBucketing } from './sync-bucketing.js';

describe('linear sync record bucketing', () => {
  it('routes Nango models to emitter bucket names', () => {
    assert.deepEqual(syncRecordBucketing.bucketRecords([{ id: 'L1' }], 'LinearLabel'), {
      labels: [{ id: 'L1' }],
    });
    assert.deepEqual(syncRecordBucketing.bucketRecords([{ id: 'P1' }], 'LinearProject'), {
      projects: [{ id: 'P1' }],
    });
  });

  it('normalizes issue state_name for auxiliary emission', () => {
    assert.deepEqual(
      syncRecordBucketing.bucketRecords(
        [{ id: 'I1', state_name: 'Todo', title: 'Issue' }],
        'LinearIssue',
      ),
      {
        issues: [{ id: 'I1', state_name: 'Todo', title: 'Issue', state: { name: 'Todo' } }],
      },
    );
  });
});
