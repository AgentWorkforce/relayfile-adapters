import { ReadOnlyFieldError } from '@relayfile/adapter-core';
import { resources, type AdapterResourceConfig } from './resources.js';
import type { HubSpotObjectType, HubSpotWritebackRequest } from './types.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

export const HUBSPOT_WRITEBACK_CONTACTS_ROUTE = '/crm/v3/objects/contacts';
export const HUBSPOT_WRITEBACK_COMPANIES_ROUTE = '/crm/v3/objects/companies';
export const HUBSPOT_WRITEBACK_DEALS_ROUTE = '/crm/v3/objects/deals';
export const HUBSPOT_WRITEBACK_TICKETS_ROUTE = '/crm/v3/objects/tickets';

const ROUTE_BY_TYPE: Readonly<Record<HubSpotObjectType, string>> = {
  company: HUBSPOT_WRITEBACK_COMPANIES_ROUTE,
  contact: HUBSPOT_WRITEBACK_CONTACTS_ROUTE,
  deal: HUBSPOT_WRITEBACK_DEALS_ROUTE,
  ticket: HUBSPOT_WRITEBACK_TICKETS_ROUTE,
};

const CREATE_ACTION_BY_TYPE: Readonly<Record<HubSpotObjectType, HubSpotWritebackRequest['action']>> = {
  company: 'create_company',
  contact: 'create_contact',
  deal: 'create_deal',
  ticket: 'create_ticket',
};

const UPDATE_ACTION_BY_TYPE: Readonly<Record<HubSpotObjectType, HubSpotWritebackRequest['action']>> = {
  company: 'update_company',
  contact: 'update_contact',
  deal: 'update_deal',
  ticket: 'update_ticket',
};

const DELETE_ACTION_BY_TYPE: Readonly<Record<HubSpotObjectType, HubSpotWritebackRequest['action']>> = {
  company: 'delete_company',
  contact: 'delete_contact',
  deal: 'delete_deal',
  ticket: 'delete_ticket',
};

const ASSOCIATE_ACTION_BY_TYPE: Readonly<Record<HubSpotObjectType, HubSpotWritebackRequest['action']>> = {
  company: 'associate_company',
  contact: 'associate_contact',
  deal: 'associate_deal',
  ticket: 'associate_ticket',
};

interface ParsedWritebackPath {
  associationType?: string;
  objectId?: string;
  objectType: HubSpotObjectType;
  targetObjectId?: string;
}

export function resolveHubSpotWritebackRequest(path: string, content: string): HubSpotWritebackRequest {
  const parsed = parseWritebackPath(path);

  if (parsed.associationType && parsed.objectId && parsed.targetObjectId) {
    return buildAssociationRequest({
      associationType: parsed.associationType,
      objectId: parsed.objectId,
      objectType: parsed.objectType,
      targetObjectId: parsed.targetObjectId,
    });
  }

  if (!parsed.objectId) {
    return buildCreateRequest(parsed.objectType, content);
  }

  return buildUpdateRequest(parsed.objectType, parsed.objectId, content);
}

export function resolveHubSpotDeleteRequest(path: string): HubSpotWritebackRequest {
  const parsed = parseWritebackPath(path);
  if (!parsed.objectId || !isCanonicalResourcePath(path, parsed.objectType)) {
    throw new Error(`No HubSpot delete writeback rule matched ${path}`);
  }

  return {
    action: DELETE_ACTION_BY_TYPE[parsed.objectType],
    endpoint: `${ROUTE_BY_TYPE[parsed.objectType]}/${encodeURIComponent(parsed.objectId)}`,
    method: 'DELETE',
  };
}

function buildCreateRequest(objectType: HubSpotObjectType, content: string): HubSpotWritebackRequest {
  const properties = readPropertiesPayload(content);
  return {
    action: CREATE_ACTION_BY_TYPE[objectType],
    body: { properties },
    endpoint: ROUTE_BY_TYPE[objectType],
    method: 'POST',
  };
}

function buildUpdateRequest(
  objectType: HubSpotObjectType,
  objectId: string,
  content: string,
): HubSpotWritebackRequest {
  const properties = readPropertiesPayload(content);
  return {
    action: UPDATE_ACTION_BY_TYPE[objectType],
    body: { properties },
    endpoint: `${ROUTE_BY_TYPE[objectType]}/${encodeURIComponent(objectId)}`,
    method: 'PATCH',
  };
}

function buildAssociationRequest(parsed: {
  associationType: string;
  objectId: string;
  objectType: HubSpotObjectType;
  targetObjectId: string;
}): HubSpotWritebackRequest {
  const associationType = normalizeAssociationType(parsed.associationType);
  return {
    action: ASSOCIATE_ACTION_BY_TYPE[parsed.objectType],
    endpoint:
      `${ROUTE_BY_TYPE[parsed.objectType]}/${encodeURIComponent(parsed.objectId)}` +
      `/associations/${encodeURIComponent(parsed.associationType)}` +
      `/${encodeURIComponent(parsed.targetObjectId)}/${encodeURIComponent(associationType)}`,
    method: 'PUT',
  };
}

function parseWritebackPath(path: string): ParsedWritebackPath {
  const trimmed = path.trim();

  const association = /^\/hubspot\/(contacts|companies|deals|tickets)\/([^/]+)\/associations\/([^/]+)\/([^/]+)\.json$/u.exec(trimmed);
  if (association?.[1] && association[2] && association[3] && association[4]) {
    return {
      associationType: collectionToApiName(association[3]),
      objectId: decodeURIComponent(association[2]),
      objectType: objectTypeFromCollection(association[1]),
      targetObjectId: decodeURIComponent(association[4]),
    };
  }

  const update = /^\/hubspot\/(contacts|companies|deals|tickets)\/([^/]+)\.json$/u.exec(trimmed);
  if (update?.[1] && update[2]) {
    const objectType = objectTypeFromCollection(update[1]);
    const objectId = decodeURIComponent(update[2]);
    if (!isCanonicalResourcePath(trimmed, objectType)) {
      return { objectType };
    }
    return {
      objectId,
      objectType,
    };
  }

  throw new Error(`No HubSpot writeback rule matched ${path}`);
}

function readPropertiesPayload(content: string): Record<string, unknown> {
  const parsed = parseJsonObject(content);
  const properties = isRecord(parsed.properties) ? parsed.properties : parsed;
  return sanitizeProperties(properties);
}

function sanitizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
    if (isWritablePropertyKey(key) && value !== undefined) {
      sanitized[key] = value;
    }
  }
  if (Object.keys(sanitized).length === 0) {
    throw new Error('HubSpot writeback requires at least one writable property');
  }
  return sanitized;
}

function isWritablePropertyKey(key: string): boolean {
  return (
    key !== 'id' &&
    key !== 'archived' &&
    key !== 'archivedAt' &&
    key !== 'createdAt' &&
    key !== 'updatedAt' &&
    !key.startsWith('_') &&
    !key.startsWith('hubspot.')
  );
}

const READ_ONLY_FIELDS = new Set([
  'id',
  'archived',
  'archivedAt',
  'createdAt',
  'updatedAt',
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

function isCanonicalResourcePath(path: string, objectType: HubSpotObjectType): boolean {
  const collection = collectionFromObjectType(objectType);
  const match = matchResourceFile(path, `/hubspot/${collection}`);
  return match?.canonical === true;
}

function matchResourceFile(path: string, resourcePath: string): { canonical: boolean; id: string } | undefined {
  const resource = resources.find((candidate) => candidate.path === resourcePath);
  if (!resource) {
    return undefined;
  }
  return matchFile(path, resource);
}

function matchFile(path: string, resource: AdapterResourceConfig): { canonical: boolean; id: string } | undefined {
  const normalized = path.trim();
  if (!normalized.endsWith('.json') || !resource.pathPattern.test(normalized)) {
    return undefined;
  }
  const id = decodeURIComponent(normalized.slice(normalized.lastIndexOf('/') + 1, -'.json'.length));
  return { canonical: resource.idPattern.test(id), id };
}

function collectionFromObjectType(objectType: HubSpotObjectType): string {
  switch (objectType) {
    case 'company':
      return 'companies';
    case 'contact':
      return 'contacts';
    case 'deal':
      return 'deals';
    case 'ticket':
      return 'tickets';
  }
}

function parseJsonObject(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`HubSpot writeback content must be JSON: ${toErrorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('HubSpot writeback content must be a JSON object');
  }
  return parsed;
}

function normalizeAssociationType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error('HubSpot association type must be non-empty');
  }
  return normalized;
}

function collectionToApiName(collection: string): string {
  switch (collection) {
    case 'companies':
      return 'companies';
    case 'contacts':
      return 'contacts';
    case 'deals':
      return 'deals';
    case 'tickets':
      return 'tickets';
    default:
      return collection;
  }
}

function objectTypeFromCollection(collection: string): HubSpotObjectType {
  switch (collection) {
    case 'companies':
      return 'company';
    case 'contacts':
      return 'contact';
    case 'deals':
      return 'deal';
    case 'tickets':
      return 'ticket';
    default:
      throw new Error(`Unsupported HubSpot collection: ${collection}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
