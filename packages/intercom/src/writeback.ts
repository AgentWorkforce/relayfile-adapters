import type { IntercomWritebackRequest, JsonValue } from './types.js';

const INTERCOM_CONVERSATIONS_ROUTE = '/conversations';
const INTERCOM_CONTACTS_ROUTE = '/contacts';
const INTERCOM_COMPANIES_ROUTE = '/companies';

export function resolveWritebackRequest(path: string, content: string): IntercomWritebackRequest {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === '/intercom/conversations/new.json' || normalizedPath === '/intercom/conversations/') {
    return {
      action: 'create_conversation',
      method: 'POST',
      endpoint: INTERCOM_CONVERSATIONS_ROUTE,
      body: parseJsonObject(content),
    };
  }

  const replyMatch = normalizedPath.match(/^\/intercom\/conversations\/([^/]+)\/reply\.json$/);
  if (replyMatch?.[1]) {
    return {
      action: 'reply_conversation',
      method: 'POST',
      endpoint: `${INTERCOM_CONVERSATIONS_ROUTE}/${decodeSegment(replyMatch[1])}/reply`,
      body: parseJsonObject(content),
    };
  }

  const conversationMatch = normalizedPath.match(/^\/intercom\/conversations\/([^/]+)\.json$/);
  if (conversationMatch?.[1]) {
    return {
      action: 'update_conversation',
      // Use PUT for updates to conform with Intercom API expectations
      method: 'PUT',
      endpoint: `${INTERCOM_CONVERSATIONS_ROUTE}/${decodeSegment(conversationMatch[1])}`,
      body: unwrapSyncedEnvelope(content),
    };
  }

  if (normalizedPath === '/intercom/contacts/new.json' || normalizedPath === '/intercom/contacts/') {
    return {
      action: 'create_contact',
      method: 'POST',
      endpoint: INTERCOM_CONTACTS_ROUTE,
      body: parseJsonObject(content),
    };
  }

  const contactMatch = normalizedPath.match(/^\/intercom\/contacts\/([^/]+)\.json$/);
  if (contactMatch?.[1]) {
    return {
      action: 'update_contact',
      method: 'PUT',
      endpoint: `${INTERCOM_CONTACTS_ROUTE}/${decodeSegment(contactMatch[1])}`,
      body: unwrapSyncedEnvelope(content),
    };
  }

  if (normalizedPath === '/intercom/companies/new.json' || normalizedPath === '/intercom/companies/') {
    return {
      action: 'create_company',
      method: 'POST',
      endpoint: INTERCOM_COMPANIES_ROUTE,
      body: parseJsonObject(content),
    };
  }

  const companyMatch = normalizedPath.match(/^\/intercom\/companies\/([^/]+)\.json$/);
  if (companyMatch?.[1]) {
    return {
      action: 'update_company',
      // Upsert of a company is performed via POST /companies keyed by company_id
      method: 'POST',
      endpoint: `${INTERCOM_COMPANIES_ROUTE}`,
      body: unwrapSyncedEnvelope(content),
    };
  }

  throw new Error(`No Intercom writeback rule matched ${path}`);
}

function unwrapSyncedEnvelope(content: string): Record<string, unknown> {
  const parsed = parseJsonObject(content);
  if (isRecord(parsed.payload) && looksLikeSyncedEnvelope(parsed)) {
    return parsed.payload;
  }
  return parsed;
}

function looksLikeSyncedEnvelope(payload: Record<string, unknown>): boolean {
  return (
    payload.provider === 'intercom' ||
    payload.objectType === 'conversation' ||
    payload.objectType === 'contact' ||
    payload.objectType === 'company'
  );
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function safeParseJson(content: string): JsonValue | string {
  try {
    return JSON.parse(content) as JsonValue;
  } catch {
    return content.trim();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function decodeSegment(segment: string): string {
  return decodeURIComponent(segment);
}
