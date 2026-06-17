import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { syncRecordBucketing } from '../src/sync-bucketing.js';

describe('gitlab sync record bucketing', () => {
  it('preserves tombstone scope for titled records and tags', () => {
    assert.deepEqual(
      syncRecordBucketing.bucketRecords(
        [
          {
            id: '1',
            iid: 7,
            project_path: 'org/repo',
            title: 'Fix',
            _nango_metadata: { last_action: 'deleted' },
          },
        ],
        'GitLabMergeRequest',
      ),
      {
        mergeRequests: [
          {
            iid: '7',
            _deleted: true,
            project_path: 'org/repo',
            title: 'Fix',
          },
        ],
      },
    );

    assert.deepEqual(
      syncRecordBucketing.bucketRecords(
        [
          {
            id: 'refs/tags/v1',
            ref: 'refs/tags/v1',
            project_path: 'org/repo',
            _nango_metadata: { last_action: 'deleted' },
          },
        ],
        'GitLabTag',
      ),
      {
        tags: [
          {
            ref: 'refs/tags/v1',
            _deleted: true,
            project_path: 'org/repo',
          },
        ],
      },
    );
  });
});
