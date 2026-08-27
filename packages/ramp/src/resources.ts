export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
  readonly sampleIndexPath?: string;
}

export const readOnlyResources = [
  {
    name: 'business',
    path: '/ramp/business.json',
    pathPattern: /^\/ramp\/business\.json$/u,
    idPattern: /^business$/u,
    schema: 'discovery/ramp/business/.schema.json',
    createExample: 'discovery/ramp/business/.create.example.json',
  },
  {
    name: 'bills',
    path: '/ramp/bills/{billId}/meta.json',
    pathPattern: /^\/ramp\/bills\/[^/]+\/meta\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/bills/.schema.json',
    createExample: 'discovery/ramp/bills/.create.example.json',
    sampleIndexPath: '/ramp/bills/_index.json',
  },
  {
    name: 'purchase-orders',
    path: '/ramp/purchase-orders/{purchaseOrderId}/meta.json',
    pathPattern: /^\/ramp\/purchase-orders\/[^/]+\/meta\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/purchase-orders/.schema.json',
    createExample: 'discovery/ramp/purchase-orders/.create.example.json',
    sampleIndexPath: '/ramp/purchase-orders/_index.json',
  },
  {
    name: 'item-receipts',
    path: '/ramp/item-receipts/{itemReceiptId}/meta.json',
    pathPattern: /^\/ramp\/item-receipts\/[^/]+\/meta\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/item-receipts/.schema.json',
    createExample: 'discovery/ramp/item-receipts/.create.example.json',
    sampleIndexPath: '/ramp/item-receipts/_index.json',
  },
  {
    name: 'vendor-agreements',
    path: '/ramp/vendor-agreements/{agreementId}/meta.json',
    pathPattern: /^\/ramp\/vendor-agreements\/[^/]+\/meta\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/vendor-agreements/.schema.json',
    createExample: 'discovery/ramp/vendor-agreements/.create.example.json',
    sampleIndexPath: '/ramp/vendor-agreements/_index.json',
  },
  {
    name: 'transactions',
    path: '/ramp/transactions/{transactionId}.json',
    pathPattern: /^\/ramp\/transactions\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/transactions/.schema.json',
    createExample: 'discovery/ramp/transactions/.create.example.json',
    sampleIndexPath: '/ramp/transactions/_index.json',
  },
  {
    name: 'reimbursements',
    path: '/ramp/reimbursements/{reimbursementId}.json',
    pathPattern: /^\/ramp\/reimbursements\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/reimbursements/.schema.json',
    createExample: 'discovery/ramp/reimbursements/.create.example.json',
    sampleIndexPath: '/ramp/reimbursements/_index.json',
  },
  {
    name: 'receipts',
    path: '/ramp/receipts/{receiptId}.json',
    pathPattern: /^\/ramp\/receipts\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/receipts/.schema.json',
    createExample: 'discovery/ramp/receipts/.create.example.json',
    sampleIndexPath: '/ramp/receipts/_index.json',
  },
  {
    name: 'vendors',
    path: '/ramp/vendors/{vendorId}.json',
    pathPattern: /^\/ramp\/vendors\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/vendors/.schema.json',
    createExample: 'discovery/ramp/vendors/.create.example.json',
    sampleIndexPath: '/ramp/vendors/_index.json',
  },
  {
    name: 'transfers',
    path: '/ramp/transfers/{transferId}.json',
    pathPattern: /^\/ramp\/transfers\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/transfers/.schema.json',
    createExample: 'discovery/ramp/transfers/.create.example.json',
    sampleIndexPath: '/ramp/transfers/_index.json',
  },
  {
    name: 'repayments',
    path: '/ramp/repayments/{repaymentId}.json',
    pathPattern: /^\/ramp\/repayments\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/repayments/.schema.json',
    createExample: 'discovery/ramp/repayments/.create.example.json',
    sampleIndexPath: '/ramp/repayments/_index.json',
  },
  {
    name: 'entities',
    path: '/ramp/dimensions/entities/{entityId}.json',
    pathPattern: /^\/ramp\/dimensions\/entities\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/entities/.schema.json',
    createExample: 'discovery/ramp/entities/.create.example.json',
    sampleIndexPath: '/ramp/dimensions/entities/_index.json',
  },
  {
    name: 'users',
    path: '/ramp/dimensions/users/{userId}.json',
    pathPattern: /^\/ramp\/dimensions\/users\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/users/.schema.json',
    createExample: 'discovery/ramp/users/.create.example.json',
    sampleIndexPath: '/ramp/dimensions/users/_index.json',
  },
  {
    name: 'departments',
    path: '/ramp/dimensions/departments/{departmentId}.json',
    pathPattern: /^\/ramp\/dimensions\/departments\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/departments/.schema.json',
    createExample: 'discovery/ramp/departments/.create.example.json',
    sampleIndexPath: '/ramp/dimensions/departments/_index.json',
  },
  {
    name: 'locations',
    path: '/ramp/dimensions/locations/{locationId}.json',
    pathPattern: /^\/ramp\/dimensions\/locations\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/locations/.schema.json',
    createExample: 'discovery/ramp/locations/.create.example.json',
    sampleIndexPath: '/ramp/dimensions/locations/_index.json',
  },
  {
    name: 'merchants',
    path: '/ramp/dimensions/merchants/{merchantId}.json',
    pathPattern: /^\/ramp\/dimensions\/merchants\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/merchants/.schema.json',
    createExample: 'discovery/ramp/merchants/.create.example.json',
    sampleIndexPath: '/ramp/dimensions/merchants/_index.json',
  },
  {
    name: 'spend-programs',
    path: '/ramp/dimensions/spend-programs/{spendProgramId}.json',
    pathPattern: /^\/ramp\/dimensions\/spend-programs\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/spend-programs/.schema.json',
    createExample: 'discovery/ramp/spend-programs/.create.example.json',
    sampleIndexPath: '/ramp/dimensions/spend-programs/_index.json',
  },
  {
    name: 'accounting-accounts',
    path: '/ramp/accounting/accounts/{glAccountId}.json',
    pathPattern: /^\/ramp\/accounting\/accounts\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/accounting-accounts/.schema.json',
    createExample: 'discovery/ramp/accounting-accounts/.create.example.json',
    sampleIndexPath: '/ramp/accounting/accounts/_index.json',
  },
  {
    name: 'accounting-fields',
    path: '/ramp/accounting/fields/{fieldId}.json',
    pathPattern: /^\/ramp\/accounting\/fields\/[^/]+\.json$/u,
    idPattern: /^[^/]+$/u,
    schema: 'discovery/ramp/accounting-fields/.schema.json',
    createExample: 'discovery/ramp/accounting-fields/.create.example.json',
    sampleIndexPath: '/ramp/accounting/fields/_index.json',
  },
] as const satisfies readonly AdapterResourceConfig[];

// Ramp is still read-only for writeback operations, but Cloud needs the
// resource catalog populated so discovery, layout, and auxiliary files stay
// aligned with the synced/webhook-mounted surface.
export const resources = readOnlyResources;

export function findResourceByPath(_path: string): AdapterResourceConfig | undefined {
  const normalizedPath = _path.endsWith('.json')
    ? _path
    : _path.replace(/\/$/u, '');
  return readOnlyResources.find((resource) => resource.pathPattern.test(normalizedPath));
}
