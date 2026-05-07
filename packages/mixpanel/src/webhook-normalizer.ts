import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './mixpanel-adapter.js';
import { normalizeMixpanelObjectType } from './path-mapper.js';
import type { MixpanelAdapterConfig } from './types.js';

export const MIXPANEL_PROVIDER = 'mixpanel';
export const MIXPANEL_AUTHORIZATION_HEADER = 'authorization';
export const MIXPANEL_EVENT_HEADER = 'x-mixpanel-event';
export const MIXPANEL_DELIVERY_HEADER = 'x-mixpanel-delivery';
export const MIXPANEL_TIMESTAMP_HEADER = 'x-mixpanel-timestamp';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-mixpanel-connection-id',
  'mixpanel-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-mixpanel-provider',
  'mixpanel-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-mixpanel-provider-config-key',
  'mixpanel-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = [
  'x-request-id',
  'x-correlation-id',
  'x-relay-request-id',
] as const;

const DEFAULT_TIMESTAMP_TOLERANCE_MS = 300_000;

type HeaderValue = boolean | number | readonly string[] | string | null | undefined;
type MixpanelRecord = Record<string, unknown>;

export type MixpanelWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface MixpanelWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  webhookTimestamp?: number;
}

export interface MixpanelBasicAuthValidationResult {
  expectedAuthorization?: string;
  ok: boolean;
  reason?:
    | 'invalid-authorization'
    | 'malformed-authorization'
    | 'missing-authorization'
    | 'missing-credentials';
  receivedAuthorization?: string;
}

export interface MixpanelWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

export interface NormalizeMixpanelWebhookOptions {
  now?: number;
  validateTimestamp?: boolean;
}

export function normalizeMixpanelWebhook(
  rawPayload: unknown,
  headers: MixpanelWebhookHeaders = {},
  config: MixpanelAdapterConfig = {},
  options: NormalizeMixpanelWebhookOptions = {},
): NormalizedWebhook {
  assertValidMixpanelWebhookAuthorization(headers, config);
  if (options.validateTimestamp ?? true) {
    assertValidMixpanelWebhookTimestamp(rawPayload, headers, config, options.now);
  }

  const payload = parseMixpanelWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const objectType = extractMixpanelObjectType(payload, normalizedHeaders);
  const objectId = extractMixpanelObjectId(payload, objectType);
  const action = extractMixpanelAction(payload).toLowerCase();
  const eventType = extractMixpanelEventType(payload, normalizedHeaders, objectType, action);
  const connection = extractMixpanelConnectionMetadata(payload, normalizedHeaders);

  const normalized: NormalizedWebhook = {
    eventType,
    objectId,
    objectType,
    payload: buildNormalizedPayload(payload, rawPayload, normalizedHeaders, connection, {
      action,
      eventType,
      objectId,
      objectType,
    }),
    provider: connection.provider,
  };

  if (connection.connectionId) {
    normalized.connectionId = connection.connectionId;
  }

  return normalized;
}

export function parseMixpanelWebhookPayload(rawPayload: unknown): MixpanelRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Mixpanel webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractMixpanelConnectionMetadata(
  payload: unknown,
  headers: MixpanelWebhookHeaders = {},
): MixpanelWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseMixpanelWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: MixpanelWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      MIXPANEL_PROVIDER,
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
    readOptionalString(normalizedHeaders[MIXPANEL_DELIVERY_HEADER]) ??
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

  const webhookTimestamp =
    readWebhookTimestamp(record, normalizedHeaders) ??
    readOptionalTimestamp(metadata?.webhookTimestamp) ??
    readOptionalTimestamp(metadata?.webhook_timestamp) ??
    readOptionalTimestamp(webhook?.webhookTimestamp) ??
    readOptionalTimestamp(webhook?.webhook_timestamp);
  if (webhookTimestamp !== undefined) {
    result.webhookTimestamp = webhookTimestamp;
  }

  return result;
}

export function extractMixpanelEventType(
  payload: unknown,
  headers: MixpanelWebhookHeaders = {},
  objectType?: string,
  action?: string,
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseMixpanelWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const resolvedObjectType = objectType ?? extractMixpanelObjectType(record, normalizedHeaders);
  const resolvedAction = action ?? extractMixpanelAction(record).toLowerCase();

  const explicit =
    readOptionalString(record.eventType) ??
    readOptionalString(record.event_type) ??
    readOptionalString(record.event) ??
    readOptionalString(metadata?.eventType) ??
    readOptionalString(metadata?.event_type) ??
    readOptionalString(webhook?.eventType) ??
    readOptionalString(webhook?.event_type);
  if (explicit?.includes('.')) {
    return explicit.trim().toLowerCase();
  }

  return `${resolvedObjectType}.${resolvedAction}`;
}

export function extractMixpanelObjectType(
  payload: unknown,
  headers: MixpanelWebhookHeaders = {},
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseMixpanelWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const rawType =
    readOptionalString(record.type) ??
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(normalizedHeaders[MIXPANEL_EVENT_HEADER]) ??
    readOptionalString(metadata?.type) ??
    readOptionalString(metadata?.objectType) ??
    readOptionalString(metadata?.object_type) ??
    readOptionalString(webhook?.objectType) ??
    readOptionalString(webhook?.object_type);

  if (!rawType) {
    throw new Error('Mixpanel webhook payload is missing type metadata.');
  }

  return normalizeMixpanelObjectType(rawType);
}

export function extractMixpanelObjectId(payload: unknown, objectType?: string): string {
  const record = parseMixpanelWebhookPayload(payload);
  const data = getRecord(record.data);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const resolvedObjectType = objectType ?? extractMixpanelObjectType(record);
  const objectId =
    readOptionalString(record.objectId) ??
    readOptionalString(record.object_id) ??
    readOptionalString(metadata?.objectId) ??
    readOptionalString(metadata?.object_id) ??
    readOptionalString(webhook?.objectId) ??
    readOptionalString(webhook?.object_id) ??
    readOptionalString(data?.id) ??
    objectSpecificId(data, resolvedObjectType);

  if (!objectId) {
    throw new Error('Mixpanel webhook payload is missing an object identifier.');
  }

  return objectId;
}

export function expectedMixpanelAuthorization(config: MixpanelAdapterConfig): string {
  const user = readOptionalString(config.webhookUser);
  const pass = readOptionalString(config.webhookPass);
  if (!user || !pass) {
    throw new Error('Mixpanel webhook Basic auth credentials must be configured.');
  }
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

export function validateMixpanelWebhookAuthorization(
  headers: MixpanelWebhookHeaders,
  config: MixpanelAdapterConfig,
): MixpanelBasicAuthValidationResult {
  let expectedAuthorization: string;
  try {
    expectedAuthorization = expectedMixpanelAuthorization(config);
  } catch {
    return { ok: false, reason: 'missing-credentials' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedAuthorization = readOptionalString(normalizedHeaders[MIXPANEL_AUTHORIZATION_HEADER]);
  if (!receivedAuthorization) {
    return { ok: false, reason: 'missing-authorization' };
  }
  if (!receivedAuthorization.startsWith('Basic ')) {
    return {
      ok: false,
      reason: 'malformed-authorization',
      receivedAuthorization,
    };
  }

  const expectedBuffer = Buffer.from(expectedAuthorization, 'utf8');
  const receivedBuffer = Buffer.from(receivedAuthorization, 'utf8');
  const ok =
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer);

  return {
    ok,
    ...(ok
      ? { expectedAuthorization, receivedAuthorization }
      : {
          expectedAuthorization,
          reason: 'invalid-authorization' as const,
          receivedAuthorization,
        }),
  };
}

export function assertValidMixpanelWebhookAuthorization(
  headers: MixpanelWebhookHeaders,
  config: MixpanelAdapterConfig,
): void {
  const result = validateMixpanelWebhookAuthorization(headers, config);
  if (!result.ok) {
    throw new Error(
      `Invalid Mixpanel webhook authorization${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function validateMixpanelWebhookTimestamp(
  payload: unknown,
  headers: MixpanelWebhookHeaders = {},
  config: MixpanelAdapterConfig = {},
  now = Date.now(),
): MixpanelWebhookTimestampValidationResult {
  const record = parseMixpanelWebhookPayload(payload);
  const normalizedHeaders = normalizeHeaders(headers);
  const webhookTimestamp = readWebhookTimestamp(record, normalizedHeaders);
  if (webhookTimestamp === undefined) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const toleranceMs = config.webhookTimestampToleranceMs ?? DEFAULT_TIMESTAMP_TOLERANCE_MS;
  const driftMs = Math.abs(now - webhookTimestamp);
  if (driftMs > toleranceMs) {
    return {
      driftMs,
      ok: false,
      reason: 'stale-timestamp',
      webhookTimestamp,
    };
  }

  return { driftMs, ok: true, webhookTimestamp };
}

export function assertValidMixpanelWebhookTimestamp(
  payload: unknown,
  headers: MixpanelWebhookHeaders = {},
  config: MixpanelAdapterConfig = {},
  now = Date.now(),
): void {
  const result = validateMixpanelWebhookTimestamp(payload, headers, config, now);
  if (!result.ok) {
    throw new Error(
      `Invalid Mixpanel webhook timestamp${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function computeMixpanelPayloadFingerprint(rawPayload: unknown, secret: string): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error('Mixpanel payload fingerprint secret must be a non-empty string.');
  }
  return createHmac('sha256', normalizedSecret)
    .update(toRawBodyBuffer(rawPayload))
    .digest('hex');
}

function buildNormalizedPayload(
  payload: MixpanelRecord,
  rawPayload: unknown,
  headers: Record<string, string>,
  connection: MixpanelWebhookConnectionMetadata,
  normalized: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): MixpanelRecord {
  const data = getRecord(payload.data);
  const source = data ? { ...data } : { ...payload };
  delete source.data;

  const existingConnection = getRecord(payload._connection);
  const existingWebhook = getRecord(payload._webhook);
  const normalizedPayload: MixpanelRecord = { ...source };
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
    bodyFingerprint: computeMixpanelPayloadFingerprint(rawPayload, 'relayfile-mixpanel-fingerprint'),
    deliveryId: connection.deliveryId,
    eventHeader: readOptionalString(headers[MIXPANEL_EVENT_HEADER]),
    eventType: normalized.eventType,
    objectId: normalized.objectId,
    objectType: normalized.objectType,
    projectId:
      readOptionalString(payload.projectId) ??
      readOptionalString(payload.project_id) ??
      readOptionalString(data?.project_id),
    requestId: connection.requestId,
    timestamp: connection.webhookTimestamp,
  });
  return normalizedPayload;
}

function extractMixpanelAction(record: MixpanelRecord): string {
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const action =
    readOptionalString(record.action) ??
    readOptionalString(metadata?.action) ??
    readOptionalString(webhook?.action);
  if (!action) {
    throw new Error('Mixpanel webhook payload is missing action.');
  }
  return action;
}

function objectSpecificId(data: MixpanelRecord | undefined, objectType: string): string | undefined {
  if (!data) {
    return undefined;
  }
  if (objectType === 'event') {
    return (
      readOptionalString(data.insertId) ??
      readOptionalString(data.insert_id) ??
      readOptionalString(getRecord(data.properties)?.$insert_id) ??
      deriveEventId(data)
    );
  }
  if (objectType === 'profile') {
    return (
      readOptionalString(data.$distinct_id) ??
      readOptionalString(data.distinct_id) ??
      readOptionalString(data.id)
    );
  }
  return readOptionalString(data.id);
}

function deriveEventId(data: MixpanelRecord): string | undefined {
  const event = readOptionalString(data.event) ?? readOptionalString(data.name);
  const properties = getRecord(data.properties);
  const distinctId =
    readOptionalString(properties?.distinct_id) ??
    readOptionalString(data.distinct_id);
  const time =
    readOptionalString(properties?.time) ??
    readOptionalString(data.timestamp);
  if (event && distinctId && time) {
    return `${event}:${distinctId}:${time}`;
  }
  if (event && distinctId) {
    return `${event}:${distinctId}`;
  }
  return undefined;
}

function readWebhookTimestamp(
  record: MixpanelRecord,
  headers: Record<string, string>,
): number | undefined {
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  return (
    readOptionalTimestamp(headers[MIXPANEL_TIMESTAMP_HEADER]) ??
    readOptionalTimestamp(record.timestamp) ??
    readOptionalTimestamp(record.webhookTimestamp) ??
    readOptionalTimestamp(record.webhook_timestamp) ??
    readOptionalTimestamp(metadata?.timestamp) ??
    readOptionalTimestamp(metadata?.webhookTimestamp) ??
    readOptionalTimestamp(metadata?.webhook_timestamp) ??
    readOptionalTimestamp(webhook?.timestamp) ??
    readOptionalTimestamp(webhook?.webhookTimestamp) ??
    readOptionalTimestamp(webhook?.webhook_timestamp)
  );
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

function normalizeHeaders(headers: MixpanelWebhookHeaders): Record<string, string> {
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
    return value.map((item) => readOptionalString(item)).filter(Boolean).join(', ');
  }
  return readOptionalString(value);
}

function isIterableEntries(value: unknown): value is Iterable<readonly [unknown, unknown]> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Symbol.iterator in value && typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

function compactObject(record: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== null && value !== '') {
      compacted[key] = value;
    }
  }
  return compacted;
}

function readOptionalString(value: unknown): string | undefined {
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

function readOptionalTimestamp(value: unknown): number | undefined {
  const text = readOptionalString(value);
  if (!text) {
    return undefined;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

function getRecord(value: unknown): MixpanelRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is MixpanelRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
