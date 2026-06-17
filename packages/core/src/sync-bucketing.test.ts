import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isDeletedSyncRecord,
  mapToBucket,
  modelBucket,
  normalizeModelKey,
} from './sync-bucketing.js';

describe('sync-bucketing helpers', () => {
  it('normalizes model keys consistently', () => {
    assert.equal(normalizeModelKey(' LinearIssue '), 'linearissue');
  });

  it('maps deleted Nango envelopes to adapter tombstones', () => {
    const records = mapToBucket(
      [
        {
          id: 'one',
          _nango_metadata: {
            last_action: 'deleted',
            deleted_at: '2026-06-17T00:00:00.000Z',
          },
        },
      ],
      (id) => ({ id, _deleted: true, objectType: 'example' }),
    );

    assert.deepEqual(records, [{ id: 'one', _deleted: true, objectType: 'example' }]);
    assert.equal(isDeletedSyncRecord(records[0]), false);
  });

  it('builds a model-to-bucket mapper', () => {
    const bucketing = modelBucket({
      normalizeModel: (model) => (normalizeModelKey(model) === 'thing' ? 'thing' : null),
      buckets: { thing: 'things' },
    });

    assert.deepEqual(bucketing.bucketRecords([{ id: 't1' }], 'Thing'), {
      things: [{ id: 't1' }],
    });
    assert.deepEqual(bucketing.bucketRecords([{ id: 't1' }], 'Other'), {});
  });
});
