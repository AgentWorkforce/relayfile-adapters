import { decodeSalesforcePathSegment, pathObjectTypeFromCollection } from './path-mapper.js';
import type { SalesforceWritebackRequest } from './types.js';

export const SALESFORCE_ACCOUNT_WRITEBACK_ROUTE = '/services/data/v62.0/sobjects/Account';
export const SALESFORCE_CONTACT_WRITEBACK_ROUTE = '/services/data/v62.0/sobjects/Contact';
export const SALESFORCE_OPPORTUNITY_WRITEBACK_ROUTE = '/services/data/v62.0/sobjects/Opportunity';
export const SALESFORCE_LEAD_WRITEBACK_ROUTE = '/services/data/v62.0/sobjects/Lead';
export const SALESFORCE_CASE_WRITEBACK_ROUTE = '/services/data/v62.0/sobjects/Case';

const ROUTES = {
  Account: SALESFORCE_ACCOUNT_WRITEBACK_ROUTE,
  Contact: SALESFORCE_CONTACT_WRITEBACK_ROUTE,
  Opportunity: SALESFORCE_OPPORTUNITY_WRITEBACK_ROUTE,
  Lead: SALESFORCE_LEAD_WRITEBACK_ROUTE,
  Case: SALESFORCE_CASE_WRITEBACK_ROUTE,
} as const;

const CREATE_ACTIONS = {
  Account: 'create_account',
  Contact: 'create_contact',
  Opportunity: 'create_opportunity',
  Lead: 'create_lead',
  Case: 'create_case',
} as const;

const UPDATE_ACTIONS = {
  Account: 'update_account',
  Contact: 'update_contact',
  Opportunity: 'update_opportunity',
  Lead: 'update_lead',
  Case: 'update_case',
} as const;

const REPLACE_ACTIONS = {
  Account: 'replace_account',
  Contact: 'replace_contact',
  Opportunity: 'replace_opportunity',
  Lead: 'replace_lead',
  Case: 'replace_case',
} as const;

export function resolveWritebackRequest(
  path: string,
  content: string,
  method: 'PATCH' | 'POST' | 'PUT' = 'PATCH',
): SalesforceWritebackRequest {
  const normalizedPath = normalizePath(path);
  const newMatch = normalizedPath.match(/^\/salesforce\/([^/]+)\/new\.json$/);
  if (newMatch?.[1]) {
    const objectType = pathObjectTypeFromCollection(newMatch[1]);
    if (!objectType) {
      throw new Error(`No Salesforce writeback rule matched ${path}`);
    }
    return {
      action: CREATE_ACTIONS[objectType],
      method: 'POST',
      endpoint: ROUTES[objectType],
      body: parseJsonObject(content),
    };
  }

  const itemMatch = normalizedPath.match(/^\/salesforce\/([^/]+)\/([^/]+)\.json$/);
  if (itemMatch?.[1] && itemMatch[2]) {
    const objectType = pathObjectTypeFromCollection(itemMatch[1]);
    if (!objectType) {
      throw new Error(`No Salesforce writeback rule matched ${path}`);
    }
    const objectId = decodeSalesforcePathSegment(itemMatch[2]);
    const writeMethod = method === 'PUT' ? 'PUT' : 'PATCH';
    return {
      action: writeMethod === 'PUT' ? REPLACE_ACTIONS[objectType] : UPDATE_ACTIONS[objectType],
      method: writeMethod,
      endpoint: `${ROUTES[objectType]}/${encodeURIComponent(objectId)}`,
      body: unwrapSyncedEnvelope(parseJsonObject(content)),
    };
  }

  throw new Error(`No Salesforce writeback rule matched ${path}`);
}

function unwrapSyncedEnvelope(payload: Record<string, unknown>): Record<string, unknown> {
  if (
    isRecord(payload.payload) &&
    payload.provider === 'salesforce' &&
    typeof payload.objectType === 'string' &&
    typeof payload.objectId === 'string'
  ) {
    return payload.payload;
  }
  return payload;
}

function parseJsonObject(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Salesforce writeback content must be JSON: ${toErrorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('Salesforce writeback content must be a JSON object');
  }
  return parsed;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('Salesforce writeback path must be a non-empty string');
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
