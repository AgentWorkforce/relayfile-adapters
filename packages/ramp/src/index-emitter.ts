import { rampIndexPath, rampRootIndexPath } from './path-mapper.js';
import { compareRampIndexRows } from './queries.js';
import type { RampIndexRow, RampRootIndexRow } from './types.js';

export type RampIndexBucket =
  | 'bills'
  | 'purchase-orders'
  | 'item-receipts'
  | 'vendor-agreements'
  | 'transactions'
  | 'reimbursements'
  | 'receipts'
  | 'vendors'
  | 'transfers'
  | 'repayments'
  | 'dimensions/entities'
  | 'dimensions/users'
  | 'dimensions/departments'
  | 'dimensions/locations'
  | 'dimensions/merchants'
  | 'dimensions/spend-programs'
  | 'accounting/accounts'
  | 'accounting/fields';

export interface RampIndexFile {
  path: string;
  contentType: 'application/json; charset=utf-8';
  content: string;
}

export function buildRampRootIndexFile(
  rows: RampRootIndexRow[] = [
    { id: 'business', title: 'Business' },
    { id: 'bills', title: 'Bills' },
    { id: 'purchase-orders', title: 'Purchase Orders' },
    { id: 'item-receipts', title: 'Item Receipts' },
    { id: 'vendor-agreements', title: 'Vendor Agreements' },
    { id: 'transactions', title: 'Transactions' },
    { id: 'reimbursements', title: 'Reimbursements' },
    { id: 'receipts', title: 'Receipts' },
    { id: 'vendors', title: 'Vendors' },
    { id: 'transfers', title: 'Transfers' },
    { id: 'repayments', title: 'Repayments' },
    { id: 'dimensions', title: 'Dimensions' },
    { id: 'accounting', title: 'Accounting' },
  ],
): RampIndexFile {
  return {
    path: rampRootIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(rows)}\n`,
  };
}

export function buildRampIndexFile(
  bucket: RampIndexBucket,
  rows: RampIndexRow[],
): RampIndexFile {
  const validRows = rows.filter(isRampIndexRow);
  return {
    path: rampIndexPath(bucket),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(validRows.sort(compareRampIndexRows))}\n`,
  };
}

function isRampIndexRow(value: RampIndexRow | Record<string, unknown>): value is RampIndexRow {
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.updated === 'string'
    && typeof value.canonicalPath === 'string';
}
