import { parseRelayfilePath } from './path-mapper.js';
import { providerQueries } from './queries.js';
import type { JsonObject, JsonValue, ProviderWritebackRequest, WritebackOperation } from './types.js';

const READ_ONLY_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'url', '_webhook', '_connection', 'fingerprint', 'etag', 'eTag']);

export class ReadOnlyFieldError extends Error {
  readonly field: string;
  readonly code = 'READ_ONLY_FIELD';

  constructor(field: string) {
    super('Field "' + field + '" is read-only and cannot be written');
    this.name = 'ReadOnlyFieldError';
    this.field = field;
  }
}

export function resolveWritebackRequest(path: string, content: string, operation?: WritebackOperation): ProviderWritebackRequest {
  const parsedPath = parseRelayfilePath(path);
  const payload = content.trim().length > 0 ? parseJsonObject(content) : {};
  rejectReadOnlyFields(payload);
  const draftLike = parsedPath.id === null || /^(draft|create|new|upload|tmp|temp)(?:[._-]|$)/i.test(parsedPath.id);
  const canonical = !draftLike && parsedPath.id !== null && /^[A-Za-z0-9_-]+$/.test(parsedPath.id);
  const resolvedOperation: WritebackOperation = operation ?? (content.trim().length === 0 ? 'delete' : canonical ? 'update' : 'create');
  const resource = resolveResource(parsedPath.resource);
  const endpoint = endpointFor(resource, resolvedOperation);

  return {
    action: "gmail" + '.' + resource + '.' + resolvedOperation,
    operation: resolvedOperation,
    method: methodFor(resource, resolvedOperation),
    endpoint,
    resource,
    resourceId: parsedPath.id,
    body: resolvedOperation === 'delete' ? null : payload,
  };
}

type GmailWritebackResource = 'drafts' | 'threads' | 'watches';

function resolveResource(parsed: 'object' | 'drafts' | 'lifecycle' | 'unknown'): GmailWritebackResource {
  if (parsed === 'lifecycle') return 'watches';
  if (parsed === 'drafts') return 'drafts';
  return 'threads';
}

function endpointFor(resource: GmailWritebackResource, operation: WritebackOperation): string {
  if (resource === 'watches') return providerQueries.actions.lifecycleWrite;
  if (resource === 'drafts') {
    // drafts.create posts to the collection; update/delete address the draft id.
    return operation === 'create'
      ? providerQueries.actions.draftCreate
      : providerQueries.actions.draftWrite;
  }
  return providerQueries.actions.objectWrite;
}

function methodFor(resource: GmailWritebackResource, operation: WritebackOperation): 'DELETE' | 'PATCH' | 'POST' | 'PUT' {
  if (operation === 'delete') return 'DELETE';
  // Gmail's drafts.update is a PUT that replaces the draft; messages.modify is a PATCH.
  if (operation === 'update') return resource === 'drafts' ? 'PUT' : 'PATCH';
  return 'POST';
}

function parseJsonObject(content: string): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content) as JsonValue;
  } catch (error) {
    throw new Error('Gmail writeback requires valid JSON: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gmail writeback requires a JSON object');
  }
  return parsed;
}

export function rejectReadOnlyFields(payload: JsonObject): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) throw new ReadOnlyFieldError(key);
  }
}

