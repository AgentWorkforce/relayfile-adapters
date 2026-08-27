import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeRampPath,
  flatNameWithId,
  parseRampCanonicalPath,
  rampBillPath,
  rampBusinessPath,
  rampByIdAliasPath,
  rampDimensionUserPath,
  rampLookupPathForEvent,
  rampTransactionPath,
} from './path-mapper.js';

test('Ramp canonical paths round-trip through the parser', () => {
  const billPath = rampBillPath('bill/1', 'Q4 Invoice');
  assert.equal(billPath, '/ramp/bills/bill%2F1__q4-invoice/meta.json');
  assert.deepEqual(parseRampCanonicalPath(billPath), {
    kind: 'directory',
    resource: 'bills',
    id: 'bill/1',
    humanReadable: 'q4-invoice',
  });

  const transactionPath = rampTransactionPath('txn/1', 'Cafe Roma');
  assert.equal(transactionPath, '/ramp/transactions/cafe-roma__txn%2F1.json');
  assert.deepEqual(parseRampCanonicalPath(transactionPath), {
    kind: 'flat',
    resource: 'transactions',
    id: 'txn/1',
    humanReadable: 'cafe-roma',
  });

  const userPath = rampDimensionUserPath('user_1', 'finance@example.com');
  assert.equal(userPath, '/ramp/dimensions/users/finance-example-com__user_1.json');
  assert.deepEqual(parseRampCanonicalPath(userPath), {
    kind: 'flat',
    resource: 'dimensions/users',
    id: 'user_1',
    humanReadable: 'finance-example-com',
  });

  assert.deepEqual(parseRampCanonicalPath(rampBusinessPath()), {
    kind: 'singleton',
    resource: 'business',
  });
});

test('computeRampPath reuses the provider helpers for directory and flat resources', () => {
  assert.equal(
    computeRampPath('bills', 'bill-123', 'Acme Invoice'),
    rampBillPath('bill-123', 'Acme Invoice'),
  );
  assert.equal(
    computeRampPath('transactions', 'txn-123', 'Coffee Shop'),
    rampTransactionPath('txn-123', 'Coffee Shop'),
  );
});

test('flatNameWithId percent-encodes ids and preserves slug prefixes', () => {
  assert.equal(flatNameWithId('Main Vendor', 'vendor/1'), 'main-vendor__vendor%2F1');
  assert.equal(flatNameWithId(undefined, 'vendor/1'), 'vendor%2F1');
});

test('Ramp webhook lookup paths resolve to stable by-id aliases', () => {
  assert.equal(
    rampLookupPathForEvent('payments.updated', 'bill-123'),
    rampByIdAliasPath('bills', 'bill-123'),
  );
  assert.equal(
    rampLookupPathForEvent('transactions.authorized', 'txn-123'),
    rampByIdAliasPath('transactions', 'txn-123'),
  );
  assert.equal(
    rampLookupPathForEvent('users.invite_accepted', 'user-123'),
    rampByIdAliasPath('dimensions/users', 'user-123'),
  );
  assert.equal(rampLookupPathForEvent('unified_requests.created', 'req-123'), undefined);
});
