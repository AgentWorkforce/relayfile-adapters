import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary extracts a readable title, status, and tags from Ramp payloads', () => {
  const summary = buildSummary({
    type: 'bills.paid',
    business_id: 'biz_123',
    object: {
      invoice_number: 'INV-42',
      status: 'PAID',
    },
  });

  assert.deepEqual(summary, {
    title: 'INV-42',
    status: 'PAID',
    tags: ['ramp', 'event:bills.paid', 'business:biz_123'],
  });
});

test('buildSummary falls back across Ramp resource shapes', () => {
  const summary = buildSummary({
    payload: {
      event_type: 'reimbursements.ready_to_sync',
      business_id: 'biz_123',
      object: {
        merchant: 'Airport Taxi',
        sync_status: 'READY_TO_SYNC',
      },
    },
  });

  assert.deepEqual(summary, {
    title: 'Airport Taxi',
    status: 'READY_TO_SYNC',
    tags: ['ramp', 'event:reimbursements.ready_to_sync', 'business:biz_123'],
  });
});
