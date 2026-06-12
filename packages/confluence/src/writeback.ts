import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import { extractConfluenceIdFromPathSegment } from './path-mapper.js';
import { resources } from './resources.js';
import { CONFLUENCE_API_PAGES_ROUTE, type ConfluenceWritebackRequest } from './types.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

export function resolveConfluenceWritebackRequest(path: string, content: string): ConfluenceWritebackRequest {
  const normalized = normalizePath(path);
  const route = classifyWrite(normalized, resources);

  if (route?.resource.path === '/confluence/pages') {
    if (route.kind === 'create') {
      return buildPageCreate(content);
    }
    const pageMatch = normalized.match(/^\/confluence\/pages\/([^/]+)\.json$/u);
    if (route.kind === 'patch' && pageMatch?.[1]) {
      return buildPageUpdate(extractConfluenceIdFromPathSegment(pageMatch[1]), content);
    }
  }

  if (route?.resource.path === '/confluence/spaces/{spaceIdOrKey}/pages') {
    const pageMatch = normalized.match(/^\/confluence\/spaces\/([^/]+)\/pages\/([^/]+)\.json$/u);
    if (route.kind === 'create' && pageMatch?.[1]) {
      return buildPageCreate(content, extractConfluenceIdFromPathSegment(pageMatch[1]));
    }
    if (route.kind === 'patch' && pageMatch?.[2]) {
      return buildPageUpdate(extractConfluenceIdFromPathSegment(pageMatch[2]), content);
    }
  }

  throw new Error(`No Confluence writeback rule matched ${path}`);
}

export function resolveConfluenceDeleteRequest(path: string): ConfluenceWritebackRequest {
  const normalized = normalizePath(path);
  const route = classifyWrite(normalized, resources, { fsEvent: 'delete' });
  if (!route || route.kind !== 'delete') {
    throw new Error(`No Confluence delete writeback rule matched ${path}`);
  }

  const nestedPageMatch = normalized.match(/^\/confluence\/spaces\/[^/]+\/pages\/([^/]+)\.json$/u);
  if (nestedPageMatch?.[1]) {
    return buildPageDelete(extractConfluenceIdFromPathSegment(nestedPageMatch[1]));
  }

  const flatPageMatch = normalized.match(/^\/confluence\/pages\/([^/]+)\.json$/u);
  if (flatPageMatch?.[1]) {
    return buildPageDelete(extractConfluenceIdFromPathSegment(flatPageMatch[1]));
  }

  throw new Error(`No Confluence delete writeback rule matched ${path}`);
}

function buildPageCreate(content: string, pathSpaceId?: string): ConfluenceWritebackRequest {
  const payload = parseJsonObject(content);
  rejectReadOnlyFields(payload);
  const title = readString(payload, 'title');
  if (!title) {
    throw new Error('page create writeback requires title');
  }

  // Confluence v2 POST /pages requires the numeric spaceId (Long). The path
  // only carries the space *key* (e.g. "OPS"), so a caller that has resolved the
  // numeric id supplies it explicitly in the payload; that takes precedence over
  // the path-derived value.
  const spaceId =
    readString(payload, 'spaceId') ?? readString(payload, 'space_id') ?? pathSpaceId;
  if (!spaceId) {
    throw new Error('page create writeback requires spaceId');
  }

  const body = normalizePageBody(payload);
  if (!body) {
    throw new Error('page create writeback requires body');
  }

  const requestBody: Record<string, unknown> = {
    spaceId,
    status: readString(payload, 'status') ?? 'current',
    title,
    body,
  };
  const parentId = readString(payload, 'parentId') ?? readString(payload, 'parent_id');
  if (parentId) requestBody.parentId = parentId;

  return {
    action: 'create_page',
    method: 'POST',
    endpoint: CONFLUENCE_API_PAGES_ROUTE,
    body: requestBody,
  };
}

function buildPageUpdate(pageId: string, content: string): ConfluenceWritebackRequest {
  const payload = parseJsonObject(content);
  const source = looksLikeSyncedEnvelope(payload) && isRecord(payload.payload)
    ? payload.payload
    : payload;
  rejectReadOnlyFields(source);

  const title = readString(source, 'title');
  if (!title) {
    throw new Error('page update writeback requires title');
  }

  const body = normalizePageBody(source);
  if (!body) {
    throw new Error('page update writeback requires body');
  }

  const requestBody: Record<string, unknown> = {
    id: pageId,
    status: readString(source, 'status') ?? 'current',
    title,
    body,
  };

  const spaceId = readString(source, 'spaceId') ?? readString(source, 'space_id');
  if (spaceId) requestBody.spaceId = spaceId;

  const version = normalizeVersion(source.version);
  if (version) requestBody.version = version;

  return {
    action: 'update_page',
    method: 'PUT',
    endpoint: `${CONFLUENCE_API_PAGES_ROUTE}/${pageId}`,
    body: requestBody,
  };
}

function buildPageDelete(pageId: string): ConfluenceWritebackRequest {
  return {
    action: 'delete_page',
    method: 'DELETE',
    endpoint: `${CONFLUENCE_API_PAGES_ROUTE}/${pageId}`,
  };
}

const ENVELOPE_MARKER_KEYS = ['provider', 'objectType', 'objectId', 'workspaceId'] as const;
const READ_ONLY_FIELDS = new Set([
  'authorId',
  'createdAt',
  'id',
  'objectId',
  'objectType',
  'provider',
  'workspaceId',
  '_connection',
  '_webhook',
]);

function normalizePageBody(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const body = payload.body;
  if (typeof body === 'string' && body.trim()) {
    return { representation: 'storage', value: body.trim() };
  }
  if (!isRecord(body)) {
    return undefined;
  }

  if (typeof body.value === 'string' && body.value.trim()) {
    return {
      representation: readString(body, 'representation') ?? 'storage',
      value: body.value.trim(),
    };
  }

  const storage = body.storage;
  if (isRecord(storage) && typeof storage.value === 'string' && storage.value.trim()) {
    return {
      representation: readString(storage, 'representation') ?? 'storage',
      value: storage.value.trim(),
    };
  }

  return undefined;
}

function normalizeVersion(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return { number: value };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const number = readNumber(value, 'number');
  if (number === undefined) {
    return undefined;
  }
  return {
    number: number + 1,
    ...(readString(value, 'message') ? { message: readString(value, 'message') } : {}),
    ...(readBoolean(value, 'minorEdit') !== undefined ? { minorEdit: readBoolean(value, 'minorEdit') } : {}),
  };
}

function rejectReadOnlyFields(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
  }
}

function looksLikeSyncedEnvelope(payload: Record<string, unknown>): boolean {
  if (!isRecord(payload.payload)) return false;
  return ENVELOPE_MARKER_KEYS.some((key) => key in payload);
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content.trim();
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
