import { ReadOnlyFieldError } from '@relayfile/adapter-core';
import { extractPipedriveIdFromPathSegment } from './path-mapper.js';
import { resources, type AdapterResourceConfig } from './resources.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

export type PipedriveWritebackMethod = 'DELETE' | 'PATCH' | 'POST' | 'PUT';

export interface PipedriveWritebackRequest {
  action:
    | 'create_activity'
    | 'create_deal'
    | 'create_organization'
    | 'create_person'
    | 'delete_activity'
    | 'delete_deal'
    | 'delete_organization'
    | 'delete_person'
    | 'update_activity'
    | 'update_deal'
    | 'update_organization'
    | 'update_person';
  method: PipedriveWritebackMethod;
  endpoint: string;
  body?: Record<string, unknown>;
}

export const PIPEDRIVE_DEALS_WRITE_ROUTE = '/v1/deals';
export const PIPEDRIVE_PERSONS_WRITE_ROUTE = '/v1/persons';
export const PIPEDRIVE_ORGANIZATIONS_WRITE_ROUTE = '/v1/organizations';
export const PIPEDRIVE_ACTIVITY_WRITE_ROUTE = '/v1/activities';

const DEAL_MUTABLE_FIELDS = new Set([
  'title',
  'value',
  'currency',
  'status',
  'stage_id',
  'pipeline_id',
  'person_id',
  'org_id',
  'user_id',
  'expected_close_date',
  'probability',
  'label',
]);

const PERSON_MUTABLE_FIELDS = new Set([
  'name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'owner_id',
  'org_id',
  'visible_to',
]);

const ORGANIZATION_MUTABLE_FIELDS = new Set([
  'name',
  'owner_id',
  'address',
  'visible_to',
]);

const ACTIVITY_MUTABLE_FIELDS = new Set([
  'subject',
  'type',
  'done',
  'due_date',
  'due_time',
  'duration',
  'note',
  'deal_id',
  'person_id',
  'org_id',
  'user_id',
]);

export function resolvePipedriveWritebackRequest(path: string, content: string): PipedriveWritebackRequest {
  const normalized = normalizePath(path);

  if (isDraftResourcePath(normalized, '/pipedrive/deals')) {
    return createRequest('create_deal', PIPEDRIVE_DEALS_WRITE_ROUTE, pickCreateBody(parseJsonObject(content), DEAL_MUTABLE_FIELDS));
  }

  if (isDraftResourcePath(normalized, '/pipedrive/persons')) {
    return createRequest('create_person', PIPEDRIVE_PERSONS_WRITE_ROUTE, pickCreateBody(parseJsonObject(content), PERSON_MUTABLE_FIELDS));
  }

  if (isDraftResourcePath(normalized, '/pipedrive/organizations')) {
    return createRequest(
      'create_organization',
      PIPEDRIVE_ORGANIZATIONS_WRITE_ROUTE,
      pickCreateBody(parseJsonObject(content), ORGANIZATION_MUTABLE_FIELDS),
    );
  }

  if (isDraftResourcePath(normalized, '/pipedrive/activities')) {
    return createRequest(
      'create_activity',
      PIPEDRIVE_ACTIVITY_WRITE_ROUTE,
      pickCreateBody(parseJsonObject(content), ACTIVITY_MUTABLE_FIELDS),
    );
  }

  const dealMatch = normalized.match(/^\/pipedrive\/deals\/([^/]+)\.json$/u);
  if (dealMatch?.[1]) {
    return updateRequest(
      'update_deal',
      `${PIPEDRIVE_DEALS_WRITE_ROUTE}/${extractPipedriveIdFromPathSegment(dealMatch[1])}`,
      pickUpdateBody(parseJsonObject(content), DEAL_MUTABLE_FIELDS),
    );
  }

  const personMatch = normalized.match(/^\/pipedrive\/persons\/([^/]+)\.json$/u);
  if (personMatch?.[1]) {
    return updateRequest(
      'update_person',
      `${PIPEDRIVE_PERSONS_WRITE_ROUTE}/${extractPipedriveIdFromPathSegment(personMatch[1])}`,
      pickUpdateBody(parseJsonObject(content), PERSON_MUTABLE_FIELDS),
    );
  }

  const organizationMatch = normalized.match(/^\/pipedrive\/organizations\/([^/]+)\.json$/u);
  if (organizationMatch?.[1]) {
    return updateRequest(
      'update_organization',
      `${PIPEDRIVE_ORGANIZATIONS_WRITE_ROUTE}/${extractPipedriveIdFromPathSegment(organizationMatch[1])}`,
      pickUpdateBody(parseJsonObject(content), ORGANIZATION_MUTABLE_FIELDS),
    );
  }

  const activityMatch = normalized.match(/^\/pipedrive\/activities\/([^/]+)\.json$/u);
  if (activityMatch?.[1]) {
    return updateRequest(
      'update_activity',
      `${PIPEDRIVE_ACTIVITY_WRITE_ROUTE}/${extractPipedriveIdFromPathSegment(activityMatch[1])}`,
      pickUpdateBody(parseJsonObject(content), ACTIVITY_MUTABLE_FIELDS),
    );
  }

  throw new Error(`No Pipedrive writeback rule matched ${path}`);
}

export function resolvePipedriveDeleteRequest(path: string): PipedriveWritebackRequest {
  const normalized = normalizePath(path);

  const dealMatch = normalized.match(/^\/pipedrive\/deals\/([^/]+)\.json$/u);
  if (dealMatch?.[1] && isCanonicalResourcePath(normalized, '/pipedrive/deals')) {
    return deleteRequest('delete_deal', `${PIPEDRIVE_DEALS_WRITE_ROUTE}/${extractPipedriveIdFromPathSegment(dealMatch[1])}`);
  }
  const personMatch = normalized.match(/^\/pipedrive\/persons\/([^/]+)\.json$/u);
  if (personMatch?.[1] && isCanonicalResourcePath(normalized, '/pipedrive/persons')) {
    return deleteRequest('delete_person', `${PIPEDRIVE_PERSONS_WRITE_ROUTE}/${extractPipedriveIdFromPathSegment(personMatch[1])}`);
  }
  const organizationMatch = normalized.match(/^\/pipedrive\/organizations\/([^/]+)\.json$/u);
  if (organizationMatch?.[1] && isCanonicalResourcePath(normalized, '/pipedrive/organizations')) {
    return deleteRequest('delete_organization', `${PIPEDRIVE_ORGANIZATIONS_WRITE_ROUTE}/${extractPipedriveIdFromPathSegment(organizationMatch[1])}`);
  }
  const activityMatch = normalized.match(/^\/pipedrive\/activities\/([^/]+)\.json$/u);
  if (activityMatch?.[1] && isCanonicalResourcePath(normalized, '/pipedrive/activities')) {
    return deleteRequest('delete_activity', `${PIPEDRIVE_ACTIVITY_WRITE_ROUTE}/${extractPipedriveIdFromPathSegment(activityMatch[1])}`);
  }

  throw new Error(`No Pipedrive delete writeback rule matched ${path}`);
}

function createRequest(
  action: PipedriveWritebackRequest['action'],
  endpoint: string,
  body: Record<string, unknown>,
): PipedriveWritebackRequest {
  return {
    action,
    method: 'POST',
    endpoint,
    body,
  };
}

function updateRequest(
  action: PipedriveWritebackRequest['action'],
  endpoint: string,
  body: Record<string, unknown>,
): PipedriveWritebackRequest {
  return {
    action,
    method: 'PUT',
    endpoint,
    body,
  };
}

function deleteRequest(
  action: PipedriveWritebackRequest['action'],
  endpoint: string,
): PipedriveWritebackRequest {
  return {
    action,
    method: 'DELETE',
    endpoint,
  };
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed;
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Pipedrive writeback content must be a JSON object');
  }

  if (looksLikeSyncedEnvelope(parsed)) {
    const payload = parsed.payload;
    if (isRecord(payload)) {
      return payload;
    }
  }

  return parsed;
}

const ENVELOPE_MARKER_KEYS = ['provider', 'objectType', 'objectId', 'workspaceId'] as const;

function looksLikeSyncedEnvelope(payload: Record<string, unknown>): boolean {
  if (!isRecord(payload.payload)) return false;
  return ENVELOPE_MARKER_KEYS.some((key) => key in payload);
}

function pickCreateBody(source: Record<string, unknown>, allowlist: Set<string>): Record<string, unknown> {
  const body = pickAllowed(source, allowlist);
  if (Object.keys(body).length === 0) {
    throw new Error('Pipedrive create writeback requires at least one mutable field');
  }
  return body;
}

function pickUpdateBody(source: Record<string, unknown>, allowlist: Set<string>): Record<string, unknown> {
  const body = pickAllowed(source, allowlist);
  if (Object.keys(body).length === 0) {
    throw new Error('Pipedrive update writeback requires at least one mutable field');
  }
  return body;
}

function pickAllowed(source: Record<string, unknown>, allowlist: Set<string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
    if (!allowlist.has(key) || value === undefined) continue;
    body[key] = value;
  }
  return body;
}

const READ_ONLY_FIELDS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'add_time',
  'update_time',
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

function isDraftResourcePath(path: string, resourcePath: string): boolean {
  const file = matchResourceFile(path, resourcePath);
  return file !== undefined && !file.canonical;
}

function isCanonicalResourcePath(path: string, resourcePath: string): boolean {
  return matchResourceFile(path, resourcePath)?.canonical === true;
}

function matchResourceFile(path: string, resourcePath: string): { canonical: boolean; id: string } | undefined {
  const resource = resources.find((candidate) => candidate.path === resourcePath);
  if (!resource) {
    return undefined;
  }
  return matchFile(path, resource);
}

function matchFile(path: string, resource: AdapterResourceConfig): { canonical: boolean; id: string } | undefined {
  if (!path.endsWith('.json') || !resource.pathPattern.test(path)) {
    return undefined;
  }
  const id = extractPipedriveIdFromPathSegment(path.slice(path.lastIndexOf('/') + 1, -'.json'.length));
  return { canonical: resource.idPattern.test(id), id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
