export const RAMP_PROVIDER = 'ramp';
export const RAMP_PATH_ROOT = '/ramp';
export const RAMP_SIGNATURE_HEADER = 'x-ramp-signature';
export const RAMP_HOOKDECK_DELIVERY_HEADER = 'x-hookdeck-eventid';

export const RAMP_PROVIDER_CONFIG_ALIASES = [
  'ramp-relay',
  'ramp-sandbox-relay',
  'ramp',
] as const;

export const RAMP_DIRECTORY_RESOURCES = [
  'bills',
  'purchase-orders',
  'item-receipts',
  'vendor-agreements',
] as const;

export const RAMP_FLAT_RESOURCES = [
  'transactions',
  'reimbursements',
  'receipts',
  'vendors',
  'transfers',
  'repayments',
  'dimensions/entities',
  'dimensions/users',
  'dimensions/departments',
  'dimensions/locations',
  'dimensions/merchants',
  'dimensions/spend-programs',
  'accounting/accounts',
  'accounting/fields',
] as const;

export const RAMP_CANONICAL_RESOURCES = [
  ...RAMP_DIRECTORY_RESOURCES,
  ...RAMP_FLAT_RESOURCES,
] as const;

export type RampDirectoryResource = (typeof RAMP_DIRECTORY_RESOURCES)[number];
export type RampFlatResource = (typeof RAMP_FLAT_RESOURCES)[number];
export type RampCanonicalResource = (typeof RAMP_CANONICAL_RESOURCES)[number];

export interface RampBaseRecord {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface RampBusinessRecord extends RampBaseRecord {
  business_id?: string | null;
  legal_name?: string | null;
  display_name?: string | null;
}

export interface RampBillRecord extends RampBaseRecord {
  invoice_number?: string | null;
  vendor?: { id?: string | null; name?: string | null } | null;
  status?: string | null;
  sync_status?: string | null;
  approval_status?: string | null;
  amount?: number | string | null;
  paid_at?: string | null;
  issued_at?: string | null;
}

export interface RampPurchaseOrderRecord extends RampBaseRecord {
  purchase_order_number?: string | null;
  name?: string | null;
  archived_at?: string | null;
  receipt_status?: string | null;
  billing_status?: string | null;
  vendor_id?: string | null;
  vendor?: { id?: string | null; name?: string | null } | null;
}

export interface RampItemReceiptRecord extends RampBaseRecord {
  item_receipt_number?: string | null;
  purchase_order_id?: string | null;
  archived_at?: string | null;
  received_at?: string | null;
}

export interface RampVendorAgreementRecord extends RampBaseRecord {
  name?: string | null;
  created_at?: string | null;
  renewal_status?: string | null;
}

export interface RampTransactionRecord extends RampBaseRecord {
  merchant_name?: string | null;
  merchant_id?: string | null;
  state?: string | null;
  sync_status?: string | null;
  amount?: number | string | null;
  card_holder?: { user_id?: string | null; user_email?: string | null } | null;
  entity_id?: string | null;
  settlement_date?: string | null;
  user_transaction_time?: string | null;
}

export interface RampReimbursementRecord extends RampBaseRecord {
  merchant?: string | null;
  user_full_name?: string | null;
  user_id?: string | null;
  user_email?: string | null;
  state?: string | null;
  sync_status?: string | null;
  submitted_at?: string | null;
}

export interface RampReceiptRecord extends RampBaseRecord {
  transaction_id?: string | null;
  reimbursement_id?: string | null;
}

export interface RampVendorRecord extends RampBaseRecord {
  name?: string | null;
}

export interface RampTransferRecord extends RampBaseRecord {
  type?: string | null;
  status?: string | null;
}

export interface RampRepaymentRecord extends RampBaseRecord {
  status?: string | null;
}

export interface RampDimensionRecord extends RampBaseRecord {
  name?: string | null;
  display_name?: string | null;
  email?: string | null;
}

export interface RampAccountingAccountRecord extends RampBaseRecord {
  name?: string | null;
  code?: string | null;
}

export interface RampAccountingFieldRecord extends RampBaseRecord {
  name?: string | null;
  field_name?: string | null;
}

export type RampDeleteRecord = {
  id: string;
  _deleted: true;
};

export interface RampIndexRow {
  id: string;
  title: string;
  updated: string;
  canonicalPath: string;
  [key: string]: unknown;
}

export interface RampRootIndexRow {
  id: string;
  title: string;
}

export interface RampAliasPointer {
  provider: typeof RAMP_PROVIDER;
  resource: string;
  objectId: string;
  canonicalPath: string;
  title: string;
  updated: string;
  aliasPaths: string[];
  payload?: Record<string, unknown>;
  connectionId?: string;
}

export interface RampWebhookObjectRef {
  id?: string | null;
  [key: string]: unknown;
}

export interface RampWebhookPayload extends Record<string, unknown> {
  id?: string | null;
  type?: string | null;
  event_type?: string | null;
  created_at?: string | null;
  business_id?: string | null;
  object_id?: string | null;
  object?: RampWebhookObjectRef | null;
  webhook_id?: string | null;
  challenge?: string | null;
}
