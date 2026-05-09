import { ReadOnlyFieldError } from '@relayfile/adapter-core';
import { resources, type AdapterResourceConfig } from './resources.js';
import type { IntercomWritebackRequest, JsonValue } from './types.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

const INTERCOM_CONVERSATIONS_ROUTE = '/conversations';
const INTERCOM_CONTACTS_ROUTE = '/contacts';
const INTERCOM_COMPANIES_ROUTE = '/companies';

export function resolveWritebackRequest(path: string, content: string): IntercomWritebackRequest {
  const normalizedPath = normalizePath(path);

  const conversationFile = matchResourceFile(normalizedPath, '/intercom/conversations');
  if (conversationFile && !conversationFile.canonical) {
    return {
      action: 'create_conversation',
      method: 'POST',
      endpoint: INTERCOM_CONVERSATIONS_ROUTE,
      body: readWritablePayload(content),
    };
  }

  const replyMatch = normalizedPath.match(/^\/intercom\/conversations\/([^/]+)\/reply\.json$/);
  if (replyMatch?.[1]) {
    return {
      action: 'reply_conversation',
      method: 'POST',
      endpoint: `${INTERCOM_CONVERSATIONS_ROUTE}/${replyMatch[1]}/reply`,
      body: readWritablePayload(content),
    };
  }

  const conversationMatch = normalizedPath.match(/^\/intercom\/conversations\/([^/]+)\.json$/);
  if (conversationMatch?.[1]) {
    return {
      action: 'update_conversation',
      // Use PUT for updates to conform with Intercom API expectations
      method: 'PUT',
      endpoint: `${INTERCOM_CONVERSATIONS_ROUTE}/${conversationMatch[1]}`,
      body: readWritablePayload(content),
    };
  }

  const contactFile = matchResourceFile(normalizedPath, '/intercom/contacts');
  if (contactFile && !contactFile.canonical) {
    return {
      action: 'create_contact',
      method: 'POST',
      endpoint: INTERCOM_CONTACTS_ROUTE,
      body: readWritablePayload(content),
    };
  }

  const contactMatch = normalizedPath.match(/^\/intercom\/contacts\/([^/]+)\.json$/);
  if (contactMatch?.[1]) {
    return {
      action: 'update_contact',
      method: 'PUT',
      endpoint: `${INTERCOM_CONTACTS_ROUTE}/${contactMatch[1]}`,
      body: readWritablePayload(content),
    };
  }

  const companyFile = matchResourceFile(normalizedPath, '/intercom/companies');
  if (companyFile && !companyFile.canonical) {
    return {
      action: 'create_company',
      method: 'POST',
      endpoint: INTERCOM_COMPANIES_ROUTE,
      body: readWritablePayload(content),
    };
  }

  const companyMatch = normalizedPath.match(/^\/intercom\/companies\/([^/]+)\.json$/);
  if (companyMatch?.[1]) {
    return {
      action: 'update_company',
      // Upsert of a company is performed via POST /companies keyed by company_id
      method: 'POST',
      endpoint: `${INTERCOM_COMPANIES_ROUTE}`,
      body: readWritablePayload(content),
    };
  }

  throw new Error(`No Intercom writeback rule matched ${path}`);
}

export function resolveDeleteRequest(path: string): IntercomWritebackRequest {
  const normalizedPath = normalizePath(path);

  const conversationMatch = normalizedPath.match(/^\/intercom\/conversations\/([^/]+)\.json$/);
  if (conversationMatch?.[1] && matchResourceFile(normalizedPath, '/intercom/conversations')?.canonical) {
    return {
      action: 'delete_conversation',
      method: 'DELETE',
      endpoint: `${INTERCOM_CONVERSATIONS_ROUTE}/${conversationMatch[1]}`,
    };
  }

  const contactMatch = normalizedPath.match(/^\/intercom\/contacts\/([^/]+)\.json$/);
  if (contactMatch?.[1] && matchResourceFile(normalizedPath, '/intercom/contacts')?.canonical) {
    return {
      action: 'delete_contact',
      method: 'DELETE',
      endpoint: `${INTERCOM_CONTACTS_ROUTE}/${contactMatch[1]}`,
    };
  }

  const companyMatch = normalizedPath.match(/^\/intercom\/companies\/([^/]+)\.json$/);
  if (companyMatch?.[1] && matchResourceFile(normalizedPath, '/intercom/companies')?.canonical) {
    return {
      action: 'delete_company',
      method: 'DELETE',
      endpoint: `${INTERCOM_COMPANIES_ROUTE}/${companyMatch[1]}`,
    };
  }

  throw new Error(`No Intercom delete writeback rule matched ${path}`);
}

function readWritablePayload(content: string): Record<string, unknown> {
  const payload = unwrapSyncedEnvelope(content);
  rejectReadOnlyFields(payload);
  return payload;
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

const READ_ONLY_FIELDS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
  'url',
  'identifier',
  'provider',
  'objectType',
  'objectId',
  'workspaceId',
  'connectionId',
  '_webhook',
  '_connection',
]);

function rejectReadOnlyFields(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
  }
}

function matchResourceFile(path: string, resourcePath: string): { canonical: boolean; id: string } | undefined {
  const resource = resources.find((candidate) => candidate.path === resourcePath);
  if (!resource) {
    return undefined;
  }
  return matchFile(path, resource);
}

function matchFile(path: string, resource: AdapterResourceConfig): { canonical: boolean; id: string } | undefined {
  const normalized = normalizePath(path);
  if (!normalized.endsWith('.json') || !resource.pathPattern.test(normalized)) {
    return undefined;
  }
  const id = decodeURIComponent(normalized.slice(normalized.lastIndexOf('/') + 1, -'.json'.length));
  return { canonical: resource.idPattern.test(id), id };
}
