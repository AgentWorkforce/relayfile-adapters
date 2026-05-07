import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './intercom-adapter.js';
import { normalizeIntercomObjectType } from './path-mapper.js';

export const INTERCOM_PROVIDER = 'intercom';
export const INTERCOM_SIGNATURE_HEADER = 'x-hub-signature';
export const INTERCOM_TIMESTAMP_HEADER = 'x-intercom-request-timestamp';
export const INTERCOM_DELIVERY_HEADER = 'x-intercom-delivery-id';
export const INTERCOM_TOPIC_HEADER = 'x-intercom-topic';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-intercom-connection-id',
  'intercom-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-intercom-provider',
  'intercom-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-intercom-provider-config-key',
  'intercom-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = [
  'x-request-id',
  'x-correlation-id',
  'x-relay-request-id',
] as const;

type IntercomRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type IntercomWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface IntercomWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  timestamp?: number;
  webhookId?: string;
}

export interface IntercomWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?: 'invalid-signature' | 'malformed-signature' | 'missing-secret' | 'missing-signature';
  receivedSignature?: string;
}

export interface IntercomWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  timestamp?: number;
}

export function normalizeIntercomWebhook(
  rawPayload: unknown,
  headers: IntercomWebhookHeaders = {},
): NormalizedWebhook {
  const payload = parseIntercomWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const item = extractIntercomItem(payload);
  const objectType = extractIntercomObjectType(payload, normalizedHeaders, item);
  const objectId = extractIntercomObjectId(payload, item);
  const action = extractIntercomAction(payload, normalizedHeaders);
  const eventType = extractIntercomEventType(payload, normalizedHeaders, objectType, action);
  const connection = extractIntercomConnectionMetadata(payload, normalizedHeaders);

  const normalized: NormalizedWebhook = {
    provider: connection.provider,
    eventType,
    objectType,
    objectId,
    payload: buildNormalizedPayload(payload, item, normalizedHeaders, connection, {
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

export function parseIntercomWebhookPayload(rawPayload: unknown): IntercomRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Intercom webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractIntercomConnectionMetadata(
  payload: unknown,
  headers: IntercomWebhookHeaders = {},
): IntercomWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseIntercomWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: IntercomWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      INTERCOM_PROVIDER,
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
    readOptionalString(normalizedHeaders[INTERCOM_DELIVERY_HEADER]) ??
    readOptionalString(record.deliveryId) ??
    readOptionalString(record.delivery_id) ??
    readOptionalString(metadata?.deliveryId) ??
    readOptionalString(metadata?.delivery_id) ??
    readOptionalString(webhook?.deliveryId) ??
    readOptionalString(webhook?.delivery_id);
  if (deliveryId) {
    result.deliveryId = deliveryId;
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

  const signature =
    readOptionalString(normalizedHeaders[INTERCOM_SIGNATURE_HEADER]) ??
    readOptionalString(record.signature) ??
    readOptionalString(metadata?.signature) ??
    readOptionalString(webhook?.signature);
  if (signature) {
    result.signature = signature;
  }

  const timestamp =
    readTimestamp(normalizedHeaders[INTERCOM_TIMESTAMP_HEADER]) ??
    readTimestamp(record.timestamp) ??
    readTimestamp(record.webhookTimestamp) ??
    readTimestamp(record.webhook_timestamp) ??
    readTimestamp(metadata?.timestamp) ??
    readTimestamp(metadata?.webhookTimestamp) ??
    readTimestamp(webhook?.timestamp);
  if (timestamp !== undefined) {
    result.timestamp = timestamp;
  }

  const webhookId =
    readOptionalString(record.id) ??
    readOptionalString(record.webhookId) ??
    readOptionalString(record.webhook_id) ??
    readOptionalString(metadata?.webhookId) ??
    readOptionalString(metadata?.webhook_id) ??
    readOptionalString(webhook?.webhookId) ??
    readOptionalString(webhook?.webhook_id);
  if (webhookId) {
    result.webhookId = webhookId;
  }

  return result;
}

export function extractIntercomEventType(
  payload: unknown,
  headers: IntercomWebhookHeaders = {},
  objectType?: string,
  action?: string,
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseIntercomWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const resolvedObjectType = objectType ?? extractIntercomObjectType(record, normalizedHeaders);
  const resolvedAction = action ?? extractIntercomAction(record, normalizedHeaders);

  const explicitEventType =
    readOptionalString(record.eventType) ??
    readOptionalString(record.event_type) ??
    readOptionalString(metadata?.eventType) ??
    readOptionalString(metadata?.event_type) ??
    readOptionalString(webhook?.eventType) ??
    readOptionalString(webhook?.event_type);
  if (explicitEventType) {
    return canonicalizeEventType(explicitEventType, resolvedObjectType, resolvedAction);
  }

  return `${resolvedObjectType}.${resolvedAction}`;
}

export function extractIntercomObjectType(
  payload: unknown,
  headers: IntercomWebhookHeaders = {},
  item?: IntercomRecord,
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseIntercomWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const resolvedItem = item ?? extractIntercomItem(record);
  const rawType =
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(resolvedItem.type) ??
    firstTopicToken(readOptionalString(record.topic)) ??
    firstTopicToken(readOptionalString(normalizedHeaders[INTERCOM_TOPIC_HEADER])) ??
    readOptionalString(metadata?.objectType) ??
    readOptionalString(metadata?.object_type) ??
    readOptionalString(webhook?.objectType) ??
    readOptionalString(webhook?.object_type);

  if (!rawType) {
    throw new Error('Intercom webhook payload is missing object type metadata.');
  }

  return normalizeIntercomObjectType(rawType);
}

export function extractIntercomObjectId(payload: unknown, item?: IntercomRecord): string {
  const record = parseIntercomWebhookPayload(payload);
  const resolvedItem = item ?? extractIntercomItem(record);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);

  const objectId =
    readOptionalString(resolvedItem.id) ??
    readOptionalString(record.objectId) ??
    readOptionalString(record.object_id) ??
    readOptionalString(metadata?.objectId) ??
    readOptionalString(metadata?.object_id) ??
    readOptionalString(webhook?.objectId) ??
    readOptionalString(webhook?.object_id);

  if (!objectId) {
    throw new Error('Intercom webhook payload is missing an object identifier.');
  }

  return objectId;
}

export function computeIntercomWebhookSignature(
  rawPayload: unknown,
  secret: string,
): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error('Intercom webhook secret must be a non-empty string.');
  }

  const digest = createHmac('sha1', normalizedSecret)
    .update(toRawBodyBuffer(rawPayload))
    .digest('hex');
  return `sha1=${digest}`;
}

export function validateIntercomWebhookSignature(
  rawPayload: unknown,
  headers: IntercomWebhookHeaders,
  secret: string,
): IntercomWebhookSignatureValidationResult {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedSignature = readOptionalString(normalizedHeaders[INTERCOM_SIGNATURE_HEADER]);
  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature' };
  }

  const normalizedSignature = normalizeIntercomSignature(receivedSignature);
  if (!normalizedSignature) {
    return { ok: false, reason: 'malformed-signature', receivedSignature };
  }

  const expectedSignature = computeIntercomWebhookSignature(rawPayload, normalizedSecret);
  const expectedDigest = normalizeIntercomSignature(expectedSignature);
  if (!expectedDigest) {
    return { ok: false, reason: 'malformed-signature', receivedSignature };
  }

  const headerBuffer = Buffer.from(normalizedSignature, 'utf8');
  const expectedBuffer = Buffer.from(expectedDigest, 'utf8');
  if (headerBuffer.length === 0 || headerBuffer.length !== expectedBuffer.length) {
    return {
      ok: false,
      reason: 'invalid-signature',
      expectedSignature,
      receivedSignature,
    };
  }

  const ok = timingSafeEqual(expectedBuffer, headerBuffer);
  return {
    ok,
    ...(ok
      ? { expectedSignature, receivedSignature }
      : { reason: 'invalid-signature', expectedSignature, receivedSignature }),
  };
}

export function assertValidIntercomWebhookSignature(
  rawPayload: unknown,
  headers: IntercomWebhookHeaders,
  secret: string,
): void {
  const result = validateIntercomWebhookSignature(rawPayload, headers, secret);
  if (!result.ok) {
    throw new Error(
      `Invalid Intercom webhook signature${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function validateIntercomWebhookTimestamp(
  headersOrPayload: IntercomWebhookHeaders | unknown,
  toleranceMs = 300_000,
  now = Date.now(),
): IntercomWebhookTimestampValidationResult {
  const timestamp = readTimestampFromHeadersOrPayload(headersOrPayload);
  if (timestamp === undefined) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const driftMs = Math.abs(now - timestamp);
  if (driftMs > toleranceMs) {
    return { ok: false, reason: 'stale-timestamp', timestamp, driftMs };
  }

  return { ok: true, timestamp, driftMs };
}

export function assertValidIntercomWebhookTimestamp(
  headersOrPayload: IntercomWebhookHeaders | unknown,
  toleranceMs = 300_000,
  now = Date.now(),
): void {
  const result = validateIntercomWebhookTimestamp(headersOrPayload, toleranceMs, now);
  if (!result.ok) {
    throw new Error(
      `Invalid Intercom webhook timestamp${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

function buildNormalizedPayload(
  payload: IntercomRecord,
  item: IntercomRecord,
  headers: Record<string, string>,
  connection: IntercomWebhookConnectionMetadata,
  normalized: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): IntercomRecord {
  const existingConnection = getRecord(payload._connection);
  const existingWebhook = getRecord(payload._webhook);
  const normalizedPayload: IntercomRecord = { ...item };

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
    appId: readOptionalString(payload.app_id) ?? readOptionalString(existingWebhook?.appId),
    createdAt: stringifyTimestamp(payload.created_at) ?? readOptionalString(existingWebhook?.createdAt),
    deliveryAttempts:
      readOptionalNumber(payload.delivery_attempts) ?? readOptionalNumber(existingWebhook?.deliveryAttempts),
    deliveryId: connection.deliveryId ?? readOptionalString(existingWebhook?.deliveryId),
    eventType: normalized.eventType,
    objectId: normalized.objectId,
    objectType: normalized.objectType,
    requestTimestamp: connection.timestamp ?? readOptionalNumber(existingWebhook?.requestTimestamp),
    signature: connection.signature ?? readOptionalString(existingWebhook?.signature),
    topic:
      readOptionalString(payload.topic) ??
      readOptionalString(headers[INTERCOM_TOPIC_HEADER]) ??
      readOptionalString(existingWebhook?.topic),
    type: readOptionalString(payload.type) ?? readOptionalString(existingWebhook?.type),
    webhookId: connection.webhookId ?? readOptionalString(existingWebhook?.webhookId),
  });

  return normalizedPayload;
}

function extractIntercomItem(payload: IntercomRecord): IntercomRecord {
  const directItem = getRecord(payload.item);
  if (directItem) {
    return directItem;
  }

  const data = getRecord(payload.data);
  if (data) {
    const nestedItem = getRecord(data.item);
    if (nestedItem) {
      return nestedItem;
    }

    if (readOptionalString(data.id)) {
      return data;
    }
  }

  if (readOptionalString(payload.id) && !readOptionalString(payload.topic)) {
    return payload;
  }

  return {};
}

function extractIntercomAction(payload: IntercomRecord, headers: Record<string, string>): string {
  const metadata = getRecord(payload.metadata);
  const webhook = getRecord(payload._webhook);
  const topic =
    readOptionalString(payload.topic) ??
    readOptionalString(headers[INTERCOM_TOPIC_HEADER]) ??
    readOptionalString(metadata?.topic) ??
    readOptionalString(webhook?.topic);
  const explicitAction =
    readOptionalString(payload.action) ??
    readOptionalString(metadata?.action) ??
    readOptionalString(webhook?.action);
  const topicAction = lastTopicToken(topic);
  const action = explicitAction ?? topicAction;
  if (!action) {
    throw new Error('Intercom webhook payload is missing action metadata.');
  }
  return normalizeAction(action);
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'create':
      return 'created';
    case 'update':
      return 'updated';
    case 'delete':
    case 'destroyed':
    case 'remove':
    case 'removed':
      return 'deleted';
    default:
      return normalized;
  }
}

function canonicalizeEventType(
  value: string,
  objectType: string,
  action: string,
): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return `${objectType}.${action}`;
  }

  const tokens = normalized.split('.').filter(Boolean);
  if (tokens.length > 1) {
    return `${objectType}.${normalizeAction(tokens[tokens.length - 1] ?? action)}`;
  }

  if (normalized === objectType) {
    return `${objectType}.${action}`;
  }

  return `${objectType}.${normalizeAction(normalized)}`;
}

function normalizeIntercomSignature(value: string): string | undefined {
  const trimmed = value.trim();
  const match = /^sha1=([0-9a-f]{40})$/iu.exec(trimmed);
  return match?.[1]?.toLowerCase();
}

function readTimestampFromHeadersOrPayload(value: IntercomWebhookHeaders | unknown): number | undefined {
  if (isHeadersLike(value)) {
    const headers = normalizeHeaders(value as IntercomWebhookHeaders);
    return readTimestamp(headers[INTERCOM_TIMESTAMP_HEADER]);
  }

  if (isRecord(value)) {
    const metadata = getRecord(value.metadata);
    const webhook = getRecord(value._webhook);
    return (
      readTimestamp(value.timestamp) ??
      readTimestamp(value.webhookTimestamp) ??
      readTimestamp(value.webhook_timestamp) ??
      readTimestamp(metadata?.timestamp) ??
      readTimestamp(metadata?.webhookTimestamp) ??
      readTimestamp(webhook?.requestTimestamp) ??
      readTimestamp(webhook?.timestamp)
    );
  }

  return undefined;
}

function isHeadersLike(value: unknown): boolean {
  if (typeof Headers !== 'undefined' && value instanceof Headers) {
    return true;
  }
  if (isIterableEntries(value)) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.keys(value).some((key) => key.toLowerCase().startsWith('x-'));
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

function normalizeHeaders(headers: IntercomWebhookHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      const normalizedValue = readOptionalString(value);
      if (normalizedValue) {
        normalized[key.toLowerCase()] = normalizedValue;
      }
    }
    return normalized;
  }

  if (isIterableEntries(headers)) {
    for (const entry of headers) {
      const key = readOptionalString(entry[0]);
      const value = readOptionalString(entry[1]);
      if (key && value) {
        normalized[key.toLowerCase()] = value;
      }
    }
    return normalized;
  }

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = readOptionalString(key);
    const normalizedValue = normalizeHeaderValue(value);
    if (normalizedKey && normalizedValue) {
      normalized[normalizedKey.toLowerCase()] = normalizedValue;
    }
  }

  return normalized;
}

function readHeaderValue(
  headers: Record<string, string>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = readOptionalString(headers[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean).join(',');
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function isIterableEntries(value: unknown): value is Iterable<readonly [string, string]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.iterator in value &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function' &&
    !(typeof Headers !== 'undefined' && value instanceof Headers)
  );
}

function firstTopicToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.split('.').filter(Boolean)[0];
}

function lastTopicToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const tokens = value.split('.').filter(Boolean);
  return tokens.at(-1);
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as T;
}

function stringifyTimestamp(value: unknown): string | undefined {
  const timestamp = readTimestamp(value);
  if (timestamp === undefined) {
    const raw = readOptionalString(value);
    return raw;
  }
  return new Date(timestamp).toISOString();
}

function readTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return readTimestamp(parsed);
    }
    const parsedDate = Date.parse(trimmed);
    return Number.isFinite(parsedDate) ? parsedDate : undefined;
  }

  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
