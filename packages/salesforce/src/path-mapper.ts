export const SALESFORCE_PATH_ROOT = '/salesforce';

export const SALESFORCE_PATH_OBJECT_TYPES = [
  'Account',
  'Contact',
  'Opportunity',
  'Lead',
  'Case',
] as const;

export type SalesforcePathObjectType = (typeof SALESFORCE_PATH_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, SalesforcePathObjectType>> = {
  account: 'Account',
  accounts: 'Account',
  salesforceaccount: 'Account',
  contact: 'Contact',
  contacts: 'Contact',
  salesforcecontact: 'Contact',
  opportunity: 'Opportunity',
  opportunities: 'Opportunity',
  salesforceopportunity: 'Opportunity',
  lead: 'Lead',
  leads: 'Lead',
  salesforcelead: 'Lead',
  case: 'Case',
  cases: 'Case',
  salesforcecase: 'Case',
};

const NANGO_MODEL_MAP: Readonly<Record<string, SalesforcePathObjectType>> = {
  SalesforceAccount: 'Account',
  SalesforceContact: 'Contact',
  SalesforceOpportunity: 'Opportunity',
  SalesforceLead: 'Lead',
  SalesforceCase: 'Case',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Salesforce ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeSalesforcePathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function decodeSalesforcePathSegment(value: string): string {
  const decoded = decodeURIComponent(assertNonEmptySegment(value, 'path segment'));
  return assertNonEmptySegment(decoded, 'path segment');
}

export function normalizeSalesforceObjectType(objectType: string): SalesforcePathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[^a-z]/g, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Salesforce object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeSalesforceObjectType(objectType: string): SalesforcePathObjectType | undefined {
  try {
    return normalizeSalesforceObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoSalesforceModel(model: string): SalesforcePathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeSalesforceObjectType(model);
}

export function salesforceAccountPath(accountId: string): string {
  return `${SALESFORCE_PATH_ROOT}/accounts/${encodeSalesforcePathSegment(accountId)}.json`;
}

export function salesforceContactPath(contactId: string): string {
  return `${SALESFORCE_PATH_ROOT}/contacts/${encodeSalesforcePathSegment(contactId)}.json`;
}

export function salesforceOpportunityPath(opportunityId: string): string {
  return `${SALESFORCE_PATH_ROOT}/opportunities/${encodeSalesforcePathSegment(opportunityId)}.json`;
}

export function salesforceLeadPath(leadId: string): string {
  return `${SALESFORCE_PATH_ROOT}/leads/${encodeSalesforcePathSegment(leadId)}.json`;
}

export function salesforceCasePath(caseId: string): string {
  return `${SALESFORCE_PATH_ROOT}/cases/${encodeSalesforcePathSegment(caseId)}.json`;
}

export function salesforceCollectionPath(objectType: string): string {
  switch (normalizeSalesforceObjectType(objectType)) {
    case 'Account':
      return `${SALESFORCE_PATH_ROOT}/accounts`;
    case 'Contact':
      return `${SALESFORCE_PATH_ROOT}/contacts`;
    case 'Opportunity':
      return `${SALESFORCE_PATH_ROOT}/opportunities`;
    case 'Lead':
      return `${SALESFORCE_PATH_ROOT}/leads`;
    case 'Case':
      return `${SALESFORCE_PATH_ROOT}/cases`;
  }
}

export function computeSalesforcePath(objectType: string, objectId: string): string {
  const normalizedType = normalizeSalesforceObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'Account':
      return salesforceAccountPath(normalizedId);
    case 'Contact':
      return salesforceContactPath(normalizedId);
    case 'Opportunity':
      return salesforceOpportunityPath(normalizedId);
    case 'Lead':
      return salesforceLeadPath(normalizedId);
    case 'Case':
      return salesforceCasePath(normalizedId);
  }
}

export function pathObjectTypeFromCollection(collection: string): SalesforcePathObjectType | undefined {
  switch (collection) {
    case 'accounts':
      return 'Account';
    case 'contacts':
      return 'Contact';
    case 'opportunities':
      return 'Opportunity';
    case 'leads':
      return 'Lead';
    case 'cases':
      return 'Case';
    default:
      return undefined;
  }
}
