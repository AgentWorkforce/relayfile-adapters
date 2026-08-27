import assert from 'node:assert/strict';
import test from 'node:test';

import { compareRampIndexRows, rampIndexRow, rampTitle, rampUpdated } from './queries.js';

test('Ramp titles follow the resource-specific fallback chain', () => {
  assert.equal(
    rampTitle('bills', { id: 'bill-1', invoice_number: 'INV-42', vendor: { name: 'Acme' } }),
    'INV-42',
  );
  assert.equal(
    rampTitle('bills', { id: 'bill-2', vendor: { name: 'Acme' } }),
    'Acme',
  );
  assert.equal(
    rampTitle('transactions', { id: 'txn-1', merchant_name: 'Cafe Roma' }),
    'Cafe Roma',
  );
  assert.equal(
    rampTitle('dimensions/users', { id: 'user-1', email: 'finance@example.com' }),
    'finance@example.com',
  );
});

test('Ramp updated timestamps follow the resource-specific fallback chain', () => {
  assert.equal(
    rampUpdated('bills', {
      id: 'bill-1',
      paid_at: '2026-08-27T15:00:00.000Z',
      issued_at: '2026-08-27T14:00:00.000Z',
      created_at: '2026-08-27T13:00:00.000Z',
    }),
    '2026-08-27T15:00:00.000Z',
  );
  assert.equal(
    rampUpdated('transactions', {
      id: 'txn-1',
      settlement_date: '2026-08-27T15:00:00.000Z',
      user_transaction_time: '2026-08-27T14:00:00.000Z',
      created_at: '2026-08-27T13:00:00.000Z',
    }),
    '2026-08-27T15:00:00.000Z',
  );
  assert.equal(
    rampUpdated('reimbursements', {
      id: 'reim-1',
      submitted_at: '2026-08-27T14:00:00.000Z',
      created_at: '2026-08-27T13:00:00.000Z',
    }),
    '2026-08-27T14:00:00.000Z',
  );
});

test('Ramp index rows keep canonical paths plus filterable business fields', () => {
  const row = rampIndexRow('bills', {
    id: 'bill-1',
    invoice_number: 'INV-42',
    status: 'PAID',
    sync_status: 'BILL_SYNCED',
    approval_status: 'APPROVED',
    amount: 199.5,
    vendor: { id: 'vendor-1', name: 'Acme' },
    paid_at: '2026-08-27T15:00:00.000Z',
  });

  assert.deepEqual(row, {
    id: 'bill-1',
    title: 'INV-42',
    updated: '2026-08-27T15:00:00.000Z',
    canonicalPath: '/ramp/bills/bill-1__inv-42/meta.json',
    status: 'PAID',
    sync_status: 'BILL_SYNCED',
    approval_status: 'APPROVED',
    amount: 199.5,
    vendor_id: 'vendor-1',
  });
});

test('Ramp index rows sort newest-first then by id', () => {
  const rows = [
    { id: 'b', title: 'B', updated: '2026-08-27T10:00:00.000Z', canonicalPath: '/b' },
    { id: 'a', title: 'A', updated: '2026-08-27T10:00:00.000Z', canonicalPath: '/a' },
    { id: 'c', title: 'C', updated: '2026-08-27T11:00:00.000Z', canonicalPath: '/c' },
  ];

  rows.sort(compareRampIndexRows);
  assert.deepEqual(rows.map((row) => row.id), ['c', 'a', 'b']);
});
