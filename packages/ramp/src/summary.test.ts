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

test('buildSummary redacts free-text title candidates', () => {
  const summary = buildSummary({
    type: 'transactions.authorized',
    business_id: 'biz_123',
    object: {
      merchant_name: 'jane@example.com +1 (555) 555-1234',
      status: 'AUTHORIZED',
    },
  });

  assert.deepEqual(summary, {
    title: '[redacted-email] [redacted-number]',
    status: 'AUTHORIZED',
    tags: ['ramp', 'event:transactions.authorized', 'business:biz_123'],
  });
});

test('buildSummary truncates oversized fields and stays within the summary size budget', () => {
  const summary = buildSummary({
    type: `transactions.${'x'.repeat(200)}`,
    business_id: `biz_${'y'.repeat(200)}`,
    object: {
      merchant_name: `Merchant ${'z'.repeat(200)}`,
      status: `APPROVAL_${'w'.repeat(200)}`,
    },
  });

  assert.ok(summary.title?.endsWith('...'));
  assert.ok(summary.status?.endsWith('...'));
  assert.ok(summary.tags?.some((tag) => tag.startsWith('event:') && tag.endsWith('...')));
  assert.ok(summary.tags?.some((tag) => tag.startsWith('business:') && tag.endsWith('...')));
  assert.ok(JSON.stringify(summary).length < 1024);
});
