import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './airtable-adapter.js';
import { normalizeAirtableObjectType } from './path-mapper.js';

export const AIRTABLE_PROVIDER = 'airtable';
export const AIRTABLE_CONTENT_MAC_HEADER = 'x-airtable-content-mac';
export const AIRTABLE_TIMESTAMP_HEADER = 'x-airtable-timestamp';
export const AIRTABLE_DELIVERY_HEADER = 'x-airtable-delivery';
export const AIRTABLE_EVENT_HEADER = 'x-airtable-event';
export const AIRTABLE_SIGNATURE_PREFIX = 'hmac-sha256=';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-airtable-connection-id',
  'airtable-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-airtable-provider',
  'airtable-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-airtable-provider-config-key',
  'airtable-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;
const DEFAULT_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

type AirtableRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type AirtableWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface AirtableWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  webhookTimestamp?: number;
}

export interface AirtableWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?: 'invalid-signature' | 'malformed-signature' | 'missing-secret' | 'missing-signature';
  receivedSignature?: string;
}

export interface AirtableWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

export interface NormalizeAirtableWebhookOptions {
  nowMs?: number;
  requireTimestamp?: boolean;
  toleranceMs?: number;
  webhookSecret?: string;
}

export function normalizeAirtableWebhook(
  rawPayload: unknown,
  headers: AirtableWebhookHeaders = {},
  options: NormalizeAirtableWebhookOptions = {},
): NormalizedWebhook {
  const normalizedHeaders = normalizeHeaders(headers);
  if (options.webhookSecret !== undefined) {
    if (!isRawWebhookBody(rawPayload)) {
      throw new Error('Airtable webhook signature validation requires the original raw request body.');
    }
    assertValidAirtableWebhookSignature(rawPayload, normalizedHeaders, options.webhookSecret);
  }

  const timestampResult = validateAirtableWebhookTimestamp(
    rawPayload,
    normalizedHeaders,
    options.toleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS,
    options.nowMs,
    options.requireTimestamp ?? false,
  );
  if (!timestampResult.ok) {
    throw new Error(`Invalid Airtable webhook timestamp: ${timestampResult.reason}`);
  }

  const payload = parseAirtableWebhookPayload(rawPayload);
  const objectType = extractAirtableObjectType(payload, normalizedHeaders);
  const objectId = extractAirtableObjectId(payload, objectType);
  const action = extractAirtableAction(payload);
  const eventType = extractAirtableEventType(payload, normalizedHeaders, objectType, action);
  const connection = extractAirtableConnectionMetadata(payload, normalizedHeaders);

  const normalized: NormalizedWebhook = {
    provider: connection.provider,
    eventType,
    objectType,
    objectId,
    payload: buildNormalizedPayload(payload, normalizedHeaders, connection, {
      action,
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

export function parseAirtableWebhookPayload(rawPayload: unknown): AirtableRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Airtable webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractAirtableConnectionMetadata(
  payload: unknown,
  headers: AirtableWebhookHeaders = {},
): AirtableWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseAirtableWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: AirtableWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      AIRTABLE_PROVIDER,
  };

  const connectionId =
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
    readOptionalString(normalizedHeaders[AIRTABLE_DELIVERY_HEADER]) ??
    readOptionalString(record.deliveryId) ??
    readOptionalString(record.delivery_id) ??
    readOptionalString(metadata?.deliveryId) ??
    readOptionalString(metadata?.delivery_id) ??
    readOptionalString(webhook?.deliveryId) ??
    readOptionalString(webhook?.delivery_id);
  if (deliveryId) {
    result.deliveryId = deliveryId;
  }

  const signature =
    readOptionalString(normalizedHeaders[AIRTABLE_CONTENT_MAC_HEADER]) ??
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

  const webhookTimestamp =
    readOptionalTimestamp(normalizedHeaders[AIRTABLE_TIMESTAMP_HEADER]) ??
    readOptionalTimestamp(record.webhookTimestamp) ??
    readOptionalTimestamp(record.webhook_timestamp) ??
    readOptionalTimestamp(record.timestamp) ??
    readOptionalTimestamp(metadata?.webhookTimestamp) ??
    readOptionalTimestamp(metadata?.webhook_timestamp) ??
    readOptionalTimestamp(webhook?.webhookTimestamp) ??
    readOptionalTimestamp(webhook?.webhook_timestamp);
  if (webhookTimestamp !== undefined) {
    result.webhookTimestamp = webhookTimestamp;
  }

  return result;
}

export function extractAirtableEventType(
  payload: unknown,
  headers: AirtableWebhookHeaders = {},
  objectType?: string,
  action?: string,
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseAirtableWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const resolvedObjectType = objectType ?? extractAirtableObjectType(record, normalizedHeaders);
  const resolvedAction = action ?? extractAirtableAction(record);
  const explicitEventType =
    readOptionalString(record.eventType) ??
    readOptionalString(record.event_type) ??
    readOptionalString(metadata?.eventType) ??
    readOptionalString(metadata?.event_type) ??
    readOptionalString(webhook?.eventType) ??
    readOptionalString(webhook?.event_type);
  if (explicitEventType) {
    const parts = explicitEventType.trim().toLowerCase().split(/[.:]/u).filter(Boolean);
    if (parts.length >= 2) {
      return `${normalizeAirtableObjectType(parts[0] ?? resolvedObjectType)}.${normalizeAction(parts[1] ?? resolvedAction)}`;
    }
  }
  return `${resolvedObjectType}.${resolvedAction}`;
}

export function extractAirtableObjectType(
  payload: unknown,
  headers: AirtableWebhookHeaders = {},
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseAirtableWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const data = getRecord(record.data);
  const rawType =
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(record.type) ??
    readOptionalString(normalizedHeaders[AIRTABLE_EVENT_HEADER]) ??
    readOptionalString(data?.objectType) ??
    readOptionalString(data?.object_type) ??
    readOptionalString(data?.type) ??
    readOptionalString(metadata?.objectType) ??
    readOptionalString(metadata?.object_type) ??
    readOptionalString(webhook?.objectType) ??
    readOptionalString(webhook?.object_type);

  if (rawType) {
    return normalizeAirtableObjectType(rawType);
  }

  if (isRecord(record.record) || isRecord(data?.record) || looksLikeAirtableRecord(data)) {
    return 'record';
  }
  if (isRecord(record.table) || isRecord(data?.table) || Array.isArray(record.fields) || Array.isArray(data?.fields)) {
    return 'table';
  }
  if (isRecord(record.base) || isRecord(data?.base) || Array.isArray(record.tables) || Array.isArray(data?.tables)) {
    return 'base';
  }

  throw new Error('Airtable webhook payload is missing object type metadata.');
}

export function extractAirtableObjectId(payload: unknown, objectType?: string): string {
  const record = parseAirtableWebhookPayload(payload);
  const data = getRecord(record.data);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const normalizedType = objectType ? normalizeAirtableObjectType(objectType) : extractAirtableObjectType(record);

  const objectByType =
    normalizedType === 'record'
      ? getRecord(record.record) ?? getRecord(data?.record)
      : normalizedType === 'table'
        ? getRecord(record.table) ?? getRecord(data?.table)
        : getRecord(record.base) ?? getRecord(data?.base);

  const objectId =
    readOptionalString(objectByType?.id) ??
    readOptionalString(data?.id) ??
    readOptionalString(record.objectId) ??
    readOptionalString(record.object_id) ??
    readOptionalString(metadata?.objectId) ??
    readOptionalString(metadata?.object_id) ??
    readOptionalString(webhook?.objectId) ??
    readOptionalString(webhook?.object_id) ??
    readOptionalString(record.id);

  if (!objectId) {
    throw new Error('Airtable webhook payload is missing an object identifier.');
  }

  return objectId;
}

export function computeAirtableWebhookSignature(rawPayload: unknown, secret: string): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error('Airtable webhook secret must be a non-empty string.');
  }

  const digest = createHmac('sha256', normalizedSecret)
    .update(toRawBodyBuffer(rawPayload))
    .digest('hex');
  return `${AIRTABLE_SIGNATURE_PREFIX}${digest}`;
}

export function validateAirtableWebhookSignature(
  rawPayload: unknown,
  headers: AirtableWebhookHeaders,
  secret: string,
): AirtableWebhookSignatureValidationResult {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedSignature = readOptionalString(normalizedHeaders[AIRTABLE_CONTENT_MAC_HEADER]);
  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature' };
  }

  const normalizedSignature = normalizeMacHeader(receivedSignature);
  if (!normalizedSignature) {
    return { ok: false, reason: 'malformed-signature', receivedSignature };
  }

  const expectedSignature = computeAirtableWebhookSignature(rawPayload, normalizedSecret);
  const receivedBuffer = Buffer.from(normalizedSignature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  const ok = receivedBuffer.length === expectedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  return {
    ok,
    ...(ok
      ? { expectedSignature, receivedSignature }
      : { expectedSignature, reason: 'invalid-signature' as const, receivedSignature }),
  };
}

export function assertValidAirtableWebhookSignature(
  rawPayload: unknown,
  headers: AirtableWebhookHeaders,
  secret: string,
): void {
  const result = validateAirtableWebhookSignature(rawPayload, headers, secret);
  if (!result.ok) {
    throw new Error(`Invalid Airtable webhook signature${result.reason ? ` (${result.reason})` : ''}.`);
  }
}

export function validateAirtableWebhookTimestamp(
  payload: unknown,
  headers: AirtableWebhookHeaders = {},
  toleranceMs = DEFAULT_WEBHOOK_TOLERANCE_MS,
  nowMs = Date.now(),
  requireTimestamp = false,
): AirtableWebhookTimestampValidationResult {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = safelyParseAirtableWebhookPayload(payload);
  const metadata = getRecord(record?.metadata);
  const webhook = getRecord(record?._webhook);
  const webhookTimestamp =
    readOptionalTimestamp(normalizedHeaders[AIRTABLE_TIMESTAMP_HEADER]) ??
    readOptionalTimestamp(record?.webhookTimestamp) ??
    readOptionalTimestamp(record?.webhook_timestamp) ??
    readOptionalTimestamp(record?.timestamp) ??
    readOptionalTimestamp(metadata?.webhookTimestamp) ??
    readOptionalTimestamp(metadata?.webhook_timestamp) ??
    readOptionalTimestamp(webhook?.webhookTimestamp) ??
    readOptionalTimestamp(webhook?.webhook_timestamp);

  if (webhookTimestamp === undefined) {
    return requireTimestamp ? { ok: false, reason: 'missing-timestamp' } : { ok: true };
  }

  const driftMs = Math.abs(nowMs - webhookTimestamp);
  if (driftMs > toleranceMs) {
    return {
      driftMs,
      ok: false,
      reason: 'stale-timestamp',
      webhookTimestamp,
    };
  }

  return {
    driftMs,
    ok: true,
    webhookTimestamp,
  };
}

export function assertValidAirtableWebhookTimestamp(
  payload: unknown,
  headers: AirtableWebhookHeaders = {},
  toleranceMs = DEFAULT_WEBHOOK_TOLERANCE_MS,
  nowMs = Date.now(),
  requireTimestamp = false,
): void {
  const result = validateAirtableWebhookTimestamp(payload, headers, toleranceMs, nowMs, requireTimestamp);
  if (!result.ok) {
    throw new Error(`Invalid Airtable webhook timestamp${result.reason ? ` (${result.reason})` : ''}.`);
  }
}

function buildNormalizedPayload(
  payload: AirtableRecord,
  headers: Record<string, string>,
  connection: AirtableWebhookConnectionMetadata,
  normalized: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): AirtableRecord {
  const existingConnection = getRecord(payload._connection);
  const existingWebhook = getRecord(payload._webhook);
  const normalizedPayload: AirtableRecord = { ...payload };

  normalizedPayload._connection = compactObject({
    ...existingConnection,
    connectionId: connection.connectionId,
    deliveryId: connection.deliveryId,
    provider: connection.provider,
    providerConfigKey: connection.providerConfigKey,
    requestId: connection.requestId,
  });

  normalizedPayload._webhook = compactObject({
    ...existingWebhook,
    action: normalized.action,
    deliveryId: connection.deliveryId ?? readOptionalString(existingWebhook?.deliveryId),
    eventHeader: readOptionalString(headers[AIRTABLE_EVENT_HEADER]) ?? readOptionalString(existingWebhook?.eventHeader),
    eventType: normalized.eventType,
    objectId: normalized.objectId,
    objectType: normalized.objectType,
    signature: connection.signature ?? readOptionalString(existingWebhook?.signature),
    webhookTimestamp:
      connection.webhookTimestamp ??
      readOptionalNumber(payload.webhookTimestamp) ??
      readOptionalNumber(payload.timestamp) ??
      readOptionalNumber(existingWebhook?.webhookTimestamp),
  });

  return normalizedPayload;
}

function extractAirtableAction(payload: AirtableRecord): string {
  const metadata = getRecord(payload.metadata);
  const webhook = getRecord(payload._webhook);
  const raw =
    readOptionalString(payload.action) ??
    readOptionalString(payload.changeType) ??
    readOptionalString(payload.change_type) ??
    readOptionalString(metadata?.action) ??
    readOptionalString(webhook?.action) ??
    'update';
  return normalizeAction(raw);
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'add':
    case 'added':
    case 'create':
    case 'created':
    case 'insert':
      return 'create';
    case 'delete':
    case 'deleted':
    case 'destroy':
    case 'remove':
    case 'removed':
      return 'delete';
    case 'change':
    case 'changed':
    case 'modify':
    case 'modified':
    case 'update':
    case 'updated':
      return 'update';
    default:
      return normalized || 'update';
  }
}

function decodeWebhookPayload(rawPayload: unknown): unknown {
  if (typeof rawPayload === 'string') {
    return JSON.parse(rawPayload);
  }
  if (Buffer.isBuffer(rawPayload)) {
    return JSON.parse(rawPayload.toString('utf8'));
  }
  if (rawPayload instanceof Uint8Array) {
    return JSON.parse(Buffer.from(rawPayload).toString('utf8'));
  }
  if (rawPayload instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(rawPayload).toString('utf8'));
  }
  return rawPayload;
}

function safelyParseAirtableWebhookPayload(rawPayload: unknown): AirtableRecord | undefined {
  try {
    return parseAirtableWebhookPayload(rawPayload);
  } catch {
    return undefined;
  }
}

function toRawBodyBuffer(rawPayload: unknown): Buffer {
  if (typeof rawPayload === 'string') {
    return Buffer.from(rawPayload, 'utf8');
  }
  if (Buffer.isBuffer(rawPayload)) {
    return rawPayload;
  }
  if (rawPayload instanceof Uint8Array) {
    return Buffer.from(rawPayload);
  }
  if (rawPayload instanceof ArrayBuffer) {
    return Buffer.from(rawPayload);
  }
  return Buffer.from(JSON.stringify(rawPayload), 'utf8');
}

function isRawWebhookBody(rawPayload: unknown): boolean {
  return (
    typeof rawPayload === 'string' ||
    Buffer.isBuffer(rawPayload) ||
    rawPayload instanceof Uint8Array ||
    rawPayload instanceof ArrayBuffer
  );
}

function normalizeMacHeader(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith(AIRTABLE_SIGNATURE_PREFIX)) {
    return undefined;
  }
  const digest = trimmed.slice(AIRTABLE_SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    return undefined;
  }
  return `${AIRTABLE_SIGNATURE_PREFIX}${digest}`;
}

function normalizeHeaders(headers: AirtableWebhookHeaders): Record<string, string> {
  if (headers instanceof Headers) {
    return Object.fromEntries(Array.from(headers.entries()).map(([key, value]) => [key.toLowerCase(), value]));
  }

  if (isIterableHeaders(headers)) {
    const normalized: Record<string, string> = {};
    for (const [key, value] of headers) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedValue = normalizeHeaderValue(value);
    if (normalizedValue !== undefined) {
      normalized[key.toLowerCase()] = normalizedValue;
    }
  }
  return normalized;
}

function isIterableHeaders(value: unknown): value is Iterable<readonly [string, string]> {
  return typeof value === 'object' && value !== null && Symbol.iterator in value;
}

function normalizeHeaderValue(value: HeaderValue): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(String).join(',');
  }
  return String(value);
}

function readHeaderValue(headers: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readOptionalString(headers[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  const number = readOptionalNumber(value);
  if (number === undefined) {
    return undefined;
  }
  return number < 10_000_000_000 ? number * 1000 : number;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getRecord(value: unknown): AirtableRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is AirtableRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeAirtableRecord(value: unknown): boolean {
  const record = getRecord(value);
  return Boolean(record && (isRecord(record.fields) || readOptionalString(record.tableId) || readOptionalString(record.table_id)));
}

function compactObject<T extends Record<string, unknown>>(object: T): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined && value !== null) {
      compacted[key] = value;
    }
  }
  return compacted;
}
