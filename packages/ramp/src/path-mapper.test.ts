import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeRampPath,
  flatNameWithId,
  parseRampCanonicalPath,
  rampAccountingAccountPath,
  rampAccountingFieldPath,
  rampBillByInvoiceNumberAliasPath,
  rampBillByStatusAliasPath,
  rampBillByVendorAliasPath,
  rampBillPath,
  rampBusinessPath,
  rampByIdAliasPath,
  rampDimensionDepartmentPath,
  rampDimensionEntityPath,
  rampDimensionLocationPath,
  rampDimensionMerchantPath,
  rampDimensionSpendProgramPath,
  rampDimensionUserByEmailAliasPath,
  rampDimensionUserPath,
  rampItemReceiptByNumberAliasPath,
  rampItemReceiptByPurchaseOrderAliasPath,
  rampItemReceiptPath,
  rampLookupPathForEvent,
  rampPurchaseOrderByNumberAliasPath,
  rampPurchaseOrderByReceiptStatusAliasPath,
  rampPurchaseOrderByVendorAliasPath,
  rampPurchaseOrderPath,
  rampReceiptByReimbursementAliasPath,
  rampReceiptByTransactionAliasPath,
  rampReceiptPath,
  rampReimbursementByStateAliasPath,
  rampReimbursementByUserAliasPath,
  rampReimbursementPath,
  rampRepaymentPath,
  rampTransactionByMerchantAliasPath,
  rampTransactionByStateAliasPath,
  rampTransactionPath,
  rampTransferPath,
  rampVendorAgreementByNameAliasPath,
  rampVendorAgreementByRenewalStatusAliasPath,
  rampVendorAgreementPath,
  rampVendorByNameAliasPath,
  rampVendorPath,
} from './path-mapper.js';

test('Ramp canonical path helpers round-trip through the parser', () => {
  const cases = [
    {
      path: rampBillPath('bill/1', 'Q4 Invoice'),
      expected: '/ramp/bills/bill%2F1__q4-invoice/meta.json',
      parsed: { kind: 'directory', resource: 'bills', id: 'bill/1', humanReadable: 'q4-invoice' },
    },
    {
      path: rampPurchaseOrderPath('po-1', 'PO-42'),
      expected: '/ramp/purchase-orders/po-1__po-42/meta.json',
      parsed: { kind: 'directory', resource: 'purchase-orders', id: 'po-1', humanReadable: 'po-42' },
    },
    {
      path: rampItemReceiptPath('receipt-1', 'RCPT-42'),
      expected: '/ramp/item-receipts/receipt-1__rcpt-42/meta.json',
      parsed: { kind: 'directory', resource: 'item-receipts', id: 'receipt-1', humanReadable: 'rcpt-42' },
    },
    {
      path: rampVendorAgreementPath('agreement-1', 'MSA Renewal'),
      expected: '/ramp/vendor-agreements/agreement-1__msa-renewal/meta.json',
      parsed: { kind: 'directory', resource: 'vendor-agreements', id: 'agreement-1', humanReadable: 'msa-renewal' },
    },
    {
      path: rampTransactionPath('txn/1', 'Cafe Roma'),
      expected: '/ramp/transactions/cafe-roma__txn%2F1.json',
      parsed: { kind: 'flat', resource: 'transactions', id: 'txn/1', humanReadable: 'cafe-roma' },
    },
    {
      path: rampReimbursementPath('reim-1', 'Airport Taxi'),
      expected: '/ramp/reimbursements/airport-taxi__reim-1.json',
      parsed: { kind: 'flat', resource: 'reimbursements', id: 'reim-1', humanReadable: 'airport-taxi' },
    },
    {
      path: rampReceiptPath('receipt/1', 'txn_1'),
      expected: '/ramp/receipts/txn-1__receipt%2F1.json',
      parsed: { kind: 'flat', resource: 'receipts', id: 'receipt/1', humanReadable: 'txn-1' },
    },
    {
      path: rampVendorPath('vendor-1', 'Acme Inc'),
      expected: '/ramp/vendors/acme-inc__vendor-1.json',
      parsed: { kind: 'flat', resource: 'vendors', id: 'vendor-1', humanReadable: 'acme-inc' },
    },
    {
      path: rampTransferPath('transfer-1', 'Transfer 1'),
      expected: '/ramp/transfers/transfer-1__transfer-1.json',
      parsed: { kind: 'flat', resource: 'transfers', id: 'transfer-1', humanReadable: 'transfer-1' },
    },
    {
      path: rampRepaymentPath('repayment-1', 'Repayment 1'),
      expected: '/ramp/repayments/repayment-1__repayment-1.json',
      parsed: { kind: 'flat', resource: 'repayments', id: 'repayment-1', humanReadable: 'repayment-1' },
    },
    {
      path: rampDimensionEntityPath('entity-1', 'HQ'),
      expected: '/ramp/dimensions/entities/hq__entity-1.json',
      parsed: { kind: 'flat', resource: 'dimensions/entities', id: 'entity-1', humanReadable: 'hq' },
    },
    {
      path: rampDimensionUserPath('user_1', 'finance@example.com'),
      expected: '/ramp/dimensions/users/finance-example-com__user%5F1.json',
      parsed: { kind: 'flat', resource: 'dimensions/users', id: 'user_1', humanReadable: 'finance-example-com' },
    },
    {
      path: rampDimensionDepartmentPath('department-1', 'Finance'),
      expected: '/ramp/dimensions/departments/finance__department-1.json',
      parsed: { kind: 'flat', resource: 'dimensions/departments', id: 'department-1', humanReadable: 'finance' },
    },
    {
      path: rampDimensionLocationPath('location-1', 'New York'),
      expected: '/ramp/dimensions/locations/new-york__location-1.json',
      parsed: { kind: 'flat', resource: 'dimensions/locations', id: 'location-1', humanReadable: 'new-york' },
    },
    {
      path: rampDimensionMerchantPath('merchant-1', 'Cafe Roma'),
      expected: '/ramp/dimensions/merchants/cafe-roma__merchant-1.json',
      parsed: { kind: 'flat', resource: 'dimensions/merchants', id: 'merchant-1', humanReadable: 'cafe-roma' },
    },
    {
      path: rampDimensionSpendProgramPath('program-1', 'Travel'),
      expected: '/ramp/dimensions/spend-programs/travel__program-1.json',
      parsed: { kind: 'flat', resource: 'dimensions/spend-programs', id: 'program-1', humanReadable: 'travel' },
    },
    {
      path: rampAccountingAccountPath('account-1', '4000 Travel'),
      expected: '/ramp/accounting/accounts/4000-travel__account-1.json',
      parsed: { kind: 'flat', resource: 'accounting/accounts', id: 'account-1', humanReadable: '4000-travel' },
    },
    {
      path: rampAccountingFieldPath('field-1', 'Department'),
      expected: '/ramp/accounting/fields/department__field-1.json',
      parsed: { kind: 'flat', resource: 'accounting/fields', id: 'field-1', humanReadable: 'department' },
    },
  ] as const;

  for (const entry of cases) {
    assert.equal(entry.path, entry.expected);
    assert.deepEqual(parseRampCanonicalPath(entry.path), entry.parsed);
    assert.equal(computeRampPath(entry.parsed.resource, entry.parsed.id, entry.parsed.humanReadable ?? undefined), entry.path);
  }

  assert.deepEqual(parseRampCanonicalPath(rampBusinessPath()), {
    kind: 'singleton',
    resource: 'business',
  });
});

test('Ramp canonical parsing rejects paths outside /ramp and index files', () => {
  assert.equal(parseRampCanonicalPath('/elsewhere/transactions/cafe__txn-1.json'), undefined);
  assert.equal(parseRampCanonicalPath('/ramp/transactions/_index.json'), undefined);
  assert.equal(parseRampCanonicalPath('/ramp/bills/_index.json'), undefined);
});

test('flatNameWithId preserves fallback ids, collision suffixes, and ids containing separators', () => {
  assert.equal(flatNameWithId('Main Vendor', 'vendor/1'), 'main-vendor__vendor%2F1');
  assert.equal(flatNameWithId(undefined, 'vendor/1'), 'vendor%2F1');
  assert.equal(flatNameWithId(undefined, 'txn__1'), 'txn%5F%5F1');
  assert.deepEqual(
    parseRampCanonicalPath(rampBillPath('bill__1', 'Q4 Invoice')),
    { kind: 'directory', resource: 'bills', id: 'bill__1', humanReadable: 'q4-invoice' },
  );
  assert.deepEqual(
    parseRampCanonicalPath(rampTransactionPath('txn__1', 'Cafe Roma')),
    { kind: 'flat', resource: 'transactions', id: 'txn__1', humanReadable: 'cafe-roma' },
  );

  const existingNames = new Set<string>();
  assert.equal(flatNameWithId('Shared Title', 'one', { existingNames }), 'shared-title__one');
  assert.match(
    flatNameWithId('Shared Title', 'two', { existingNames }),
    /^shared-title-[a-z0-9]+__two$/u,
  );
});

test('Ramp alias helpers keep each subtree distinct', () => {
  const aliasCases = [
    ['bill-by-id', rampByIdAliasPath('bills', 'bill-1'), rampByIdAliasPath('bills', 'bill-2')],
    ['bill-by-invoice-number', rampBillByInvoiceNumberAliasPath('INV-42', 'bill-1', 'INV-42'), rampBillByInvoiceNumberAliasPath('INV-42', 'bill-2', 'INV-42')],
    ['bill-by-vendor', rampBillByVendorAliasPath('Acme', 'bill-1', 'INV-42'), rampBillByVendorAliasPath('Acme', 'bill-2', 'INV-42')],
    ['bill-by-status', rampBillByStatusAliasPath('PAID', 'bill-1', 'INV-42'), rampBillByStatusAliasPath('PAID', 'bill-2', 'INV-42')],
    ['po-by-number', rampPurchaseOrderByNumberAliasPath('PO-1', 'po-1', 'PO-1'), rampPurchaseOrderByNumberAliasPath('PO-1', 'po-2', 'PO-1')],
    ['po-by-vendor', rampPurchaseOrderByVendorAliasPath('Acme', 'po-1', 'PO-1'), rampPurchaseOrderByVendorAliasPath('Acme', 'po-2', 'PO-1')],
    ['po-by-receipt-status', rampPurchaseOrderByReceiptStatusAliasPath('OPEN', 'po-1', 'PO-1'), rampPurchaseOrderByReceiptStatusAliasPath('OPEN', 'po-2', 'PO-1')],
    ['item-receipt-by-number', rampItemReceiptByNumberAliasPath('IR-1', 'ir-1', 'IR-1'), rampItemReceiptByNumberAliasPath('IR-1', 'ir-2', 'IR-1')],
    ['item-receipt-by-purchase-order', rampItemReceiptByPurchaseOrderAliasPath('po-1', 'ir-1', 'IR-1'), rampItemReceiptByPurchaseOrderAliasPath('po-1', 'ir-2', 'IR-1')],
    ['vendor-agreement-by-name', rampVendorAgreementByNameAliasPath('MSA', 'agreement-1', 'MSA'), rampVendorAgreementByNameAliasPath('MSA', 'agreement-2', 'MSA')],
    ['vendor-agreement-by-renewal-status', rampVendorAgreementByRenewalStatusAliasPath('active', 'agreement-1', 'MSA'), rampVendorAgreementByRenewalStatusAliasPath('active', 'agreement-2', 'MSA')],
    ['transaction-by-merchant', rampTransactionByMerchantAliasPath('Cafe Roma', 'txn-1', 'Cafe Roma'), rampTransactionByMerchantAliasPath('Cafe Roma', 'txn-2', 'Cafe Roma')],
    ['transaction-by-state', rampTransactionByStateAliasPath('CLEARED', 'txn-1', 'Cafe Roma'), rampTransactionByStateAliasPath('CLEARED', 'txn-2', 'Cafe Roma')],
    ['reimbursement-by-user', rampReimbursementByUserAliasPath('finance@example.com', 'reim-1', 'Airport Taxi'), rampReimbursementByUserAliasPath('finance@example.com', 'reim-2', 'Airport Taxi')],
    ['reimbursement-by-state', rampReimbursementByStateAliasPath('APPROVED', 'reim-1', 'Airport Taxi'), rampReimbursementByStateAliasPath('APPROVED', 'reim-2', 'Airport Taxi')],
    ['receipt-by-transaction', rampReceiptByTransactionAliasPath('txn-1', 'receipt-1', 'txn-1'), rampReceiptByTransactionAliasPath('txn-1', 'receipt-2', 'txn-1')],
    ['receipt-by-reimbursement', rampReceiptByReimbursementAliasPath('reim-1', 'receipt-1', 'reim-1'), rampReceiptByReimbursementAliasPath('reim-1', 'receipt-2', 'reim-1')],
    ['vendor-by-name', rampVendorByNameAliasPath('Acme', 'vendor-1', 'Acme'), rampVendorByNameAliasPath('Acme', 'vendor-2', 'Acme')],
    ['user-by-email', rampDimensionUserByEmailAliasPath('finance@example.com', 'user-1', 'finance@example.com'), rampDimensionUserByEmailAliasPath('finance@example.com', 'user-2', 'finance@example.com')],
  ] as const;

  for (const [label, first, second] of aliasCases) {
    assert.notEqual(first, second, label);
  }
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
