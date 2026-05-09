import { parseRelayfilePath } from './path-mapper.js';
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
  const resource = parsedPath.resource === 'lifecycle' ? "channels" : "files";
  const endpoint = resource === "channels" ? "/drive/v3/files/{resourceId}/watch" : "/drive/v3/files";

  return {
    action: "google-drive" + '.' + resource + '.' + resolvedOperation,
    operation: resolvedOperation,
    method: methodFor(resolvedOperation),
    endpoint,
    resource,
    resourceId: parsedPath.id,
    body: resolvedOperation === 'delete' ? null : payload,
  };
}

function methodFor(operation: WritebackOperation): 'DELETE' | 'PATCH' | 'POST' | 'PUT' {
  if (operation === 'delete') return 'DELETE';
  if (operation === 'update') return 'PATCH';
  return 'POST';
}

function parseJsonObject(content: string): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content) as JsonValue;
  } catch (error) {
    throw new Error('Google Drive writeback requires valid JSON: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Google Drive writeback requires a JSON object');
  }
  return parsed;
}

export function rejectReadOnlyFields(payload: JsonObject): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) throw new ReadOnlyFieldError(key);
  }
}

