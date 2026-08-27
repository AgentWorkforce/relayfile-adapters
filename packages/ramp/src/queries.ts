import {
  computeRampPath,
  rampBillByInvoiceNumberAliasPath,
  rampBillByStatusAliasPath,
  rampBillByVendorAliasPath,
  rampByIdAliasPath,
  rampDimensionUserByEmailAliasPath,
  rampItemReceiptByNumberAliasPath,
  rampItemReceiptByPurchaseOrderAliasPath,
  rampPurchaseOrderByNumberAliasPath,
  rampPurchaseOrderByReceiptStatusAliasPath,
  rampPurchaseOrderByVendorAliasPath,
  rampReceiptByReimbursementAliasPath,
  rampReceiptByTransactionAliasPath,
  rampReimbursementByStateAliasPath,
  rampReimbursementByUserAliasPath,
  rampTransactionByMerchantAliasPath,
  rampTransactionByStateAliasPath,
  rampVendorAgreementByNameAliasPath,
  rampVendorAgreementByRenewalStatusAliasPath,
  rampVendorByNameAliasPath,
} from './path-mapper.js';
import type {
  RampAccountingAccountRecord,
  RampAccountingFieldRecord,
  RampAliasPointer,
  RampBaseRecord,
  RampBillRecord,
  RampCanonicalResource,
  RampDimensionRecord,
  RampIndexRow,
  RampItemReceiptRecord,
  RampPurchaseOrderRecord,
  RampReceiptRecord,
  RampReimbursementRecord,
  RampTransactionRecord,
  RampVendorAgreementRecord,
  RampVendorRecord,
} from './types.js';

const FALLBACK_UPDATED_AT = '1970-01-01T00:00:00.000Z';

export function compareRampIndexRows(left: RampIndexRow, right: RampIndexRow): number {
  const leftMs = parseUpdatedAt(left.updated);
  const rightMs = parseUpdatedAt(right.updated);
  if (leftMs !== rightMs) {
    return rightMs - leftMs;
  }
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

export function buildRampAliasPointer(
  resource: RampCanonicalResource,
  record: Record<string, unknown>,
  row: RampIndexRow,
  aliasPaths: readonly string[],
  connectionId?: string,
): RampAliasPointer {
  return {
    provider: 'ramp',
    resource,
    objectId: row.id,
    canonicalPath: row.canonicalPath,
    title: row.title,
    updated: row.updated,
    aliasPaths: [...aliasPaths],
    payload: record,
    ...(connectionId ? { connectionId } : {}),
  };
}

export function rampIndexRow(
  resource: RampCanonicalResource,
  record: RampBaseRecord,
): RampIndexRow {
  const title = rampTitle(resource, record);
  const canonicalPath = computeRampPath(resource, record.id, title);
  const updated = rampUpdated(resource, record);

  switch (resource) {
    case 'bills': {
      const bill = record as RampBillRecord;
      return compactRow({
        id: bill.id,
        title,
        updated,
        canonicalPath,
        status: readString(bill.status),
        sync_status: readString(bill.sync_status),
        approval_status: readString(bill.approval_status),
        amount: readScalar(bill.amount),
        vendor_id: readString(bill.vendor?.id),
      });
    }
    case 'purchase-orders': {
      const purchaseOrder = record as RampPurchaseOrderRecord;
      return compactRow({
        id: purchaseOrder.id,
        title,
        updated,
        canonicalPath,
        receipt_status: readString(purchaseOrder.receipt_status),
        billing_status: readString(purchaseOrder.billing_status),
        vendor_id: readString(purchaseOrder.vendor_id) ?? readString(purchaseOrder.vendor?.id),
      });
    }
    case 'transactions': {
      const transaction = record as RampTransactionRecord;
      return compactRow({
        id: transaction.id,
        title,
        updated,
        canonicalPath,
        state: readString(transaction.state),
        sync_status: readString(transaction.sync_status),
        amount: readScalar(transaction.amount),
        merchant_id: readString(transaction.merchant_id),
        card_holder_user_id: readString(transaction.card_holder?.user_id),
        entity_id: readString(transaction.entity_id),
      });
    }
    case 'reimbursements': {
      const reimbursement = record as RampReimbursementRecord;
      return compactRow({
        id: reimbursement.id,
        title,
        updated,
        canonicalPath,
        state: readString(reimbursement.state),
        sync_status: readString(reimbursement.sync_status),
        user_id: readString(reimbursement.user_id),
      });
    }
    default:
      return compactRow({
        id: record.id,
        title,
        updated,
        canonicalPath,
      });
  }
}

export function rampAliasPaths(
  resource: RampCanonicalResource,
  record: RampBaseRecord,
  row: RampIndexRow,
): string[] {
  const aliasPaths = [rampByIdAliasPath(resource, row.id)];
  switch (resource) {
    case 'bills': {
      const bill = record as RampBillRecord;
      const invoiceNumber = readString(bill.invoice_number);
      const vendorName = readString(bill.vendor?.name);
      const status = readString(bill.status);
      if (invoiceNumber) aliasPaths.push(rampBillByInvoiceNumberAliasPath(invoiceNumber, row.id, row.title));
      if (vendorName) aliasPaths.push(rampBillByVendorAliasPath(vendorName, row.id, row.title));
      if (status) aliasPaths.push(rampBillByStatusAliasPath(status, row.id, row.title));
      return aliasPaths;
    }
    case 'purchase-orders': {
      const purchaseOrder = record as RampPurchaseOrderRecord;
      const number = readString(purchaseOrder.purchase_order_number);
      const vendorName = readString(purchaseOrder.vendor?.name);
      const receiptStatus = readString(purchaseOrder.receipt_status);
      if (number) aliasPaths.push(rampPurchaseOrderByNumberAliasPath(number, row.id, row.title));
      if (vendorName) aliasPaths.push(rampPurchaseOrderByVendorAliasPath(vendorName, row.id, row.title));
      if (receiptStatus) aliasPaths.push(rampPurchaseOrderByReceiptStatusAliasPath(receiptStatus, row.id, row.title));
      return aliasPaths;
    }
    case 'item-receipts': {
      const itemReceipt = record as RampItemReceiptRecord;
      const number = readString(itemReceipt.item_receipt_number);
      const purchaseOrderId = readString(itemReceipt.purchase_order_id);
      if (number) aliasPaths.push(rampItemReceiptByNumberAliasPath(number, row.id, row.title));
      if (purchaseOrderId) aliasPaths.push(rampItemReceiptByPurchaseOrderAliasPath(purchaseOrderId, row.id, row.title));
      return aliasPaths;
    }
    case 'vendor-agreements': {
      const agreement = record as RampVendorAgreementRecord;
      const name = readString(agreement.name);
      const renewalStatus = readString(agreement.renewal_status);
      if (name) aliasPaths.push(rampVendorAgreementByNameAliasPath(name, row.id, row.title));
      if (renewalStatus) aliasPaths.push(rampVendorAgreementByRenewalStatusAliasPath(renewalStatus, row.id, row.title));
      return aliasPaths;
    }
    case 'transactions': {
      const transaction = record as RampTransactionRecord;
      const merchant = readString(transaction.merchant_name);
      const state = readString(transaction.state);
      if (merchant) aliasPaths.push(rampTransactionByMerchantAliasPath(merchant, row.id, row.title));
      if (state) aliasPaths.push(rampTransactionByStateAliasPath(state, row.id, row.title));
      return aliasPaths;
    }
    case 'reimbursements': {
      const reimbursement = record as RampReimbursementRecord;
      const user = readString(reimbursement.user_email) ?? readString(reimbursement.user_full_name);
      const state = readString(reimbursement.state);
      if (user) aliasPaths.push(rampReimbursementByUserAliasPath(user, row.id, row.title));
      if (state) aliasPaths.push(rampReimbursementByStateAliasPath(state, row.id, row.title));
      return aliasPaths;
    }
    case 'receipts': {
      const receipt = record as RampReceiptRecord;
      const transactionId = readString(receipt.transaction_id);
      const reimbursementId = readString(receipt.reimbursement_id);
      if (transactionId) aliasPaths.push(rampReceiptByTransactionAliasPath(transactionId, row.id, row.title));
      if (reimbursementId) aliasPaths.push(rampReceiptByReimbursementAliasPath(reimbursementId, row.id, row.title));
      return aliasPaths;
    }
    case 'vendors': {
      const vendor = record as RampVendorRecord;
      const name = readString(vendor.name);
      if (name) aliasPaths.push(rampVendorByNameAliasPath(name, row.id, row.title));
      return aliasPaths;
    }
    case 'dimensions/users': {
      const user = record as RampDimensionRecord;
      const email = readString(user.email);
      if (email) aliasPaths.push(rampDimensionUserByEmailAliasPath(email, row.id, row.title));
      return aliasPaths;
    }
    default:
      return aliasPaths;
  }
}

export function rampTitle(resource: RampCanonicalResource, record: RampBaseRecord): string {
  switch (resource) {
    case 'bills':
      return readString((record as RampBillRecord).invoice_number)
        ?? readString((record as RampBillRecord).vendor?.name)
        ?? `bill ${record.id}`;
    case 'purchase-orders':
      return readString((record as RampPurchaseOrderRecord).purchase_order_number)
        ?? readString((record as RampPurchaseOrderRecord).name)
        ?? `purchase-order ${record.id}`;
    case 'item-receipts':
      return readString((record as RampItemReceiptRecord).item_receipt_number)
        ?? `item-receipt ${record.id}`;
    case 'vendor-agreements':
      return readString((record as RampVendorAgreementRecord).name)
        ?? `vendor-agreement ${record.id}`;
    case 'transactions':
      return readString((record as RampTransactionRecord).merchant_name)
        ?? `transaction ${record.id}`;
    case 'reimbursements':
      return readString((record as RampReimbursementRecord).merchant)
        ?? readString((record as RampReimbursementRecord).user_full_name)
        ?? `reimbursement ${record.id}`;
    case 'receipts':
      return readString((record as RampReceiptRecord).transaction_id)
        ?? readString((record as RampReceiptRecord).reimbursement_id)
        ?? `receipt ${record.id}`;
    case 'vendors':
      return readString((record as RampVendorRecord).name)
        ?? `vendor ${record.id}`;
    case 'transfers':
      return readString(record.id)
        ? `transfer ${record.id}`
        : 'transfer';
    case 'repayments':
      return readString(record.id)
        ? `repayment ${record.id}`
        : 'repayment';
    case 'dimensions/users':
      return readString((record as RampDimensionRecord).email)
        ?? readString((record as RampDimensionRecord).name)
        ?? readString((record as RampDimensionRecord).display_name)
        ?? `user ${record.id}`;
    case 'dimensions/entities':
      return readString((record as RampDimensionRecord).name)
        ?? readString((record as RampDimensionRecord).display_name)
        ?? `entity ${record.id}`;
    case 'dimensions/departments':
      return readString((record as RampDimensionRecord).name)
        ?? readString((record as RampDimensionRecord).display_name)
        ?? `department ${record.id}`;
    case 'dimensions/locations':
      return readString((record as RampDimensionRecord).name)
        ?? readString((record as RampDimensionRecord).display_name)
        ?? `location ${record.id}`;
    case 'dimensions/merchants':
      return readString((record as RampDimensionRecord).name)
        ?? readString((record as RampDimensionRecord).display_name)
        ?? `merchant ${record.id}`;
    case 'dimensions/spend-programs':
      return readString((record as RampDimensionRecord).name)
        ?? readString((record as RampDimensionRecord).display_name)
        ?? `spend-program ${record.id}`;
    case 'accounting/accounts':
      return readString((record as RampAccountingAccountRecord).code)
        ?? readString((record as RampAccountingAccountRecord).name)
        ?? `account ${record.id}`;
    case 'accounting/fields':
      return readString((record as RampAccountingFieldRecord).field_name)
        ?? readString((record as RampAccountingFieldRecord).name)
        ?? `field ${record.id}`;
  }
}

export function rampUpdated(resource: RampCanonicalResource, record: RampBaseRecord): string {
  switch (resource) {
    case 'bills':
      return readString((record as RampBillRecord).paid_at)
        ?? readString((record as RampBillRecord).issued_at)
        ?? readString(record.created_at)
        ?? fallbackUpdatedAt();
    case 'purchase-orders':
      return readString((record as RampPurchaseOrderRecord).archived_at)
        ?? readString(record.created_at)
        ?? fallbackUpdatedAt();
    case 'item-receipts':
      return readString((record as RampItemReceiptRecord).archived_at)
        ?? readString((record as RampItemReceiptRecord).received_at)
        ?? readString(record.created_at)
        ?? fallbackUpdatedAt();
    case 'vendor-agreements':
      return readString(record.updated_at)
        ?? readString(record.created_at)
        ?? fallbackUpdatedAt();
    case 'transactions':
      return readString(record.updated_at)
        ?? readString((record as RampTransactionRecord).settlement_date)
        ?? readString((record as RampTransactionRecord).user_transaction_time)
        ?? readString(record.created_at)
        ?? fallbackUpdatedAt();
    case 'reimbursements':
      return readString(record.updated_at)
        ?? readString((record as RampReimbursementRecord).submitted_at)
        ?? readString(record.created_at)
        ?? fallbackUpdatedAt();
    case 'vendors':
      return readString(record.updated_at)
        ?? readString(record.created_at)
        ?? fallbackUpdatedAt();
    case 'receipts':
      return readString(record.created_at)
        ?? fallbackUpdatedAt();
    default:
      return readString(record.updated_at)
        ?? readString(record.created_at)
        ?? fallbackUpdatedAt();
  }
}

function compactRow(row: RampIndexRow): RampIndexRow {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined && value !== null),
  ) as RampIndexRow;
}

function readScalar(value: unknown): number | string | undefined {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function fallbackUpdatedAt(): string {
  return FALLBACK_UPDATED_AT;
}

function parseUpdatedAt(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
