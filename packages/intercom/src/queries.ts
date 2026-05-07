import type { IntercomReadRequest } from './types.js';

export const INTERCOM_CONVERSATIONS_ROUTE = '/conversations';
export const INTERCOM_CONTACTS_ROUTE = '/contacts';
export const INTERCOM_COMPANIES_ROUTE = '/companies';

const CONVERSATION_COLLECTION_PATHS = new Set([
  '/intercom/conversations.json',
  '/intercom/conversations/',
]);

const CONTACT_COLLECTION_PATHS = new Set([
  '/intercom/contacts.json',
  '/intercom/contacts/',
]);

const COMPANY_COLLECTION_PATHS = new Set([
  '/intercom/companies.json',
  '/intercom/companies/',
]);

export function resolveReadRequest(path: string): IntercomReadRequest {
  const normalizedPath = normalizePath(path);

  if (CONVERSATION_COLLECTION_PATHS.has(normalizedPath)) {
    return {
      action: 'list_conversations',
      method: 'GET',
      endpoint: INTERCOM_CONVERSATIONS_ROUTE,
    };
  }

  if (CONTACT_COLLECTION_PATHS.has(normalizedPath)) {
    return {
      action: 'list_contacts',
      method: 'GET',
      endpoint: INTERCOM_CONTACTS_ROUTE,
    };
  }

  if (COMPANY_COLLECTION_PATHS.has(normalizedPath)) {
    return {
      action: 'list_companies',
      method: 'GET',
      endpoint: INTERCOM_COMPANIES_ROUTE,
    };
  }

  const conversationMatch = normalizedPath.match(/^\/intercom\/conversations\/([^/]+)\.json$/);
  if (conversationMatch?.[1]) {
    const conversationId = encodeURIComponent(decodeSegment(conversationMatch[1]));
    return {
      action: 'get_conversation',
      method: 'GET',
      endpoint: `${INTERCOM_CONVERSATIONS_ROUTE}/${conversationId}`,
    };
  }

  const contactMatch = normalizedPath.match(/^\/intercom\/contacts\/([^/]+)\.json$/);
  if (contactMatch?.[1]) {
    const contactId = encodeURIComponent(decodeSegment(contactMatch[1]));
    return {
      action: 'get_contact',
      method: 'GET',
      endpoint: `${INTERCOM_CONTACTS_ROUTE}/${contactId}`,
    };
  }

  const companyMatch = normalizedPath.match(/^\/intercom\/companies\/([^/]+)\.json$/);
  if (companyMatch?.[1]) {
    const companyId = encodeURIComponent(decodeSegment(companyMatch[1]));
    return {
      action: 'get_company',
      method: 'GET',
      endpoint: `${INTERCOM_COMPANIES_ROUTE}/${companyId}`,
    };
  }

  throw new Error(`No Intercom read rule matched ${path}`);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed;
}

function decodeSegment(segment: string): string {
  return decodeURIComponent(segment);
}
