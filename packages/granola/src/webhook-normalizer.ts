import { GRANOLA_PROVIDER } from './types.js';

type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export interface NormalizedGranolaWebhook {
  provider: string;
  eventType: string;
  objectType: 'folder' | 'note';
  objectId: string;
  payload: Record<string, unknown>;
  connectionId?: string;
}

export type GranolaWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-granola-connection-id',
  'granola-connection-id',
] as const;

export function normalizeGranolaWebhook(
  rawPayload: unknown,
  headers: GranolaWebhookHeaders = {},
): NormalizedGranolaWebhook {
  const payload = parsePayload(rawPayload);
  const objectType = extractObjectType(payload);
  const objectId = extractObjectId(payload, objectType);
  const eventType = extractEventType(payload);
  const connectionId = extractConnectionId(headers, payload);

  const normalized: NormalizedGranolaWebhook = {
    provider: GRANOLA_PROVIDER,
    eventType,
    objectType,
    objectId,
    payload,
  };
  if (connectionId) {
    normalized.connectionId = connectionId;
  }
  return normalized;
}

function parsePayload(rawPayload: unknown): Record<string, unknown> {
  if (isRecord(rawPayload)) {
    return rawPayload;
  }
  if (typeof rawPayload === 'string') {
    const parsed = JSON.parse(rawPayload) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
  }
  throw new Error('Granola webhook payload must be a JSON object.');
}

function extractObjectType(payload: Record<string, unknown>): 'folder' | 'note' {
  const source = readNonEmptyString(payload.object)
    ?? readNonEmptyString(payload.object_type)
    ?? readNonEmptyString(payload.type)
    ?? 'note';
  const normalized = source.toLowerCase();
  if (normalized.includes('folder')) return 'folder';
  return 'note';
}

function extractObjectId(payload: Record<string, unknown>, objectType: 'folder' | 'note'): string {
  const id = readNonEmptyString(payload.id)
    ?? readNonEmptyString(payload.object_id)
    ?? readNonEmptyString(payload[`${objectType}_id`]);
  if (!id) {
    throw new Error(`Granola webhook payload missing ${objectType} id.`);
  }
  return id;
}

function extractEventType(payload: Record<string, unknown>): string {
  return readNonEmptyString(payload.event)
    ?? readNonEmptyString(payload.event_type)
    ?? readNonEmptyString(payload.action)
    ?? 'updated';
}

function extractConnectionId(
  headers: GranolaWebhookHeaders,
  payload: Record<string, unknown>,
): string | undefined {
  const normalizedHeaders = normalizeHeaders(headers);
  for (const key of CONNECTION_ID_HEADER_KEYS) {
    const value = readNonEmptyString(normalizedHeaders[key]);
    if (value) return value;
  }

  return readNonEmptyString(payload.connectionId)
    ?? readNonEmptyString(payload.connection_id)
    ?? readNonEmptyString(payload._connection_id);
}

function normalizeHeaders(headers: GranolaWebhookHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }

  if (Symbol.iterator in Object(headers)) {
    for (const pair of headers as Iterable<readonly [string, string]>) {
      if (Array.isArray(pair) && pair.length >= 2) {
        normalized[pair[0].toLowerCase()] = pair[1];
      }
    }
    return normalized;
  }

  for (const [key, rawValue] of Object.entries(headers as Record<string, HeaderValue>)) {
    if (Array.isArray(rawValue)) {
      const first = rawValue.find((entry) => typeof entry === 'string');
      if (first) normalized[key.toLowerCase()] = first;
      continue;
    }
    if (typeof rawValue === 'string') {
      normalized[key.toLowerCase()] = rawValue;
      continue;
    }
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      normalized[key.toLowerCase()] = String(rawValue);
    }
  }
  return normalized;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
