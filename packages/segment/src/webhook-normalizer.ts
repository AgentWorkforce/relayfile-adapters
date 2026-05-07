import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './segment-adapter.js';
import { normalizeSegmentObjectType } from './path-mapper.js';

export const SEGMENT_PROVIDER = 'segment';
export const SEGMENT_SIGNATURE_HEADER = 'x-signature';
export const SEGMENT_TIMESTAMP_HEADER = 'x-timestamp';
export const SEGMENT_SOURCE_ID_HEADER = 'x-segment-source-id';
export const SEGMENT_DELIVERY_ID_HEADER = 'x-segment-delivery-id';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-segment-connection-id',
  'segment-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-segment-provider',
  'segment-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-segment-provider-config-key',
  'segment-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;
const DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 300;

type SegmentRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type SegmentWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface SegmentWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  sourceId?: string;
  timestamp?: number;
}

export interface SegmentWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?: 'invalid-signature' | 'malformed-signature' | 'missing-secret' | 'missing-signature';
  receivedSignature?: string;
  sourceId?: string;
}

export interface SegmentWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'expired-timestamp' | 'malformed-timestamp' | 'missing-timestamp';
  timestamp?: number;
}

export interface SegmentWebhookSecretOptions {
  secret?: string;
  sourceId?: string;
  sourceSecrets?: Record<string, string>;
}

export interface NormalizeSegmentWebhookOptions extends SegmentWebhookSecretOptions {
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  requireSignature?: boolean;
  timestampToleranceSeconds?: number;
  now?: Date | number;
}

export function normalizeSegmentWebhook(
  rawPayload: unknown,
  headers: SegmentWebhookHeaders = {},
  options: NormalizeSegmentWebhookOptions = {},
): NormalizedWebhook {
  const normalizedHeaders = normalizeHeaders(headers);
  const rawBody = rawBodyString(rawPayload);
  const secret = resolveWebhookSecret(rawBody, normalizedHeaders, options);
  if (options.requireSignature || secret) {
    assertValidSegmentWebhookSignature(rawBody, normalizedHeaders, secret, options);
  }

  const timestampOptions: { now?: Date | number; toleranceSeconds?: number } = {};
  if (options.now !== undefined) {
    timestampOptions.now = options.now;
  }
  if (options.timestampToleranceSeconds !== undefined) {
    timestampOptions.toleranceSeconds = options.timestampToleranceSeconds;
  }
  const timestampResult = validateSegmentWebhookTimestamp(normalizedHeaders, timestampOptions);
  if (!timestampResult.ok && timestampResult.reason !== 'missing-timestamp') {
    throw new Error(`Segment webhook timestamp validation failed: ${timestampResult.reason}`);
  }

  const payload = parseSegmentWebhookPayload(rawPayload);
  const objectType = extractSegmentObjectType(payload);
  const objectId = extractSegmentObjectId(payload, objectType);
  const eventType = extractSegmentEventType(payload, objectType);
  const connection = extractSegmentConnectionMetadata(payload, normalizedHeaders, options);

  const normalized: NormalizedWebhook = {
    provider: connection.provider,
    eventType,
    objectType,
    objectId,
    payload: buildNormalizedPayload(payload, connection, {
      eventType,
      objectId,
      objectType,
    }),
  };

  if (connection.connectionId) {
    normalized.connectionId = connection.connectionId;
  }

  return normalized;
}

export function parseSegmentWebhookPayload(rawPayload: unknown): SegmentRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Segment webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractSegmentConnectionMetadata(
  payload: unknown,
  headers: SegmentWebhookHeaders = {},
  options: NormalizeSegmentWebhookOptions = {},
): SegmentWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseSegmentWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: SegmentWebhookConnectionMetadata = {
    provider:
      options.provider ??
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      SEGMENT_PROVIDER,
  };

  const connectionId =
    options.connectionId ??
    readHeaderValue(normalizedHeaders, CONNECTION_ID_HEADER_KEYS) ??
    readOptionalString(record.connectionId) ??
    readOptionalString(record.connection_id) ??
    readOptionalString(metadata?.connectionId) ??
    readOptionalString(metadata?.connection_id) ??
    readOptionalString(normalizedConnection?.connectionId) ??
    readOptionalString(normalizedConnection?.connection_id) ??
    readOptionalString(connection?.id);
  if (connectionId) {
    result.connectionId = connectionId;
  }

  const providerConfigKey =
    options.providerConfigKey ??
    readHeaderValue(normalizedHeaders, PROVIDER_CONFIG_KEY_HEADER_KEYS) ??
    readOptionalString(record.providerConfigKey) ??
    readOptionalString(record.provider_config_key) ??
    readOptionalString(metadata?.providerConfigKey) ??
    readOptionalString(metadata?.provider_config_key) ??
    readOptionalString(normalizedConnection?.providerConfigKey) ??
    readOptionalString(normalizedConnection?.provider_config_key);
  if (providerConfigKey) {
    result.providerConfigKey = providerConfigKey;
  }

  const deliveryId =
    readOptionalString(normalizedHeaders[SEGMENT_DELIVERY_ID_HEADER]) ??
    readOptionalString(record.messageId) ??
    readOptionalString(record.message_id) ??
    readOptionalString(record.deliveryId) ??
    readOptionalString(record.delivery_id) ??
    readOptionalString(metadata?.deliveryId) ??
    readOptionalString(metadata?.delivery_id) ??
    readOptionalString(webhook?.deliveryId) ??
    readOptionalString(webhook?.delivery_id);
  if (deliveryId) {
    result.deliveryId = deliveryId;
  }

  const sourceId =
    options.sourceId ??
    readOptionalString(normalizedHeaders[SEGMENT_SOURCE_ID_HEADER]) ??
    readOptionalString(record.writeKey) ??
    readOptionalString(record.write_key) ??
    readOptionalString(metadata?.sourceId) ??
    readOptionalString(metadata?.source_id) ??
    readOptionalString(webhook?.sourceId) ??
    readOptionalString(webhook?.source_id);
  if (sourceId) {
    result.sourceId = sourceId;
  }

  const signature =
    readOptionalString(normalizedHeaders[SEGMENT_SIGNATURE_HEADER]) ??
    readOptionalString(record.signature) ??
    readOptionalString(metadata?.signature) ??
    readOptionalString(webhook?.signature);
  if (signature) {
    result.signature = signature;
  }

  const requestId =
    readHeaderValue(normalizedHeaders, REQUEST_ID_HEADER_KEYS) ??
    readOptionalString(record.requestId) ??
    readOptionalString(record.request_id) ??
    readOptionalString(metadata?.requestId) ??
    readOptionalString(metadata?.request_id) ??
    readOptionalString(normalizedConnection?.requestId) ??
    readOptionalString(normalizedConnection?.request_id);
  if (requestId) {
    result.requestId = requestId;
  }

  const timestamp =
    readTimestampHeader(normalizedHeaders[SEGMENT_TIMESTAMP_HEADER]) ??
    readOptionalTimestamp(record.timestamp) ??
    readOptionalTimestamp(record.sentAt) ??
    readOptionalTimestamp(record.sent_at) ??
    readOptionalTimestamp(record.receivedAt) ??
    readOptionalTimestamp(record.received_at) ??
    readOptionalTimestamp(webhook?.timestamp);
  if (timestamp !== undefined) {
    result.timestamp = timestamp;
  }

  return result;
}

export function extractSegmentObjectType(payload: unknown): string {
  const record = parseSegmentWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const rawType =
    readOptionalString(record.type) ??
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(metadata?.type) ??
    readOptionalString(metadata?.objectType) ??
    readOptionalString(metadata?.object_type) ??
    readOptionalString(webhook?.objectType) ??
    readOptionalString(webhook?.object_type);

  if (!rawType) {
    throw new Error('Segment webhook payload is missing type metadata.');
  }

  return normalizeSegmentObjectType(rawType);
}

export function extractSegmentObjectId(payload: unknown, objectType?: string): string {
  const record = parseSegmentWebhookPayload(payload);
  const normalizedType = normalizeSegmentObjectType(objectType ?? extractSegmentObjectType(record));
  const messageId = readOptionalString(record.messageId) ?? readOptionalString(record.message_id);

  if (normalizedType === 'identify') {
    const userId = readOptionalString(record.userId) ?? readOptionalString(record.user_id);
    const anonymousId = readOptionalString(record.anonymousId) ?? readOptionalString(record.anonymous_id);
    const id = userId ?? anonymousId ?? messageId;
    if (id) return id;
    throw new Error('Segment identify webhook is missing userId, anonymousId, and messageId.');
  }

  if (normalizedType === 'group') {
    const groupId = readOptionalString(record.groupId) ?? readOptionalString(record.group_id);
    const id = groupId ?? messageId;
    if (id) return id;
    throw new Error('Segment group webhook is missing groupId and messageId.');
  }

  if (messageId) {
    return messageId;
  }

  throw new Error(`Segment ${normalizedType} webhook is missing messageId.`);
}

export function extractSegmentEventType(payload: unknown, objectType?: string): string {
  const record = parseSegmentWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const normalizedType = normalizeSegmentObjectType(objectType ?? extractSegmentObjectType(record));
  const explicit =
    readOptionalString(record.eventType) ??
    readOptionalString(record.event_type) ??
    readOptionalString(metadata?.eventType) ??
    readOptionalString(metadata?.event_type) ??
    readOptionalString(webhook?.eventType) ??
    readOptionalString(webhook?.event_type);
  if (explicit) {
    const lowered = explicit.trim().toLowerCase();
    return lowered.includes('.') ? lowered : `${normalizedType}.${lowered}`;
  }
  return `${normalizedType}.upsert`;
}

export function validateSegmentWebhookSignature(
  rawPayload: string | Buffer,
  headers: SegmentWebhookHeaders,
  secret?: string,
  options: SegmentWebhookSecretOptions = {},
): SegmentWebhookSignatureValidationResult {
  const normalizedHeaders = normalizeHeaders(headers);
  const receivedSignature = readOptionalString(normalizedHeaders[SEGMENT_SIGNATURE_HEADER]);
  const resolvedSecret = resolveSecretFromOptions(rawPayload, normalizedHeaders, secret, options);
  const sourceId = options.sourceId ?? readOptionalString(normalizedHeaders[SEGMENT_SOURCE_ID_HEADER]);

  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature' };
  }
  if (!isHexSignature(receivedSignature)) {
    return { ok: false, reason: 'malformed-signature', receivedSignature };
  }
  if (!resolvedSecret) {
    return { ok: false, reason: 'missing-secret', receivedSignature };
  }

  const body = Buffer.isBuffer(rawPayload) ? rawPayload : Buffer.from(rawPayload, 'utf8');
  const expectedSignature = createHmac('sha1', resolvedSecret).update(body).digest('hex');
  const expected = Buffer.from(expectedSignature, 'hex');
  const received = Buffer.from(receivedSignature, 'hex');
  if (expected.length !== received.length) {
    const result: SegmentWebhookSignatureValidationResult = {
      expectedSignature,
      ok: false,
      reason: 'invalid-signature',
      receivedSignature,
    };
    if (sourceId) result.sourceId = sourceId;
    return result;
  }

  const ok = timingSafeEqual(expected, received);
  const result: SegmentWebhookSignatureValidationResult = {
    expectedSignature,
    ok,
    receivedSignature,
  };
  if (!ok) {
    result.reason = 'invalid-signature';
  }
  if (sourceId) {
    result.sourceId = sourceId;
  }
  return result;
}

export function assertValidSegmentWebhookSignature(
  rawPayload: string | Buffer,
  headers: SegmentWebhookHeaders,
  secret?: string,
  options: SegmentWebhookSecretOptions = {},
): void {
  const result = validateSegmentWebhookSignature(rawPayload, headers, secret, options);
  if (!result.ok) {
    throw new Error(`Segment webhook signature validation failed: ${result.reason}`);
  }
}

export function validateSegmentWebhookTimestamp(
  headers: SegmentWebhookHeaders,
  options: { now?: Date | number; toleranceSeconds?: number } = {},
): SegmentWebhookTimestampValidationResult {
  const normalizedHeaders = normalizeHeaders(headers);
  const timestamp = readTimestampHeader(normalizedHeaders[SEGMENT_TIMESTAMP_HEADER]);
  if (timestamp === undefined) {
    return { ok: false, reason: 'missing-timestamp' };
  }
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'malformed-timestamp' };
  }

  const now = typeof options.now === 'number' ? options.now : (options.now ?? new Date()).getTime();
  const toleranceMs = (options.toleranceSeconds ?? DEFAULT_TIMESTAMP_TOLERANCE_SECONDS) * 1000;
  const driftMs = Math.abs(now - timestamp);
  if (driftMs > toleranceMs) {
    return {
      driftMs,
      ok: false,
      reason: 'expired-timestamp',
      timestamp,
    };
  }

  return { driftMs, ok: true, timestamp };
}

function buildNormalizedPayload(
  payload: SegmentRecord,
  connection: SegmentWebhookConnectionMetadata,
  webhook: { eventType: string; objectId: string; objectType: string },
): SegmentRecord {
  const normalizedPayload: SegmentRecord = { ...payload };
  normalizedPayload._connection = compactRecord({
    connectionId: connection.connectionId,
    deliveryId: connection.deliveryId,
    provider: connection.provider,
    providerConfigKey: connection.providerConfigKey,
    requestId: connection.requestId,
    sourceId: connection.sourceId,
  });
  normalizedPayload._webhook = compactRecord({
    deliveryId: connection.deliveryId,
    eventType: webhook.eventType,
    objectId: webhook.objectId,
    objectType: webhook.objectType,
    signature: connection.signature,
    sourceId: connection.sourceId,
    timestamp: connection.timestamp,
  });
  return normalizedPayload;
}

function resolveWebhookSecret(
  rawPayload: string,
  headers: Record<string, string>,
  options: NormalizeSegmentWebhookOptions,
): string | undefined {
  return resolveSecretFromOptions(rawPayload, headers, options.secret, options);
}

function resolveSecretFromOptions(
  rawPayload: string | Buffer,
  headers: Record<string, string>,
  secret?: string,
  options: SegmentWebhookSecretOptions = {},
): string | undefined {
  const explicit = normalizeSecret(secret ?? options.secret);
  if (explicit) {
    return explicit;
  }

  const sourceId =
    options.sourceId ??
    readOptionalString(headers[SEGMENT_SOURCE_ID_HEADER]) ??
    readOptionalString(parseRawPayloadForSourceId(rawPayload));
  if (sourceId) {
    return normalizeSecret(options.sourceSecrets?.[sourceId]);
  }
  return undefined;
}

function parseRawPayloadForSourceId(rawPayload: string | Buffer): string | undefined {
  try {
    const decoded = JSON.parse(Buffer.isBuffer(rawPayload) ? rawPayload.toString('utf8') : rawPayload) as unknown;
    if (!isRecord(decoded)) return undefined;
    return readOptionalString(decoded.writeKey) ?? readOptionalString(decoded.write_key);
  } catch {
    return undefined;
  }
}

function decodeWebhookPayload(rawPayload: unknown): unknown {
  if (typeof rawPayload === 'string') {
    return JSON.parse(rawPayload) as unknown;
  }
  if (Buffer.isBuffer(rawPayload)) {
    return JSON.parse(rawPayload.toString('utf8')) as unknown;
  }
  return rawPayload;
}

function rawBodyString(rawPayload: unknown): string {
  if (typeof rawPayload === 'string') return rawPayload;
  if (Buffer.isBuffer(rawPayload)) return rawPayload.toString('utf8');
  return stableJson(rawPayload);
}

function normalizeHeaders(headers: SegmentWebhookHeaders = {}): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key.toLowerCase()] = value;
    });
    return normalized;
  }

  if (Symbol.iterator in Object(headers) && !isRecord(headers)) {
    for (const [key, value] of headers as Iterable<readonly [string, string]>) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }

  for (const [key, value] of Object.entries(headers as Record<string, HeaderValue>)) {
    const stringValue = stringifyHeaderValue(value);
    if (stringValue !== undefined) {
      normalized[key.toLowerCase()] = stringValue;
    }
  }
  return normalized;
}

function stringifyHeaderValue(value: HeaderValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function readHeaderValue(headers: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readOptionalString(headers[key]);
    if (value) return value;
  }
  return undefined;
}

function readTimestampHeader(value: unknown): number | undefined {
  const raw = readOptionalString(value);
  if (!raw) return undefined;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSecret(secret: string | undefined): string | undefined {
  const trimmed = secret?.trim();
  return trimmed ? trimmed : undefined;
}

function isHexSignature(value: string): boolean {
  return /^[a-f0-9]{40}$/iu.test(value);
}

function getRecord(value: unknown): SegmentRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is SegmentRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactRecord(input: Record<string, unknown>): SegmentRecord {
  const result: SegmentRecord = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }
  if (isRecord(value)) {
    const result: SegmentRecord = {};
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      result[key] = sortJson(value[key]);
    }
    return result;
  }
  return value;
}
