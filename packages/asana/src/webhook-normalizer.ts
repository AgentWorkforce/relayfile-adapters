import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './asana-adapter.js';
import { normalizeAsanaObjectType, type AsanaPathObjectType } from './path-mapper.js';

export const ASANA_PROVIDER = 'asana';
export const ASANA_HOOK_SECRET_HEADER = 'x-hook-secret';
export const ASANA_HOOK_SIGNATURE_HEADER = 'x-hook-signature';
export const ASANA_HOOK_TIMESTAMP_HEADER = 'x-hook-timestamp';
export const ASANA_HOOK_DELIVERY_HEADER = 'x-hook-delivery';
export const ASANA_HOOK_EVENT_HEADER = 'x-hook-event';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-asana-connection-id',
  'asana-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-asana-provider',
  'asana-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-asana-provider-config-key',
  'asana-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;
const DEFAULT_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

type AsanaRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type AsanaWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface AsanaWebhookHandshake {
  kind: 'handshake';
  responseHeaders: {
    'X-Hook-Secret': string;
  };
  secret: string;
}

export interface AsanaWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  webhookTimestamp?: number;
}

export interface AsanaWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?: 'invalid-signature' | 'malformed-signature' | 'missing-secret' | 'missing-signature';
  receivedSignature?: string;
}

export interface AsanaWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

export interface NormalizeAsanaWebhookOptions {
  nowMs?: number;
  requireTimestamp?: boolean;
  toleranceMs?: number;
  webhookSecret?: string;
}

export function normalizeAsanaWebhook(
  rawPayload: unknown,
  headers: AsanaWebhookHeaders = {},
  options: NormalizeAsanaWebhookOptions = {},
): NormalizedWebhook {
  const normalizedHeaders = normalizeHeaders(headers);
  if (isAsanaWebhookHandshake(normalizedHeaders)) {
    throw new Error('Asana webhook handshake requests do not contain resource events; echo X-Hook-Secret instead.');
  }

  if (options.webhookSecret !== undefined) {
    assertValidAsanaWebhookSignature(rawPayload, normalizedHeaders, options.webhookSecret);
  }

  const timestampResult = validateAsanaWebhookTimestamp(
    normalizedHeaders,
    options.toleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS,
    options.nowMs,
    options.requireTimestamp ?? false,
  );
  if (!timestampResult.ok) {
    throw new Error(`Invalid Asana webhook timestamp: ${timestampResult.reason}`);
  }

  const payload = parseAsanaWebhookPayload(rawPayload);
  const event = selectPrimaryAsanaWebhookEvent(payload);
  const objectType = extractAsanaObjectType(event, payload);
  const objectId = extractAsanaObjectId(event, payload);
  const action = extractAsanaAction(event, payload);
  const eventType = `${objectType}.${action}`;
  const connection = extractAsanaConnectionMetadata(payload, normalizedHeaders);

  const normalized: NormalizedWebhook = {
    provider: connection.provider,
    eventType,
    objectType,
    objectId,
    payload: buildNormalizedPayload(payload, normalizedHeaders, connection, event, {
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

export function handleAsanaWebhookHandshake(headers: AsanaWebhookHeaders = {}): AsanaWebhookHandshake {
  const normalizedHeaders = normalizeHeaders(headers);
  const secret = readOptionalString(normalizedHeaders[ASANA_HOOK_SECRET_HEADER]);
  if (!secret) {
    throw new Error('Asana webhook handshake is missing X-Hook-Secret');
  }
  return {
    kind: 'handshake',
    responseHeaders: {
      'X-Hook-Secret': secret,
    },
    secret,
  };
}

export function isAsanaWebhookHandshake(headers: AsanaWebhookHeaders = {}): boolean {
  const normalizedHeaders = normalizeHeaders(headers);
  return Boolean(readOptionalString(normalizedHeaders[ASANA_HOOK_SECRET_HEADER]));
}

export function validateAsanaWebhookSignature(
  rawPayload: unknown,
  headers: AsanaWebhookHeaders = {},
  webhookSecret?: string,
): AsanaWebhookSignatureValidationResult {
  const secret = webhookSecret?.trim();
  if (!secret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedSignature = readOptionalString(normalizedHeaders[ASANA_HOOK_SIGNATURE_HEADER]);
  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature' };
  }

  const normalizedSignature = receivedSignature.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalizedSignature)) {
    return {
      ok: false,
      reason: 'malformed-signature',
      receivedSignature,
    };
  }

  const body = rawPayloadToString(rawPayload);
  const expectedSignature = createHmac('sha256', secret).update(body).digest('hex');
  const receivedBuffer = Buffer.from(normalizedSignature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const ok = receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);

  if (!ok) {
    return {
      expectedSignature,
      ok: false,
      reason: 'invalid-signature',
      receivedSignature,
    };
  }

  return {
    expectedSignature,
    ok: true,
    receivedSignature,
  };
}

export function assertValidAsanaWebhookSignature(
  rawPayload: unknown,
  headers: AsanaWebhookHeaders = {},
  webhookSecret?: string,
): void {
  const result = validateAsanaWebhookSignature(rawPayload, headers, webhookSecret);
  if (!result.ok) {
    throw new Error(`Invalid Asana webhook signature: ${result.reason}`);
  }
}

export function validateAsanaWebhookTimestamp(
  headers: AsanaWebhookHeaders = {},
  toleranceMs = DEFAULT_WEBHOOK_TOLERANCE_MS,
  nowMs = Date.now(),
  requireTimestamp = false,
): AsanaWebhookTimestampValidationResult {
  const normalizedHeaders = normalizeHeaders(headers);
  const webhookTimestamp = readOptionalTimestamp(normalizedHeaders[ASANA_HOOK_TIMESTAMP_HEADER]);

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

export function parseAsanaWebhookPayload(rawPayload: unknown): AsanaRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Asana webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractAsanaConnectionMetadata(
  payload: unknown,
  headers: AsanaWebhookHeaders = {},
): AsanaWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseAsanaWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);

  const result: AsanaWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      ASANA_PROVIDER,
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
    readOptionalString(normalizedHeaders[ASANA_HOOK_DELIVERY_HEADER]) ??
    readOptionalString(record.deliveryId) ??
    readOptionalString(record.delivery_id) ??
    readOptionalString(metadata?.deliveryId) ??
    readOptionalString(metadata?.delivery_id);
  if (deliveryId) {
    result.deliveryId = deliveryId;
  }

  const signature =
    readOptionalString(normalizedHeaders[ASANA_HOOK_SIGNATURE_HEADER]) ??
    readOptionalString(record.signature) ??
    readOptionalString(metadata?.signature);
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
    readOptionalTimestamp(normalizedHeaders[ASANA_HOOK_TIMESTAMP_HEADER]) ??
    readOptionalTimestamp(record.webhookTimestamp) ??
    readOptionalTimestamp(record.webhook_timestamp) ??
    readOptionalTimestamp(metadata?.webhookTimestamp) ??
    readOptionalTimestamp(metadata?.webhook_timestamp);
  if (webhookTimestamp !== undefined) {
    result.webhookTimestamp = webhookTimestamp;
  }

  return result;
}

function selectPrimaryAsanaWebhookEvent(payload: AsanaRecord): AsanaRecord {
  const events = payload.events;
  if (!Array.isArray(events) || events.length === 0) {
    const data = getRecord(payload.data);
    if (data) {
      return data;
    }
    throw new Error('Asana webhook payload must include at least one event.');
  }

  const event = events.find(isRecord);
  if (!event) {
    throw new Error('Asana webhook events must contain JSON objects.');
  }
  return event;
}

function extractAsanaObjectType(event: AsanaRecord, payload: AsanaRecord): AsanaPathObjectType {
  const resource = getRecord(event.resource);
  const parent = getRecord(event.parent);
  const candidate =
    readOptionalString(resource?.resource_type) ??
    readOptionalString(event.resource_type) ??
    readOptionalString(event.type) ??
    readOptionalString(parent?.resource_type) ??
    readOptionalString(payload.resource_type) ??
    readOptionalString(payload.type);

  if (!candidate) {
    throw new Error('Asana webhook event is missing resource_type.');
  }

  return normalizeAsanaObjectType(candidate);
}

function extractAsanaObjectId(event: AsanaRecord, payload: AsanaRecord): string {
  const resource = getRecord(event.resource);
  const parent = getRecord(event.parent);
  const objectId =
    readOptionalString(resource?.gid) ??
    readOptionalString(event.gid) ??
    readOptionalString(payload.gid) ??
    readOptionalString(parent?.gid);

  if (!objectId) {
    throw new Error('Asana webhook event is missing resource.gid.');
  }

  return objectId;
}

function extractAsanaAction(event: AsanaRecord, payload: AsanaRecord): string {
  const change = getRecord(event.change);
  const action =
    inferAsanaLifecycleAction(event, payload) ??
    readOptionalString(event.action) ??
    readOptionalString(change?.action) ??
    readOptionalString(payload.action) ??
    'changed';

  return normalizeAction(action);
}

function inferAsanaLifecycleAction(event: AsanaRecord, payload: AsanaRecord): string | undefined {
  const change = getRecord(event.change);
  const field = readOptionalString(change?.field)?.toLowerCase();
  const newValue = change?.new_value ?? change?.newValue;
  const resource = getRecord(event.resource);
  const data = getRecord(payload.data);
  if (
    field === 'completed'
    && (newValue === true || readOptionalString(newValue)?.toLowerCase() === 'true')
  ) {
    return 'completed';
  }
  if (resource?.completed === true || data?.completed === true || payload.completed === true) {
    return 'completed';
  }
  return undefined;
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'add':
    case 'added':
    case 'created':
    case 'create':
      return 'added';
    case 'delete':
    case 'deleted':
      return 'deleted';
    case 'remove':
    case 'removed':
      return 'removed';
    case 'change':
    case 'changed':
    case 'update':
    case 'updated':
      return 'changed';
    case 'complete':
    case 'completed':
    case 'done':
      return 'completed';
    default:
      return normalized || 'changed';
  }
}

function buildNormalizedPayload(
  payload: AsanaRecord,
  headers: Record<string, string>,
  connection: AsanaWebhookConnectionMetadata,
  event: AsanaRecord,
  normalized: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...payload };

  if (!merged.data && event.resource) {
    merged.data = event.resource;
  }

  const connectionPayload: Record<string, unknown> = {
    provider: connection.provider,
  };
  copyOptional(connectionPayload, 'connectionId', connection.connectionId);
  copyOptional(connectionPayload, 'deliveryId', connection.deliveryId);
  copyOptional(connectionPayload, 'providerConfigKey', connection.providerConfigKey);
  copyOptional(connectionPayload, 'requestId', connection.requestId);

  const webhookPayload: Record<string, unknown> = {
    action: normalized.action,
    eventType: normalized.eventType,
    objectId: normalized.objectId,
    objectType: normalized.objectType,
  };
  copyOptional(webhookPayload, 'createdAt', readOptionalString(event.created_at));
  copyOptional(webhookPayload, 'deliveryId', connection.deliveryId);
  copyOptional(webhookPayload, 'signature', connection.signature);
  copyOptional(webhookPayload, 'timestamp', connection.webhookTimestamp);
  copyOptional(webhookPayload, 'hookEvent', readOptionalString(headers[ASANA_HOOK_EVENT_HEADER]));

  const resource = getRecord(event.resource);
  copyOptional(webhookPayload, 'resourceName', readOptionalString(resource?.name));
  const parent = getRecord(event.parent);
  if (parent) {
    webhookPayload.parent = compactRecord({
      gid: readOptionalString(parent.gid),
      name: readOptionalString(parent.name),
      resource_type: readOptionalString(parent.resource_type),
    });
  }

  const user = getRecord(event.user);
  if (user) {
    webhookPayload.user = compactRecord({
      gid: readOptionalString(user.gid),
      name: readOptionalString(user.name),
      resource_type: readOptionalString(user.resource_type),
    });
  }

  merged._connection = connectionPayload;
  merged._webhook = webhookPayload;
  return merged;
}

function normalizeHeaders(headers: AsanaWebhookHeaders): Record<string, string> {
  const output: Record<string, string> = {};
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      output[key.toLowerCase()] = value;
    });
    return output;
  }

  if (isIterableHeaders(headers)) {
    for (const [key, value] of headers) {
      output[String(key).toLowerCase()] = String(value);
    }
    return output;
  }

  for (const [key, value] of Object.entries(headers)) {
    const normalized = normalizeHeaderValue(value);
    if (normalized !== undefined) {
      output[key.toLowerCase()] = normalized;
    }
  }
  return output;
}

function isIterableHeaders(value: unknown): value is Iterable<readonly [string, string]> {
  return value !== null && typeof value === 'object' && Symbol.iterator in value && !(value instanceof Array);
}

function normalizeHeaderValue(value: HeaderValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readHeaderValue(headers: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readOptionalString(headers[key]);
    if (value) return value;
  }
  return undefined;
}

function decodeWebhookPayload(rawPayload: unknown): unknown {
  if (typeof rawPayload === 'string') {
    return JSON.parse(rawPayload) as unknown;
  }
  if (Buffer.isBuffer(rawPayload)) {
    return JSON.parse(rawPayload.toString('utf8')) as unknown;
  }
  if (rawPayload instanceof Uint8Array) {
    return JSON.parse(Buffer.from(rawPayload).toString('utf8')) as unknown;
  }
  return rawPayload;
}

function rawPayloadToString(rawPayload: unknown): string {
  if (typeof rawPayload === 'string') {
    return rawPayload;
  }
  if (Buffer.isBuffer(rawPayload)) {
    return rawPayload.toString('utf8');
  }
  if (rawPayload instanceof Uint8Array) {
    return Buffer.from(rawPayload).toString('utf8');
  }
  return JSON.stringify(rawPayload);
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 100_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^\d+$/u.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return trimmed.length <= 10 ? numeric * 1000 : numeric;
    }
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getRecord(value: unknown): AsanaRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is AsanaRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function copyOptional(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== null && value !== '') {
      output[key] = value;
    }
  }
  return output;
}
