import { FATHOM_PROVIDER } from './types.js';

type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export interface NormalizedFathomWebhook {
  provider: string;
  eventType: string;
  objectType: 'meeting';
  objectId: string;
  payload: Record<string, unknown>;
  deliveryId?: string;
  signature?: string;
  connectionId?: string;
}

export type FathomWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-fathom-connection-id',
  'fathom-connection-id',
] as const;

export function normalizeFathomWebhook(
  rawPayload: unknown,
  headers: FathomWebhookHeaders = {},
): NormalizedFathomWebhook {
  const payload = parsePayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);

  const recordingId =
    readNonEmptyString(payload.recording_id)
    ?? readNonEmptyString(payload.id)
    ?? readNonEmptyString(payload.recordingId);

  if (!recordingId) {
    throw new Error('Fathom webhook payload missing recording_id/id');
  }

  const rawEventType =
    readNonEmptyString(payload.event)
    ?? readNonEmptyString(payload.event_type)
    ?? 'new-meeting-content-ready';
  const eventType =
    rawEventType === 'new_meeting_content_ready' ? 'new-meeting-content-ready' : rawEventType;

  const normalized: NormalizedFathomWebhook = {
    provider: FATHOM_PROVIDER,
    eventType,
    objectType: 'meeting',
    objectId: recordingId,
    payload,
  };

  const deliveryId = readNonEmptyString(normalizedHeaders['webhook-id']);
  if (deliveryId) {
    normalized.deliveryId = deliveryId;
  }

  const signature = readNonEmptyString(normalizedHeaders['webhook-signature']);
  if (signature) {
    normalized.signature = signature;
  }

  const connectionId = extractConnectionId(normalizedHeaders, payload);
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

  throw new Error('Fathom webhook payload must be a JSON object.');
}

function extractConnectionId(
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): string | undefined {
  for (const key of CONNECTION_ID_HEADER_KEYS) {
    const value = readNonEmptyString(headers[key]);
    if (value) {
      return value;
    }
  }

  return readNonEmptyString(payload.connectionId)
    ?? readNonEmptyString(payload.connection_id)
    ?? readNonEmptyString(payload._connection_id);
}

function normalizeHeaders(headers: FathomWebhookHeaders): Record<string, string> {
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
