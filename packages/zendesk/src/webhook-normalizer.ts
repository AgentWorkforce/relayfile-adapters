import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './zendesk-adapter.js';
import { normalizeZendeskObjectType } from './path-mapper.js';

export const ZENDESK_PROVIDER = 'zendesk';
/**
 * Header name as documented by Zendesk's verifying-webhooks reference. The
 * value is HMAC-SHA256 of (timestamp + raw body) encoded as base64. Despite
 * the algorithm being SHA-256, Zendesk does NOT include "-256" in the header
 * name — that mistake produces silent "missing-signature" rejections in
 * production because the header lookup never matches a real delivery.
 */
export const ZENDESK_SIGNATURE_HEADER = 'X-Zendesk-Webhook-Signature';

/** @deprecated Alias for ZENDESK_SIGNATURE_HEADER. The "-256" suffix is not part of the actual Zendesk header name; use ZENDESK_SIGNATURE_HEADER. */
export const ZENDESK_SIGNATURE_256_HEADER = ZENDESK_SIGNATURE_HEADER;
export const ZENDESK_SIGNATURE_TIMESTAMP_HEADER = 'X-Zendesk-Webhook-Signature-Timestamp';
export const ZENDESK_EVENT_HEADER = 'X-Zendesk-Webhook-Event';
export const ZENDESK_DELIVERY_HEADER = 'X-Zendesk-Webhook-Id';
export const ZENDESK_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-zendesk-connection-id',
  'zendesk-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-zendesk-provider',
  'zendesk-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-zendesk-provider-config-key',
  'zendesk-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;

const OBJECT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  organization: 'organization',
  organizations: 'organization',
  ticket: 'ticket',
  tickets: 'ticket',
  user: 'user',
  users: 'user',
};

type ZendeskRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type ZendeskWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface ZendeskWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  webhookTimestamp?: number;
}

export interface ZendeskWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?:
    | 'expired-timestamp'
    | 'invalid-signature'
    | 'malformed-signature'
    | 'malformed-timestamp'
    | 'missing-secret'
    | 'missing-signature'
    | 'missing-timestamp'
    | undefined;
  receivedSignature?: string;
  webhookTimestamp?: number | undefined;
}

export interface ZendeskWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'expired-timestamp' | 'malformed-timestamp' | 'missing-timestamp' | undefined;
  webhookTimestamp?: number | undefined;
}

export function normalizeZendeskWebhook(
  rawPayload: unknown,
  headers: ZendeskWebhookHeaders = {},
): NormalizedWebhook {
  const payload = parseZendeskWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const objectType = extractZendeskObjectType(payload, normalizedHeaders);
  const objectId = extractZendeskObjectId(payload, objectType);
  const action = extractZendeskAction(payload, normalizedHeaders).toLowerCase();
  const eventType = extractZendeskEventType(payload, normalizedHeaders, objectType, action);
  const connection = extractZendeskConnectionMetadata(payload, normalizedHeaders);

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

export function parseZendeskWebhookPayload(rawPayload: unknown): ZendeskRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Zendesk webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractZendeskConnectionMetadata(
  payload: unknown,
  headers: ZendeskWebhookHeaders = {},
): ZendeskWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseZendeskWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: ZendeskWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      ZENDESK_PROVIDER,
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
    readOptionalString(normalizedHeaders[ZENDESK_DELIVERY_HEADER.toLowerCase()]) ??
    readOptionalString(record.deliveryId) ??
    readOptionalString(record.delivery_id) ??
    readOptionalString(metadata?.deliveryId) ??
    readOptionalString(metadata?.delivery_id) ??
    readOptionalString(normalizedConnection?.deliveryId) ??
    readOptionalString(normalizedConnection?.delivery_id) ??
    readOptionalString(webhook?.deliveryId) ??
    readOptionalString(webhook?.delivery_id);
  if (deliveryId) {
    result.deliveryId = deliveryId;
  }

  const signature =
    readOptionalString(normalizedHeaders[ZENDESK_SIGNATURE_HEADER.toLowerCase()]) ??
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
    readTimestampHeader(normalizedHeaders[ZENDESK_SIGNATURE_TIMESTAMP_HEADER.toLowerCase()]) ??
    readOptionalTimestamp(record.webhookTimestamp) ??
    readOptionalTimestamp(record.webhook_timestamp) ??
    readOptionalTimestamp(metadata?.webhookTimestamp) ??
    readOptionalTimestamp(metadata?.webhook_timestamp) ??
    readOptionalTimestamp(webhook?.webhookTimestamp) ??
    readOptionalTimestamp(webhook?.webhook_timestamp);
  if (webhookTimestamp !== undefined) {
    result.webhookTimestamp = webhookTimestamp;
  }

  return result;
}

export function extractZendeskEventType(
  payload: unknown,
  headers: ZendeskWebhookHeaders = {},
  objectType?: string,
  action?: string,
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseZendeskWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const resolvedObjectType = objectType ?? extractZendeskObjectType(record, normalizedHeaders);
  const resolvedAction = action ?? extractZendeskAction(record, normalizedHeaders).toLowerCase();

  const explicitEventType =
    readOptionalString(record.eventType) ??
    readOptionalString(record.event_type) ??
    readOptionalString(normalizedHeaders[ZENDESK_EVENT_HEADER.toLowerCase()]) ??
    readOptionalString(metadata?.eventType) ??
    readOptionalString(metadata?.event_type) ??
    readOptionalString(webhook?.eventType) ??
    readOptionalString(webhook?.event_type);
  if (explicitEventType) {
    return canonicalizeEventType(explicitEventType, resolvedObjectType, resolvedAction);
  }

  return `${resolvedObjectType}.${canonicalizeAction(resolvedAction)}`;
}

export function extractZendeskObjectType(
  payload: unknown,
  headers: ZendeskWebhookHeaders = {},
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseZendeskWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const data = getRecord(record.data);
  const rawType =
    readOptionalString(record.type) ??
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(normalizedHeaders[ZENDESK_EVENT_HEADER.toLowerCase()]) ??
    readOptionalString(metadata?.type) ??
    readOptionalString(metadata?.objectType) ??
    readOptionalString(metadata?.object_type) ??
    readOptionalString(webhook?.objectType) ??
    readOptionalString(webhook?.object_type) ??
    readOptionalString(data?.object_type);

  if (rawType) {
    return canonicalizeObjectType(rawType);
  }

  if (isRecord(record.ticket)) return 'ticket';
  if (isRecord(record.user)) return 'user';
  if (isRecord(record.organization)) return 'organization';

  throw new Error('Zendesk webhook payload is missing type metadata.');
}

export function extractZendeskObjectId(payload: unknown, objectType?: string): string {
  const record = parseZendeskWebhookPayload(payload);
  const resolvedObjectType = objectType ? normalizeZendeskObjectType(objectType) : extractZendeskObjectType(record);
  const objectRecord = getRecord(record[resolvedObjectType]);
  const data = getRecord(record.data);
  const nestedData = getRecord(data?.[resolvedObjectType]);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);

  const objectId =
    readZendeskId(objectRecord?.id) ??
    readZendeskId(nestedData?.id) ??
    readZendeskId(data?.id) ??
    readZendeskId(record.objectId) ??
    readZendeskId(record.object_id) ??
    readZendeskId(metadata?.objectId) ??
    readZendeskId(metadata?.object_id) ??
    readZendeskId(webhook?.objectId) ??
    readZendeskId(webhook?.object_id) ??
    readZendeskId(record.id);

  if (!objectId) {
    throw new Error('Zendesk webhook payload is missing an object identifier.');
  }

  return objectId;
}

export function computeZendeskWebhookSignature(
  rawPayload: unknown,
  timestamp: string | number,
  secret: string,
): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error('Zendesk webhook secret must be a non-empty string.');
  }

  const timestampString = String(timestamp).trim();
  if (!timestampString) {
    throw new Error('Zendesk webhook timestamp must be a non-empty string.');
  }

  return createHmac('sha256', normalizedSecret)
    .update(timestampString)
    .update(toRawBodyBuffer(rawPayload))
    .digest('base64');
}

export function validateZendeskWebhookTimestamp(
  headers: ZendeskWebhookHeaders,
  toleranceMs = ZENDESK_SIGNATURE_TOLERANCE_MS,
  now = Date.now(),
): ZendeskWebhookTimestampValidationResult {
  const normalizedHeaders = normalizeHeaders(headers);
  const rawTimestamp = normalizedHeaders[ZENDESK_SIGNATURE_TIMESTAMP_HEADER.toLowerCase()];
  if (!rawTimestamp) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const webhookTimestamp = readTimestampHeader(rawTimestamp);
  if (webhookTimestamp === undefined) {
    return { ok: false, reason: 'malformed-timestamp' };
  }

  const driftMs = Math.abs(now - webhookTimestamp);
  if (driftMs > toleranceMs) {
    return { ok: false, reason: 'expired-timestamp', webhookTimestamp, driftMs };
  }

  return { ok: true, webhookTimestamp, driftMs };
}

export function validateZendeskWebhookSignature(
  rawPayload: unknown,
  headers: ZendeskWebhookHeaders,
  secret: string,
  now = Date.now(),
): ZendeskWebhookSignatureValidationResult {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const timestampResult = validateZendeskWebhookTimestamp(headers, ZENDESK_SIGNATURE_TOLERANCE_MS, now);
  if (!timestampResult.ok) {
    return {
      ok: false,
      reason: timestampResult.reason,
      webhookTimestamp: timestampResult.webhookTimestamp,
    };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const timestamp = normalizedHeaders[ZENDESK_SIGNATURE_TIMESTAMP_HEADER.toLowerCase()];
  const receivedSignature = readOptionalString(normalizedHeaders[ZENDESK_SIGNATURE_HEADER.toLowerCase()]);
  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature', webhookTimestamp: timestampResult.webhookTimestamp };
  }

  const normalizedSignature = normalizeBase64Signature(receivedSignature);
  if (!normalizedSignature || !timestamp) {
    return {
      ok: false,
      reason: 'malformed-signature',
      receivedSignature,
      webhookTimestamp: timestampResult.webhookTimestamp,
    };
  }

  const expectedSignature = computeZendeskWebhookSignature(rawPayload, timestamp, normalizedSecret);
  const headerBuffer = Buffer.from(normalizedSignature, 'base64');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64');

  if (headerBuffer.length === 0 || headerBuffer.length !== expectedBuffer.length) {
    return {
      ok: false,
      reason: 'invalid-signature',
      expectedSignature,
      receivedSignature,
      webhookTimestamp: timestampResult.webhookTimestamp,
    };
  }

  const ok = timingSafeEqual(expectedBuffer, headerBuffer);
  return {
    ok,
    ...(ok
      ? { expectedSignature, receivedSignature, webhookTimestamp: timestampResult.webhookTimestamp }
      : {
          reason: 'invalid-signature' as const,
          expectedSignature,
          receivedSignature,
          webhookTimestamp: timestampResult.webhookTimestamp,
        }),
  };
}

export function assertValidZendeskWebhookSignature(
  rawPayload: unknown,
  headers: ZendeskWebhookHeaders,
  secret: string,
  now = Date.now(),
): void {
  const result = validateZendeskWebhookSignature(rawPayload, headers, secret, now);
  if (!result.ok) {
    throw new Error(
      `Invalid Zendesk webhook signature${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function assertValidZendeskWebhookTimestamp(
  headers: ZendeskWebhookHeaders,
  toleranceMs = ZENDESK_SIGNATURE_TOLERANCE_MS,
  now = Date.now(),
): void {
  const result = validateZendeskWebhookTimestamp(headers, toleranceMs, now);
  if (!result.ok) {
    throw new Error(
      `Invalid Zendesk webhook timestamp${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

function buildNormalizedPayload(
  payload: ZendeskRecord,
  headers: Record<string, string>,
  connection: ZendeskWebhookConnectionMetadata,
  normalized: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): ZendeskRecord {
  const existingConnection = getRecord(payload._connection);
  const existingWebhook = getRecord(payload._webhook);
  const normalizedPayload: ZendeskRecord = { ...payload };

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
    action: canonicalizeAction(normalized.action),
    accountId: readOptionalString(payload.account_id) ?? readOptionalString(existingWebhook?.accountId),
    deliveryId: connection.deliveryId ?? readOptionalString(existingWebhook?.deliveryId),
    eventHeader: readOptionalString(headers[ZENDESK_EVENT_HEADER.toLowerCase()]) ?? readOptionalString(existingWebhook?.eventHeader),
    eventType: normalized.eventType,
    objectId: normalized.objectId,
    objectType: normalized.objectType,
    previousData:
      getRecord(payload.previous) ??
      getRecord(payload.previousData) ??
      getRecord(existingWebhook?.previousData),
    signature: connection.signature ?? readOptionalString(existingWebhook?.signature),
    subdomain: readOptionalString(payload.subdomain) ?? readOptionalString(existingWebhook?.subdomain),
    webhookTimestamp:
      connection.webhookTimestamp ??
      readOptionalNumber(payload.webhookTimestamp) ??
      readOptionalNumber(existingWebhook?.webhookTimestamp),
  });

  return normalizedPayload;
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
  // GET/DELETE deliveries can have an empty body. Treat null/undefined as a
  // zero-length buffer so the HMAC matches what the provider signed; falling
  // back to JSON.stringify would produce the literal string "undefined" or
  // "null" and break verification of legitimate empty-body events.
  if (rawPayload === undefined || rawPayload === null) {
    return Buffer.alloc(0);
  }

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

function normalizeHeaders(headers: ZendeskWebhookHeaders): Record<string, string> {
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

function extractZendeskAction(record: ZendeskRecord, headers: Record<string, string>): string {
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const headerEvent = readOptionalString(headers[ZENDESK_EVENT_HEADER.toLowerCase()]);
  const action =
    readOptionalString(record.action) ??
    readOptionalString(metadata?.action) ??
    readOptionalString(webhook?.action) ??
    actionFromEventType(readOptionalString(record.event_type)) ??
    actionFromEventType(readOptionalString(record.eventType)) ??
    actionFromEventType(headerEvent);

  if (!action) {
    return 'updated';
  }

  return canonicalizeAction(action);
}

function actionFromEventType(eventType: string | undefined): string | undefined {
  if (!eventType) return undefined;
  const tokens = eventType.split(/[.:/]/u).filter((entry) => entry.length > 0);
  return tokens.at(-1);
}

function canonicalizeEventType(
  value: string,
  objectType: string,
  action: string,
): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return `${objectType}.${canonicalizeAction(action)}`;
  }

  if (normalized === objectType) {
    return `${objectType}.${canonicalizeAction(action)}`;
  }

  const canonicalObjectType = canonicalizeObjectType(normalized);
  const actionToken = actionFromEventType(normalized) ?? action;
  return `${canonicalObjectType}.${canonicalizeAction(actionToken)}`;
}

function canonicalizeObjectType(value: string): string {
  const normalized = value.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (mapped) {
    return mapped;
  }

  for (const token of normalized.split(/[^a-z]+/u)) {
    const tokenMatch = OBJECT_TYPE_ALIASES[token];
    if (tokenMatch) {
      return tokenMatch;
    }
  }

  return normalizeZendeskObjectType(normalized);
}

function canonicalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'create':
    case 'created':
      return 'created';
    case 'delete':
    case 'deleted':
    case 'destroy':
    case 'destroyed':
      return 'deleted';
    case 'update':
    case 'updated':
      return 'updated';
    default:
      return normalized;
  }
}

function normalizeHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    const normalizedValues = value.map((entry) => readOptionalString(entry)).filter(isDefined);
    return normalizedValues.length > 0 ? normalizedValues.join(', ') : undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return readOptionalString(value);
}

function normalizeBase64Signature(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const unprefixed = trimmed.replace(/^sha256=/i, '');
  return isBase64Digest(unprefixed) ? unprefixed : undefined;
}

function isBase64Digest(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) {
    return false;
  }
  return /^[0-9a-z+/]+={0,2}$/i.test(value);
}

function getRecord(value: unknown): ZendeskRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is ZendeskRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIterableEntries(value: unknown): value is Iterable<readonly [string, string]> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (typeof Headers !== 'undefined' && value instanceof Headers) {
    return false;
  }

  return Symbol.iterator in value;
}

function compactObject(value: ZendeskRecord): ZendeskRecord {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries);
}

function readOptionalString(value: unknown): string | undefined {
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
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  const numericValue = readOptionalNumber(value);
  if (numericValue !== undefined) {
    return normalizeTimestamp(numericValue);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return normalizeTimestamp(numeric);
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readTimestampHeader(value: unknown): number | undefined {
  return readOptionalTimestamp(value);
}

function normalizeTimestamp(value: number): number {
  return value < 10_000_000_000 ? value * 1000 : value;
}

function readZendeskId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return readOptionalString(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
