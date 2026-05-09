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
  const canonical = !draftLike && parsedPath.id !== null && /^.+$/.test(parsedPath.id);
  const resolvedOperation: WritebackOperation = operation ?? (content.trim().length === 0 ? 'delete' : canonical ? 'update' : 'create');
  const resource = parsedPath.resource === 'lifecycle' ? "listeners" : "rows";
  const endpoint = resource === "listeners" ? "LISTEN {channel}" : "parameterized INSERT/UPDATE/DELETE";

  if (resource === "rows") {
    return buildPostgresRequest(path, payload, resolvedOperation, parsedPath.id);
  }
  return {
    action: "postgres" + '.' + resource + '.' + resolvedOperation,
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
    throw new Error('Postgres writeback requires valid JSON: ' + (error instanceof Error ? error.message : String(error)));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Postgres writeback requires a JSON object');
  }
  return parsed;
}

export function rejectReadOnlyFields(payload: JsonObject): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) throw new ReadOnlyFieldError(key);
  }
}

function buildPostgresRequest(path: string, payload: JsonObject, operation: WritebackOperation, id: string | null): ProviderWritebackRequest {
  const segments = path.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment.replace(/\.json$/, '')));
  const db = segments[1] ?? String(payload.db ?? '');
  const schema = segments[2] ?? String(payload.schema ?? 'public');
  const table = segments[3] ?? String(payload.table ?? '');
  const primaryKeyColumn = String(payload.primaryKey ?? payload.primaryKeyColumn ?? 'id');
  const primaryKey = id ?? String(payload.primaryKeyValue ?? payload[primaryKeyColumn] ?? '');
  const quotedSchema = quoteSqlIdentifier(schema, 'schema');
  const quotedTable = quoteSqlIdentifier(table, 'table');
  const quotedPrimaryKeyColumn = quoteSqlIdentifier(primaryKeyColumn, 'primaryKey');
  const row = isObject(payload.row) ? payload.row : payload;
  const columns = Object.keys(row).filter((column) => !READ_ONLY_FIELDS.has(column));
  return {
    action: 'postgres.rows.' + operation,
    operation,
    method: methodFor(operation),
    endpoint: operation === 'delete' ? 'DELETE FROM ' + quotedSchema + '.' + quotedTable + ' WHERE ' + quotedPrimaryKeyColumn + ' = $1' : 'parameterized ' + operation.toUpperCase() + ' on ' + quotedSchema + '.' + quotedTable,
    resource: 'rows',
    resourceId: primaryKey,
    body: operation === 'delete' ? null : { db, schema, table, primaryKey, primaryKeyColumn, row },
    parameters: operation === 'delete' ? [primaryKey] : columns.map((column) => row[column]),
  };
}

export function quoteSqlIdentifier(identifier: string, label = 'identifier'): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error('Invalid Postgres ' + label + ' identifier: ' + identifier);
  }
  return '"' + identifier + '"';
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
