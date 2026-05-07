import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './pipedrive-adapter.js';
import type { PipedriveAdapterConfig, PipedriveWebhookBasicAuthConfig } from './types.js';

export const PIPEDRIVE_PROVIDER = 'pipedrive';
export const PIPEDRIVE_AUTHORIZATION_HEADER = 'authorization';
export const PIPEDRIVE_EVENT_ACTION_HEADER = 'x-pipedrive-event-action';
export const PIPEDRIVE_EVENT_OBJECT_HEADER = 'x-pipedrive-event-object';
export const PIPEDRIVE_TIMESTAMP_HEADER = 'x-pipedrive-timestamp';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-pipedrive-connection-id',
  'pipedrive-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-pipedrive-provider',
  'pipedrive-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-pipedrive-provider-config-key',
  'pipedrive-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = [
  'x-request-id',
  'x-correlation-id',
  'x-relay-request-id',
  'x-pipedrive-correlation-id',
] as const;

const DELIVERY_ID_HEADER_KEYS = [
  'x-pipedrive-delivery',
  'x-pipedrive-delivery-id',
  'x-relay-delivery-id',
] as const;

const OBJECT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  activity: 'activity',
  activities: 'activity',
  deal: 'deal',
  deals: 'deal',
  organization: 'organization',
  organizations: 'organization',
  organisation: 'organization',
  organisations: 'organization',
  org: 'organization',
  orgs: 'organization',
  person: 'person',
  persons: 'person',
  people: 'person',
};

type PipedriveRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type PipedriveWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface PipedriveWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  webhookTimestamp?: number;
}

export interface PipedriveWebhookAuthValidationResult {
  expectedAuthorization?: string;
  ok: boolean;
  reason?: 'invalid-authorization' | 'missing-authorization' | 'missing-credentials';
  receivedAuthorization?: string;
}

export interface PipedriveWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

export function normalizePipedriveWebhook(
  rawPayload: unknown,
  headers: PipedriveWebhookHeaders = {},
  config: PipedriveAdapterConfig = {},
): NormalizedWebhook {
  if (config.webhookBasicAuth) {
    assertValidPipedriveWebhookBasicAuth(headers, config.webhookBasicAuth);
  }
  if (config.webhookTimestampToleranceMs !== undefined) {
    assertValidPipedriveWebhookTimestamp(rawPayload, headers, config.webhookTimestampToleranceMs);
  }

  const payload = parsePipedriveWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const action = extractPipedriveAction(payload, normalizedHeaders).toLowerCase();
  const objectType = extractPipedriveObjectType(payload, normalizedHeaders);
  const objectId = extractPipedriveObjectId(payload, objectType);
  const eventType = extractPipedriveEventType(payload, normalizedHeaders, objectType, action);
  const connection = extractPipedriveConnectionMetadata(payload, normalizedHeaders);
  const normalizedPayload = buildNormalizedPayload(payload, normalizedHeaders, connection, {
    action,
    eventType,
    objectId,
    objectType,
  });

  const normalized: NormalizedWebhook = {
    provider: connection.provider,
    eventType,
    objectType,
    objectId,
    payload: normalizedPayload,
  };

  if (connection.connectionId) {
    normalized.connectionId = connection.connectionId;
  }

  return normalized;
}

export function parsePipedriveWebhookPayload(rawPayload: unknown): PipedriveRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Pipedrive webhook payload must be a JSON object.');
  }
  return decoded;
}

export function computePipedriveBasicAuthorization(
  credentials: PipedriveWebhookBasicAuthConfig,
): string {
  const username = readOptionalString(credentials.username);
  const password = readOptionalString(credentials.password);
  if (!username || !password) {
    throw new Error('Pipedrive webhook Basic Auth credentials must include username and password.');
  }

  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

export function validatePipedriveWebhookBasicAuth(
  headers: PipedriveWebhookHeaders,
  credentials: PipedriveWebhookBasicAuthConfig | undefined,
): PipedriveWebhookAuthValidationResult {
  if (!credentials) {
    return { ok: false, reason: 'missing-credentials' };
  }

  let expectedAuthorization: string;
  try {
    expectedAuthorization = computePipedriveBasicAuthorization(credentials);
  } catch {
    return { ok: false, reason: 'missing-credentials' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedAuthorization = readOptionalString(normalizedHeaders[PIPEDRIVE_AUTHORIZATION_HEADER]);
  if (!receivedAuthorization) {
    return { ok: false, reason: 'missing-authorization', expectedAuthorization };
  }

  const expectedBuffer = Buffer.from(expectedAuthorization, 'utf8');
  const receivedBuffer = Buffer.from(receivedAuthorization, 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length || receivedBuffer.length === 0) {
    return {
      ok: false,
      reason: 'invalid-authorization',
      expectedAuthorization,
      receivedAuthorization,
    };
  }

  const ok = timingSafeEqual(expectedBuffer, receivedBuffer);
  return {
    ok,
    ...(ok
      ? { expectedAuthorization, receivedAuthorization }
      : {
          reason: 'invalid-authorization' as const,
          expectedAuthorization,
          receivedAuthorization,
        }),
  };
}

export function assertValidPipedriveWebhookBasicAuth(
  headers: PipedriveWebhookHeaders,
  credentials: PipedriveWebhookBasicAuthConfig | undefined,
): void {
  const result = validatePipedriveWebhookBasicAuth(headers, credentials);
  if (!result.ok) {
    throw new Error(
      `Invalid Pipedrive webhook Basic Auth${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function validatePipedriveWebhookTimestamp(
  payload: unknown,
  headers: PipedriveWebhookHeaders = {},
  toleranceMs = 60_000,
  now = Date.now(),
): PipedriveWebhookTimestampValidationResult {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parsePipedriveWebhookPayload(payload);
  const meta = getRecord(record.meta);
  const webhook = getRecord(record._webhook);
  const webhookTimestamp =
    readOptionalTimestamp(normalizedHeaders[PIPEDRIVE_TIMESTAMP_HEADER]) ??
    readOptionalTimestamp(record.timestamp) ??
    readOptionalTimestamp(meta?.timestamp) ??
    readOptionalTimestamp(webhook?.webhookTimestamp) ??
    readOptionalTimestamp(webhook?.timestamp);

  if (webhookTimestamp === undefined) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const driftMs = Math.abs(now - webhookTimestamp);
  if (driftMs > toleranceMs) {
    return { ok: false, reason: 'stale-timestamp', webhookTimestamp, driftMs };
  }

  return { ok: true, webhookTimestamp, driftMs };
}

export function assertValidPipedriveWebhookTimestamp(
  payload: unknown,
  headers: PipedriveWebhookHeaders = {},
  toleranceMs = 60_000,
  now = Date.now(),
): void {
  const result = validatePipedriveWebhookTimestamp(payload, headers, toleranceMs, now);
  if (!result.ok) {
    throw new Error(
      `Invalid Pipedrive webhook timestamp${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function extractPipedriveConnectionMetadata(
  payload: unknown,
  headers: PipedriveWebhookHeaders = {},
): PipedriveWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parsePipedriveWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const meta = getRecord(record.meta);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: PipedriveWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      PIPEDRIVE_PROVIDER,
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
    readHeaderValue(normalizedHeaders, DELIVERY_ID_HEADER_KEYS) ??
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
    readOptionalString(meta?.correlation_id) ??
    readOptionalString(normalizedConnection?.requestId) ??
    readOptionalString(normalizedConnection?.request_id);
  if (requestId) {
    result.requestId = requestId;
  }

  const webhookTimestamp =
    readOptionalTimestamp(normalizedHeaders[PIPEDRIVE_TIMESTAMP_HEADER]) ??
    readOptionalTimestamp(record.timestamp) ??
    readOptionalTimestamp(meta?.timestamp) ??
    readOptionalTimestamp(webhook?.webhookTimestamp) ??
    readOptionalTimestamp(webhook?.timestamp);
  if (webhookTimestamp !== undefined) {
    result.webhookTimestamp = webhookTimestamp;
  }

  return result;
}

export function extractPipedriveEventType(
  payload: unknown,
  headers: PipedriveWebhookHeaders = {},
  objectType?: string,
  action?: string,
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parsePipedriveWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const meta = getRecord(record.meta);
  const webhook = getRecord(record._webhook);
  const resolvedObjectType = objectType ?? extractPipedriveObjectType(record, normalizedHeaders);
  const resolvedAction = action ?? extractPipedriveAction(record, normalizedHeaders).toLowerCase();

  const explicitEventType =
    readOptionalString(record.eventType) ??
    readOptionalString(record.event_type) ??
    readOptionalString(record.event) ??
    readOptionalString(metadata?.eventType) ??
    readOptionalString(metadata?.event_type) ??
    readOptionalString(meta?.event) ??
    readOptionalString(webhook?.eventType) ??
    readOptionalString(webhook?.event_type);

  if (explicitEventType) {
    return canonicalizeEventType(explicitEventType, resolvedObjectType, resolvedAction);
  }

  return `${resolvedObjectType}.${resolvedAction}`;
}

export function extractPipedriveObjectType(
  payload: unknown,
  headers: PipedriveWebhookHeaders = {},
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parsePipedriveWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const meta = getRecord(record.meta);
  const webhook = getRecord(record._webhook);
  const rawType =
    readOptionalString(record.object) ??
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(normalizedHeaders[PIPEDRIVE_EVENT_OBJECT_HEADER]) ??
    readOptionalString(meta?.object) ??
    readOptionalString(meta?.entity) ??
    readOptionalString(meta?.type) ??
    readOptionalString(metadata?.objectType) ??
    readOptionalString(metadata?.object_type) ??
    readOptionalString(webhook?.objectType) ??
    readOptionalString(webhook?.object_type);

  if (!rawType) {
    const event = readOptionalString(record.event) ?? readOptionalString(meta?.event);
    if (event) {
      const eventType = objectTypeFromEvent(event);
      if (eventType) {
        return eventType;
      }
    }
    throw new Error('Pipedrive webhook payload is missing object metadata.');
  }

  return canonicalizeObjectType(rawType);
}

export function extractPipedriveAction(
  payload: unknown,
  headers: PipedriveWebhookHeaders = {},
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parsePipedriveWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const meta = getRecord(record.meta);
  const webhook = getRecord(record._webhook);
  const action =
    readOptionalString(record.action) ??
    readOptionalString(normalizedHeaders[PIPEDRIVE_EVENT_ACTION_HEADER]) ??
    readOptionalString(meta?.action) ??
    readOptionalString(metadata?.action) ??
    readOptionalString(webhook?.action);

  if (action) {
    return canonicalizeAction(action);
  }

  const event = readOptionalString(record.event) ?? readOptionalString(meta?.event);
  if (event) {
    const eventAction = actionFromEvent(event);
    if (eventAction) {
      return eventAction;
    }
  }

  throw new Error('Pipedrive webhook payload is missing action.');
}

export function extractPipedriveObjectId(payload: unknown, objectType?: string): string {
  const record = parsePipedriveWebhookPayload(payload);
  const current = getRecord(record.current);
  const data = getRecord(record.data);
  const meta = getRecord(record.meta);
  const webhook = getRecord(record._webhook);
  const normalizedObjectType = objectType ? canonicalizeObjectType(objectType) : undefined;
  const objectId =
    readOptionalString(current?.id) ??
    readOptionalString(data?.id) ??
    readOptionalString(record.objectId) ??
    readOptionalString(record.object_id) ??
    readOptionalString(meta?.id) ??
    readOptionalString(webhook?.objectId) ??
    readOptionalString(webhook?.object_id) ??
    readObjectIdFromFlatPayload(record, normalizedObjectType) ??
    readOptionalString(record.id);

  if (!objectId) {
    throw new Error('Pipedrive webhook payload is missing an object identifier.');
  }

  return objectId;
}

export function computePipedriveBodyDigest(rawPayload: unknown, salt = 'pipedrive-body-digest'): string {
  return createHmac('sha256', salt).update(toRawBodyBuffer(rawPayload)).digest('hex');
}

function buildNormalizedPayload(
  payload: PipedriveRecord,
  headers: Record<string, string>,
  connection: PipedriveWebhookConnectionMetadata,
  normalized: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): PipedriveRecord {
  const existingConnection = getRecord(payload._connection);
  const existingWebhook = getRecord(payload._webhook);
  const normalizedPayload: PipedriveRecord = { ...payload };

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
    eventHeader: readOptionalString(headers[PIPEDRIVE_EVENT_OBJECT_HEADER]) ?? readOptionalString(existingWebhook?.eventHeader),
    eventType: normalized.eventType,
    objectId: normalized.objectId,
    objectType: normalized.objectType,
    previousData: getRecord(payload.previous) ?? getRecord(existingWebhook?.previousData),
    requestTimestamp: readOptionalTimestamp(headers[PIPEDRIVE_TIMESTAMP_HEADER]),
    webhookTimestamp: connection.webhookTimestamp ?? readOptionalNumber(existingWebhook?.webhookTimestamp),
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

function normalizeHeaders(headers: PipedriveWebhookHeaders): Record<string, string> {
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

function readHeaderValue(headers: Record<string, string>, keys: readonly string[]): string | undefined {
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
    return value.map((entry) => readOptionalString(entry)).filter(Boolean).join(', ');
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return readOptionalString(value);
}

function canonicalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'add':
    case 'added':
    case 'create':
    case 'created':
      return 'created';
    case 'delete':
    case 'deleted':
    case 'remove':
    case 'removed':
      return 'deleted';
    case 'change':
    case 'update':
    case 'updated':
      return 'updated';
    default:
      return normalized;
  }
}

function canonicalizeEventType(value: string, objectType: string, action: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === objectType) {
    return `${objectType}.${action}`;
  }

  const parts = normalized.split(/[.:_\s-]+/u).filter(Boolean);
  const maybeAction = parts.map(actionFromEventToken).find((entry): entry is string => entry !== undefined);
  const maybeObject = parts.map(objectTypeFromEventToken).find((entry): entry is string => entry !== undefined);
  if (maybeAction && maybeObject) {
    return `${maybeObject}.${maybeAction}`;
  }

  return normalized.includes('.') ? normalized : `${objectType}.${action}`;
}

function canonicalizeObjectType(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (mapped) {
    return mapped;
  }

  for (const token of value.trim().toLowerCase().split(/[^a-z]+/u)) {
    const tokenMatch = OBJECT_TYPE_ALIASES[token];
    if (tokenMatch) {
      return tokenMatch;
    }
  }

  return normalized;
}

function actionFromEvent(event: string): string | undefined {
  return event
    .split(/[.:_\s-]+/u)
    .map(actionFromEventToken)
    .find((entry): entry is string => entry !== undefined);
}

function actionFromEventToken(token: string): string | undefined {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return undefined;
  const canonical = canonicalizeAction(normalized);
  if (canonical === 'created' || canonical === 'updated' || canonical === 'deleted') {
    return canonical;
  }
  return undefined;
}

function objectTypeFromEvent(event: string): string | undefined {
  return event
    .split(/[.:_\s-]+/u)
    .map(objectTypeFromEventToken)
    .find((entry): entry is string => entry !== undefined);
}

function objectTypeFromEventToken(token: string): string | undefined {
  const normalized = token.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return OBJECT_TYPE_ALIASES[normalized];
}

function readObjectIdFromFlatPayload(
  record: Record<string, unknown>,
  objectType: string | undefined,
): string | undefined {
  switch (objectType) {
    case 'activity':
      return readOptionalString(record.activity_id);
    case 'deal':
      return readOptionalString(record.deal_id);
    case 'organization':
      return readOptionalString(record.org_id) ?? readOptionalString(record.organization_id);
    case 'person':
      return readOptionalString(record.person_id);
    case undefined:
      return undefined;
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as T;
}

function isIterableEntries(value: unknown): value is Iterable<readonly [unknown, unknown]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.iterator in value &&
    !(typeof Headers !== 'undefined' && value instanceof Headers) &&
    !Array.isArray(value)
  );
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  const numeric = readOptionalNumber(value);
  if (numeric === undefined) {
    return undefined;
  }
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}
