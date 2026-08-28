import assert from 'node:assert/strict';
import test from 'node:test';

import { syncRecordBucketing } from './sync-bucketing.js';

test('Ramp sync bucketing maps models into the expected buckets', () => {
  assert.deepEqual(
    syncRecordBucketing.bucketRecords([{ id: 'bill-1' }], 'RampBill'),
    { bills: [{ id: 'bill-1' }] },
  );
  assert.deepEqual(
    syncRecordBucketing.bucketRecords([{ id: 'txn-1' }], 'transaction'),
    { transactions: [{ id: 'txn-1' }] },
  );
  assert.deepEqual(
    syncRecordBucketing.bucketRecords([{ id: 'user-1' }], 'RampUser'),
    { dimensionUsers: [{ id: 'user-1' }] },
  );
});

test('Ramp sync bucketing emits tombstones for deleted sync records', () => {
  assert.deepEqual(
    syncRecordBucketing.bucketRecords(
      [{ id: 'vendor-1', _nango_metadata: { last_action: 'deleted' } }],
      'RampVendor',
    ),
    { vendors: [{ id: 'vendor-1', _deleted: true }] },
  );
});
