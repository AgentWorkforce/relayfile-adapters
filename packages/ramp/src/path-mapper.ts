import { aliasCollisionSuffix, slugifyAlias } from '@relayfile/adapter-core';

import {
  RAMP_CANONICAL_RESOURCES,
  RAMP_DIRECTORY_RESOURCES,
  RAMP_PATH_ROOT,
  type RampCanonicalResource,
  type RampDirectoryResource,
} from './types.js';

export interface NameWithIdOptions {
  existingNames?: Set<string>;
}

export interface ParseNameWithIdResult {
  humanReadable: string | null;
  id: string;
  ext: string | null;
}

export interface ParsedDirectoryRecordSegment {
  humanReadable: string | null;
  id: string;
}

export interface ParsedRampCanonicalPath {
  kind: 'singleton' | 'directory' | 'flat';
  resource: 'business' | RampCanonicalResource;
  id?: string;
  humanReadable?: string | null;
}

const DIRECTORY_RESOURCE_SET = new Set<string>(RAMP_DIRECTORY_RESOURCES);
const CANONICAL_RESOURCE_SET = new Set<string>(RAMP_CANONICAL_RESOURCES);

const RESOURCE_ROOTS: Readonly<Record<RampCanonicalResource, string>> = {
  'bills': `${RAMP_PATH_ROOT}/bills`,
  'purchase-orders': `${RAMP_PATH_ROOT}/purchase-orders`,
  'item-receipts': `${RAMP_PATH_ROOT}/item-receipts`,
  'vendor-agreements': `${RAMP_PATH_ROOT}/vendor-agreements`,
  'transactions': `${RAMP_PATH_ROOT}/transactions`,
  'reimbursements': `${RAMP_PATH_ROOT}/reimbursements`,
  'receipts': `${RAMP_PATH_ROOT}/receipts`,
  'vendors': `${RAMP_PATH_ROOT}/vendors`,
  'transfers': `${RAMP_PATH_ROOT}/transfers`,
  'repayments': `${RAMP_PATH_ROOT}/repayments`,
  'dimensions/entities': `${RAMP_PATH_ROOT}/dimensions/entities`,
  'dimensions/users': `${RAMP_PATH_ROOT}/dimensions/users`,
  'dimensions/departments': `${RAMP_PATH_ROOT}/dimensions/departments`,
  'dimensions/locations': `${RAMP_PATH_ROOT}/dimensions/locations`,
  'dimensions/merchants': `${RAMP_PATH_ROOT}/dimensions/merchants`,
  'dimensions/spend-programs': `${RAMP_PATH_ROOT}/dimensions/spend-programs`,
  'accounting/accounts': `${RAMP_PATH_ROOT}/accounting/accounts`,
  'accounting/fields': `${RAMP_PATH_ROOT}/accounting/fields`,
};

function encodeSegment(value: string, label = 'path segment'): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Ramp ${label} must be a non-empty string`);
  }
  return encodeURIComponent(trimmed);
}

function encodeCompositeIdSegment(value: string, label = 'id'): string {
  return encodeSegment(value, label).replace(/_/gu, '%5F');
}

function folderAlias(value: string): string {
  const slug = slugifyAlias(value);
  return slug || 'untitled';
}

export function rampRootIndexPath(): string {
  return `${RAMP_PATH_ROOT}/_index.json`;
}

export function rampLayoutPath(): string {
  return `${RAMP_PATH_ROOT}/LAYOUT.md`;
}

export function rampBusinessPath(): string {
  return `${RAMP_PATH_ROOT}/business.json`;
}

export function rampResourceRoot(resource: RampCanonicalResource): string {
  return RESOURCE_ROOTS[resource];
}

export function rampIndexPath(resource: RampCanonicalResource): string {
  return `${rampResourceRoot(resource)}/_index.json`;
}

export function flatNameWithId(
  humanReadable: string | undefined,
  id: string,
  opts: NameWithIdOptions = {},
): string {
  const normalizedId = encodeCompositeIdSegment(id, 'id');
  const slug = humanReadable ? slugifyAlias(humanReadable) : '';
  if (!slug) {
    return normalizedId;
  }
  const existingNames = opts.existingNames;
  const base = existingNames?.has(slug)
    ? `${slug}-${aliasCollisionSuffix(normalizedId)}`
    : slug;
  existingNames?.add(base);
  return `${base}__${normalizedId}`;
}

export function directoryRecordSegment(
  id: string,
  humanReadable?: string,
): string {
  const normalizedId = encodeCompositeIdSegment(id, 'id');
  const slug = humanReadable ? slugifyAlias(humanReadable) : '';
  return slug ? `${normalizedId}__${slug}` : normalizedId;
}

export function parseFlatNameWithId(filename: string): ParseNameWithIdResult {
  const extIndex = filename.lastIndexOf('.');
  const ext = extIndex > 0 && extIndex < filename.length - 1 ? filename.slice(extIndex + 1) : null;
  const basename = ext ? filename.slice(0, extIndex) : filename;
  const separatorIndex = basename.lastIndexOf('__');
  if (separatorIndex <= 0 || separatorIndex === basename.length - 2) {
    return {
      humanReadable: null,
      id: decodeURIComponent(basename),
      ext,
    };
  }
  return {
    humanReadable: basename.slice(0, separatorIndex),
    id: decodeURIComponent(basename.slice(separatorIndex + 2)),
    ext,
  };
}

export function parseDirectoryRecordSegment(segment: string): ParsedDirectoryRecordSegment {
  const separatorIndex = segment.indexOf('__');
  if (separatorIndex <= 0 || separatorIndex === segment.length - 2) {
    return {
      humanReadable: null,
      id: decodeURIComponent(segment),
    };
  }
  return {
    id: decodeURIComponent(segment.slice(0, separatorIndex)),
    humanReadable: segment.slice(separatorIndex + 2),
  };
}

export function rampByIdAliasPath(resource: RampCanonicalResource, id: string): string {
  return `${rampResourceRoot(resource)}/by-id/${encodeSegment(id, 'alias id')}.json`;
}

function rampFacetAliasPath(
  resource: RampCanonicalResource,
  facet: string,
  facetValue: string,
  id: string,
  humanReadable?: string,
): string {
  return `${rampResourceRoot(resource)}/${facet}/${folderAlias(facetValue)}/${flatNameWithId(humanReadable, id)}.json`;
}

function rampFacetLeafAliasPath(
  resource: RampCanonicalResource,
  facet: string,
  id: string,
  humanReadable?: string,
): string {
  return `${rampResourceRoot(resource)}/${facet}/${flatNameWithId(humanReadable, id)}.json`;
}

export function rampBillPath(id: string, title?: string): string {
  return `${rampResourceRoot('bills')}/${directoryRecordSegment(id, title)}/meta.json`;
}

export function rampPurchaseOrderPath(id: string, title?: string): string {
  return `${rampResourceRoot('purchase-orders')}/${directoryRecordSegment(id, title)}/meta.json`;
}

export function rampItemReceiptPath(id: string, title?: string): string {
  return `${rampResourceRoot('item-receipts')}/${directoryRecordSegment(id, title)}/meta.json`;
}

export function rampVendorAgreementPath(id: string, title?: string): string {
  return `${rampResourceRoot('vendor-agreements')}/${directoryRecordSegment(id, title)}/meta.json`;
}

export function rampTransactionPath(id: string, title?: string): string {
  return `${rampResourceRoot('transactions')}/${flatNameWithId(title, id)}.json`;
}

export function rampReimbursementPath(id: string, title?: string): string {
  return `${rampResourceRoot('reimbursements')}/${flatNameWithId(title, id)}.json`;
}

export function rampReceiptPath(id: string, title?: string): string {
  return `${rampResourceRoot('receipts')}/${flatNameWithId(title, id)}.json`;
}

export function rampVendorPath(id: string, title?: string): string {
  return `${rampResourceRoot('vendors')}/${flatNameWithId(title, id)}.json`;
}

export function rampTransferPath(id: string, title?: string): string {
  return `${rampResourceRoot('transfers')}/${flatNameWithId(title, id)}.json`;
}

export function rampRepaymentPath(id: string, title?: string): string {
  return `${rampResourceRoot('repayments')}/${flatNameWithId(title, id)}.json`;
}

export function rampDimensionEntityPath(id: string, title?: string): string {
  return `${rampResourceRoot('dimensions/entities')}/${flatNameWithId(title, id)}.json`;
}

export function rampDimensionUserPath(id: string, title?: string): string {
  return `${rampResourceRoot('dimensions/users')}/${flatNameWithId(title, id)}.json`;
}

export function rampDimensionDepartmentPath(id: string, title?: string): string {
  return `${rampResourceRoot('dimensions/departments')}/${flatNameWithId(title, id)}.json`;
}

export function rampDimensionLocationPath(id: string, title?: string): string {
  return `${rampResourceRoot('dimensions/locations')}/${flatNameWithId(title, id)}.json`;
}

export function rampDimensionMerchantPath(id: string, title?: string): string {
  return `${rampResourceRoot('dimensions/merchants')}/${flatNameWithId(title, id)}.json`;
}

export function rampDimensionSpendProgramPath(id: string, title?: string): string {
  return `${rampResourceRoot('dimensions/spend-programs')}/${flatNameWithId(title, id)}.json`;
}

export function rampAccountingAccountPath(id: string, title?: string): string {
  return `${rampResourceRoot('accounting/accounts')}/${flatNameWithId(title, id)}.json`;
}

export function rampAccountingFieldPath(id: string, title?: string): string {
  return `${rampResourceRoot('accounting/fields')}/${flatNameWithId(title, id)}.json`;
}

export function rampBillByInvoiceNumberAliasPath(invoiceNumber: string, id: string, title?: string): string {
  return rampFacetLeafAliasPath('bills', 'by-invoice-number', id, title ?? invoiceNumber);
}

export function rampBillByVendorAliasPath(vendor: string, id: string, title?: string): string {
  return rampFacetAliasPath('bills', 'by-vendor', vendor, id, title);
}

export function rampBillByStatusAliasPath(status: string, id: string, title?: string): string {
  return rampFacetAliasPath('bills', 'by-status', status, id, title);
}

export function rampPurchaseOrderByNumberAliasPath(number: string, id: string, title?: string): string {
  return rampFacetLeafAliasPath('purchase-orders', 'by-number', id, title ?? number);
}

export function rampPurchaseOrderByVendorAliasPath(vendor: string, id: string, title?: string): string {
  return rampFacetAliasPath('purchase-orders', 'by-vendor', vendor, id, title);
}

export function rampPurchaseOrderByReceiptStatusAliasPath(status: string, id: string, title?: string): string {
  return rampFacetAliasPath('purchase-orders', 'by-receipt-status', status, id, title);
}

export function rampItemReceiptByNumberAliasPath(number: string, id: string, title?: string): string {
  return rampFacetLeafAliasPath('item-receipts', 'by-number', id, title ?? number);
}

export function rampItemReceiptByPurchaseOrderAliasPath(purchaseOrderId: string, id: string, title?: string): string {
  return `${rampResourceRoot('item-receipts')}/by-purchase-order/${encodeSegment(purchaseOrderId)}/${flatNameWithId(title, id)}.json`;
}

export function rampVendorAgreementByNameAliasPath(name: string, id: string, title?: string): string {
  return rampFacetLeafAliasPath('vendor-agreements', 'by-name', id, title ?? name);
}

export function rampVendorAgreementByRenewalStatusAliasPath(status: string, id: string, title?: string): string {
  return rampFacetAliasPath('vendor-agreements', 'by-renewal-status', status, id, title);
}

export function rampTransactionByMerchantAliasPath(merchant: string, id: string, title?: string): string {
  return rampFacetAliasPath('transactions', 'by-merchant', merchant, id, title);
}

export function rampTransactionByStateAliasPath(state: string, id: string, title?: string): string {
  return rampFacetAliasPath('transactions', 'by-state', state, id, title);
}

export function rampReimbursementByUserAliasPath(user: string, id: string, title?: string): string {
  return rampFacetAliasPath('reimbursements', 'by-user', user, id, title);
}

export function rampReimbursementByStateAliasPath(state: string, id: string, title?: string): string {
  return rampFacetAliasPath('reimbursements', 'by-state', state, id, title);
}

export function rampReceiptByTransactionAliasPath(transactionId: string, id: string, title?: string): string {
  return `${rampResourceRoot('receipts')}/by-transaction/${encodeSegment(transactionId)}/${flatNameWithId(title, id)}.json`;
}

export function rampReceiptByReimbursementAliasPath(reimbursementId: string, id: string, title?: string): string {
  return `${rampResourceRoot('receipts')}/by-reimbursement/${encodeSegment(reimbursementId)}/${flatNameWithId(title, id)}.json`;
}

export function rampVendorByNameAliasPath(name: string, id: string, title?: string): string {
  return rampFacetLeafAliasPath('vendors', 'by-name', id, title ?? name);
}

export function rampDimensionUserByEmailAliasPath(email: string, id: string, title?: string): string {
  return rampFacetLeafAliasPath('dimensions/users', 'by-email', id, title ?? email);
}

export function rampLookupPathForEvent(eventType: string, objectId: string): string | undefined {
  if (eventType.startsWith('bills.') || eventType === 'payments.updated') {
    return rampByIdAliasPath('bills', objectId);
  }
  if (eventType.startsWith('purchase_orders.')) {
    return rampByIdAliasPath('purchase-orders', objectId);
  }
  if (eventType.startsWith('item_receipts.')) {
    return rampByIdAliasPath('item-receipts', objectId);
  }
  if (eventType.startsWith('transactions.')) {
    return rampByIdAliasPath('transactions', objectId);
  }
  if (eventType.startsWith('reimbursements.')) {
    return rampByIdAliasPath('reimbursements', objectId);
  }
  if (eventType.startsWith('vendor_agreements.')) {
    return rampByIdAliasPath('vendor-agreements', objectId);
  }
  if (eventType.startsWith('vendors.')) {
    return rampByIdAliasPath('vendors', objectId);
  }
  if (eventType.startsWith('entities.')) {
    return rampByIdAliasPath('dimensions/entities', objectId);
  }
  if (eventType.startsWith('users.')) {
    return rampByIdAliasPath('dimensions/users', objectId);
  }
  return undefined;
}

export function computeRampPath(
  resource: RampCanonicalResource,
  objectId: string,
  humanReadable?: string,
): string {
  switch (resource) {
    case 'bills':
      return rampBillPath(objectId, humanReadable);
    case 'purchase-orders':
      return rampPurchaseOrderPath(objectId, humanReadable);
    case 'item-receipts':
      return rampItemReceiptPath(objectId, humanReadable);
    case 'vendor-agreements':
      return rampVendorAgreementPath(objectId, humanReadable);
    case 'transactions':
      return rampTransactionPath(objectId, humanReadable);
    case 'reimbursements':
      return rampReimbursementPath(objectId, humanReadable);
    case 'receipts':
      return rampReceiptPath(objectId, humanReadable);
    case 'vendors':
      return rampVendorPath(objectId, humanReadable);
    case 'transfers':
      return rampTransferPath(objectId, humanReadable);
    case 'repayments':
      return rampRepaymentPath(objectId, humanReadable);
    case 'dimensions/entities':
      return rampDimensionEntityPath(objectId, humanReadable);
    case 'dimensions/users':
      return rampDimensionUserPath(objectId, humanReadable);
    case 'dimensions/departments':
      return rampDimensionDepartmentPath(objectId, humanReadable);
    case 'dimensions/locations':
      return rampDimensionLocationPath(objectId, humanReadable);
    case 'dimensions/merchants':
      return rampDimensionMerchantPath(objectId, humanReadable);
    case 'dimensions/spend-programs':
      return rampDimensionSpendProgramPath(objectId, humanReadable);
    case 'accounting/accounts':
      return rampAccountingAccountPath(objectId, humanReadable);
    case 'accounting/fields':
      return rampAccountingFieldPath(objectId, humanReadable);
  }
}

export function parseRampCanonicalPath(path: string): ParsedRampCanonicalPath | undefined {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized === rampBusinessPath()) {
    return { kind: 'singleton', resource: 'business' };
  }
  if (!normalized.startsWith(`${RAMP_PATH_ROOT}/`)) {
    return undefined;
  }

  const withoutRoot = normalized.slice(RAMP_PATH_ROOT.length + 1);
  const segments = withoutRoot.split('/').filter(Boolean);
  if (segments.length < 2) {
    return undefined;
  }

  for (let length = Math.min(segments.length - 1, 2); length >= 1; length -= 1) {
    const resource = segments.slice(0, length).join('/');
    if (!CANONICAL_RESOURCE_SET.has(resource)) {
      continue;
    }

    const rest = segments.slice(length);
    if (DIRECTORY_RESOURCE_SET.has(resource)) {
      if (rest.length === 2 && rest[1] === 'meta.json') {
        const parsed = parseDirectoryRecordSegment(rest[0] ?? '');
        return {
          kind: 'directory',
          resource: resource as RampDirectoryResource,
          id: parsed.id,
          humanReadable: parsed.humanReadable,
        };
      }
      return undefined;
    }

    if (rest.length === 1 && rest[0] === '_index.json') {
      return undefined;
    }

    if (rest.length === 1 && rest[0]?.endsWith('.json')) {
      const parsed = parseFlatNameWithId(rest[0]);
      return {
        kind: 'flat',
        resource: resource as RampCanonicalResource,
        id: parsed.id,
        humanReadable: parsed.humanReadable,
      };
    }
  }

  return undefined;
}
