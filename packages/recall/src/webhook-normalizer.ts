import { computeRecallPath } from './path-mapper.js';
import { RECALL_PROVIDER } from './types.js';

type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export interface NormalizedRecallWebhook {
  provider: string;
  eventType: string;
  objectType: 'recording' | 'transcript';
  objectId: string;
  path: string;
  payload: Record<string, unknown>;
  connectionId?: string;
}

export type RecallWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-recall-connection-id',
  'recall-connection-id',
] as const;

export function normalizeRecallWebhook(
  rawPayload: unknown,
  headers: RecallWebhookHeaders = {},
): NormalizedRecallWebhook {
  const payload = parsePayload(rawPayload);
  const objectType = extractObjectType(payload);
  const objectId = extractRecordingId(payload, objectType);
  const eventType = extractEventType(payload, objectType);
  const connectionId = extractConnectionId(headers, payload);
  const normalizedPayload = normalizePayload(payload, objectId, objectType);

  const normalized: NormalizedRecallWebhook = {
    provider: RECALL_PROVIDER,
    eventType,
    objectType,
    objectId,
    path: computeRecallPath(objectType, objectId),
    payload: normalizedPayload,
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
  throw new Error('Recall webhook payload must be a JSON object.');
}

function extractObjectType(payload: Record<string, unknown>): 'recording' | 'transcript' {
  const eventType = readNonEmptyString(payload.event)
    ?? readNonEmptyString(payload.event_type)
    ?? readNonEmptyString(payload.type)
    ?? readNonEmptyString(payload.object)
    ?? readNonEmptyString(payload.object_type);
  const normalized = eventType?.toLowerCase() ?? '';
  if (normalized.includes('transcript')) return 'transcript';
  if (payload.transcript_text !== undefined || payload.transcript !== undefined) return 'transcript';
  return 'recording';
}

function extractRecordingId(
  payload: Record<string, unknown>,
  objectType: 'recording' | 'transcript',
): string {
  const recording = payload.recording;
  const nestedRecordingId = isRecord(recording) ? readNonEmptyString(recording.id) : readNonEmptyString(recording);
  const id = readNonEmptyString(payload.recording_id)
    ?? readNonEmptyString(payload.recordingId)
    ?? nestedRecordingId
    ?? readNonEmptyString(payload.recording_uuid)
    ?? readNonEmptyString(payload.recordingUuid)
    ?? readNonEmptyString(payload.id)
    ?? readNonEmptyString(payload.object_id);

  if (!id) {
    throw new Error(`Recall webhook payload missing ${objectType} recording id.`);
  }
  return id;
}

function extractEventType(
  payload: Record<string, unknown>,
  objectType: 'recording' | 'transcript',
): string {
  return readNonEmptyString(payload.event)
    ?? readNonEmptyString(payload.event_type)
    ?? readNonEmptyString(payload.action)
    ?? `${objectType}.updated`;
}

function normalizePayload(
  payload: Record<string, unknown>,
  recordingId: string,
  objectType: 'recording' | 'transcript',
): Record<string, unknown> {
  const transcriptText = readTranscriptText(payload);
  return {
    ...payload,
    id: recordingId,
    object: 'recording',
    source_object_type: objectType,
    ...(transcriptText !== undefined ? { transcript_text: transcriptText } : {}),
  };
}

function readTranscriptText(payload: Record<string, unknown>): string | null | undefined {
  if (payload.transcript_text === null) return null;
  const explicit = readNonEmptyString(payload.transcript_text);
  if (explicit !== undefined) return explicit;

  const transcript = payload.transcript;
  if (typeof transcript === 'string') return transcript;
  if (Array.isArray(transcript)) {
    const parts = transcript
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (isRecord(entry)) {
          return readNonEmptyString(entry.text)
            ?? readNonEmptyString(entry.words)
            ?? readNonEmptyString(entry.content);
        }
        return undefined;
      })
      .filter((entry): entry is string => entry !== undefined);
    if (parts.length > 0) return parts.join('\n');
  }
  return undefined;
}

function extractConnectionId(
  headers: RecallWebhookHeaders,
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

function normalizeHeaders(headers: RecallWebhookHeaders): Record<string, string> {
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
