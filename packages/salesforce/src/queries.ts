import { decodeSalesforcePathSegment, pathObjectTypeFromCollection } from './path-mapper.js';
import type { SalesforceQueryRequest } from './types.js';

export const SALESFORCE_API_VERSION = 'v59.0';
export const SALESFORCE_ACCOUNT_ROUTE = '/services/data/v59.0/sobjects/Account';
export const SALESFORCE_CONTACT_ROUTE = '/services/data/v59.0/sobjects/Contact';
export const SALESFORCE_OPPORTUNITY_ROUTE = '/services/data/v59.0/sobjects/Opportunity';
export const SALESFORCE_LEAD_ROUTE = '/services/data/v59.0/sobjects/Lead';
export const SALESFORCE_CASE_ROUTE = '/services/data/v59.0/sobjects/Case';
// Salesforce REST: collection reads must go through SOQL via /query, not the
// sObject metadata route. The metadata route describes the object schema and
// returns no records.
export const SALESFORCE_QUERY_ROUTE = '/services/data/v59.0/query';

const SOQL_LIST_BY_OBJECT = {
  Account: 'SELECT Id, Name FROM Account',
  Contact: 'SELECT Id, FirstName, LastName, Email FROM Contact',
  Opportunity: 'SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity',
  Lead: 'SELECT Id, FirstName, LastName, Company, Status FROM Lead',
  Case: 'SELECT Id, CaseNumber, Subject, Status FROM Case',
} as const;

const COLLECTION_ACTIONS = {
  Account: 'list_accounts',
  Contact: 'list_contacts',
  Opportunity: 'list_opportunities',
  Lead: 'list_leads',
  Case: 'list_cases',
} as const;

const GET_ACTIONS = {
  Account: 'get_account',
  Contact: 'get_contact',
  Opportunity: 'get_opportunity',
  Lead: 'get_lead',
  Case: 'get_case',
} as const;

const ROUTES = {
  Account: SALESFORCE_ACCOUNT_ROUTE,
  Contact: SALESFORCE_CONTACT_ROUTE,
  Opportunity: SALESFORCE_OPPORTUNITY_ROUTE,
  Lead: SALESFORCE_LEAD_ROUTE,
  Case: SALESFORCE_CASE_ROUTE,
} as const;

export function resolveReadRequest(path: string): SalesforceQueryRequest {
  const normalizedPath = normalizePath(path);
  const itemMatch = normalizedPath.match(/^\/salesforce\/([^/]+)\/([^/]+)\.json$/);
  if (itemMatch?.[1] && itemMatch[2]) {
    const objectType = pathObjectTypeFromCollection(itemMatch[1]);
    if (!objectType) {
      throw new Error(`No Salesforce read route matched ${path}`);
    }
    const objectId = decodeSalesforcePathSegment(itemMatch[2]);
    return {
      action: GET_ACTIONS[objectType],
      method: 'GET',
      endpoint: `${ROUTES[objectType]}/${encodeURIComponent(objectId)}`,
    };
  }

  const collectionMatch = normalizedPath.match(/^\/salesforce\/([^/.]+)\/?$/);
  if (collectionMatch?.[1]) {
    const objectType = pathObjectTypeFromCollection(collectionMatch[1]);
    if (!objectType) {
      throw new Error(`No Salesforce read route matched ${path}`);
    }
    return {
      action: COLLECTION_ACTIONS[objectType],
      method: 'GET',
      endpoint: SALESFORCE_QUERY_ROUTE,
      query: { q: SOQL_LIST_BY_OBJECT[objectType] },
    };
  }

  throw new Error(`No Salesforce read route matched ${path}`);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('Salesforce read path must be a non-empty string');
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
