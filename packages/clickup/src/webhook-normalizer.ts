import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './clickup-adapter.js';

export const CLICKUP_PROVIDER = 'clickup';
export const CLICKUP_SIGNATURE_HEADER = 'x-signature';
export const CLICKUP_EVENT_HEADER = 'x-clickup-event';
export const CLICKUP_DELIVERY_HEADER = 'x-clickup-delivery-id';
export const CLICKUP_TIMESTAMP_HEADER = 'x-clickup-timestamp';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-clickup-connection-id',
  'clickup-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-clickup-provider',
  'clickup-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-clickup-provider-config-key',
  'clickup-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = [
  'x-request-id',
  'x-correlation-id',
  'x-relay-request-id',
] as const;

const TIMESTAMP_HEADER_KEYS = [
  CLICKUP_TIMESTAMP_HEADER,
  'x-timestamp',
  'x-webhook-timestamp',
] as const;

const OBJECT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  folder: 'folder',
  foldercreated: 'folder',
  folderdeleted: 'folder',
  folderupdated: 'folder',
  folders: 'folder',
  list: 'list',
  listcreated: 'list',
  listdeleted: 'list',
  listupdated: 'list',
  lists: 'list',
  space: 'space',
  spacecreated: 'space',
  spacedeleted: 'space',
  spaceupdated: 'space',
  spaces: 'space',
  task: 'task',
  taskcreated: 'task',
  taskdeleted: 'task',
  taskupdated: 'task',
  tasks: 'task',
};

const ACTION_ALIASES: Readonly<Record<string, string>> = {
  create: 'created',
  created: 'created',
  delete: 'deleted',
  deleted: 'deleted',
  remove: 'deleted',
  removed: 'deleted',
  update: 'updated',
  updated: 'updated',
};

type ClickUpRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type ClickUpWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface ClickUpWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  webhookId?: string;
  webhookTimestamp?: number;
}

export interface ClickUpWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?: 'invalid-signature' | 'malformed-signature' | 'missing-secret' | 'missing-signature';
  receivedSignature?: string;
}

export interface ClickUpWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

export function normalizeClickUpWebhook(
  rawPayload: unknown,
  headers: ClickUpWebhookHeaders = {},
): NormalizedWebhook {
  const payload = parseClickUpWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const eventType = extractClickUpEventType(payload, normalizedHeaders);
  const objectType = extractClickUpObjectType(payload, normalizedHeaders);
  const objectId = extractClickUpObjectId(payload, objectType);
  const connection = extractClickUpConnectionMetadata(payload, normalizedHeaders);
  const normalizedPayload = buildNormalizedPayload(payload, normalizedHeaders, connection, {
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

export function parseClickUpWebhookPayload(rawPayload: unknown): ClickUpRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('ClickUp webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractClickUpConnectionMetadata(
  payload: unknown,
  headers: ClickUpWebhookHeaders = {},
): ClickUpWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseClickUpWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: ClickUpWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      CLICKUP_PROVIDER,
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
    readOptionalString(normalizedHeaders[CLICKUP_DELIVERY_HEADER]) ??
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
    readOptionalString(normalizedHeaders[CLICKUP_SIGNATURE_HEADER]) ??
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

  const webhookId =
    readOptionalString(record.webhook_id) ??
    readOptionalString(record.webhookId) ??
    readOptionalString(metadata?.webhook_id) ??
    readOptionalString(metadata?.webhookId) ??
    readOptionalString(webhook?.webhook_id) ??
    readOptionalString(webhook?.webhookId);
  if (webhookId) {
    result.webhookId = webhookId;
  }

  const webhookTimestamp =
    readOptionalTimestamp(readHeaderValue(normalizedHeaders, TIMESTAMP_HEADER_KEYS)) ??
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

export function extractClickUpEventType(
  payload: unknown,
  headers: ClickUpWebhookHeaders = {},
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseClickUpWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const explicitEvent =
    readOptionalString(record.event) ??
    readOptionalString(record.eventType) ??
    readOptionalString(record.event_type) ??
    readOptionalString(normalizedHeaders[CLICKUP_EVENT_HEADER]) ??
    readOptionalString(metadata?.event) ??
    readOptionalString(metadata?.eventType) ??
    readOptionalString(metadata?.event_type) ??
    readOptionalString(webhook?.eventType) ??
    readOptionalString(webhook?.event_type);

  const objectType = extractClickUpObjectType(record, normalizedHeaders);
  const action = canonicalizeAction(explicitEvent ?? readOptionalString(webhook?.action) ?? 'updated');
  return `${objectType}.${action}`;
}

export function extractClickUpObjectType(
  payload: unknown,
  headers: ClickUpWebhookHeaders = {},
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseClickUpWebhookPayload(payload);
  const data = getRecord(record.data);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);

  const rawType =
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(record.type) ??
    readOptionalString(record.event) ??
    readOptionalString(normalizedHeaders[CLICKUP_EVENT_HEADER]) ??
    readOptionalString(metadata?.objectType) ??
    readOptionalString(metadata?.object_type) ??
    readOptionalString(metadata?.type) ??
    readOptionalString(webhook?.objectType) ??
    readOptionalString(webhook?.object_type);

  if (rawType) {
    return canonicalizeObjectType(rawType);
  }

  if (readOptionalString(record.task_id) ?? readOptionalString(data?.task_id)) {
    return 'task';
  }
  if (readOptionalString(record.list_id) ?? readOptionalString(data?.list_id)) {
    return 'list';
  }
  if (readOptionalString(record.folder_id) ?? readOptionalString(data?.folder_id)) {
    return 'folder';
  }
  if (readOptionalString(record.space_id) ?? readOptionalString(data?.space_id)) {
    return 'space';
  }

  throw new Error('ClickUp webhook payload is missing object type metadata.');
}

export function extractClickUpObjectId(payload: unknown, objectType?: string): string {
  const record = parseClickUpWebhookPayload(payload);
  const data = getRecord(record.data);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const normalizedType = objectType ?? extractClickUpObjectType(record);

  const typeSpecificId = readTypeSpecificId(record, data, normalizedType);
  const objectId =
    typeSpecificId ??
    readOptionalString(data?.id) ??
    readOptionalString(record.objectId) ??
    readOptionalString(record.object_id) ??
    readOptionalString(metadata?.objectId) ??
    readOptionalString(metadata?.object_id) ??
    readOptionalString(webhook?.objectId) ??
    readOptionalString(webhook?.object_id) ??
    readOptionalString(record.id);

  if (!objectId) {
    throw new Error('ClickUp webhook payload is missing an object identifier.');
  }

  return objectId;
}

export function computeClickUpWebhookSignature(rawPayload: unknown, secret: string): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error('ClickUp webhook secret must be a non-empty string.');
  }

  return createHmac('sha256', normalizedSecret)
    .update(toRawBodyBuffer(rawPayload))
    .digest('hex');
}

export function validateClickUpWebhookSignature(
  rawPayload: unknown,
  headers: ClickUpWebhookHeaders,
  secret: string,
): ClickUpWebhookSignatureValidationResult {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedSignature = readOptionalString(normalizedHeaders[CLICKUP_SIGNATURE_HEADER]);
  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature' };
  }

  const normalizedSignature = normalizeSignatureDigest(receivedSignature);
  if (!normalizedSignature) {
    return { ok: false, reason: 'malformed-signature', receivedSignature };
  }

  const expectedSignature = computeClickUpWebhookSignature(rawPayload, normalizedSecret);
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const headerBuffer = Buffer.from(normalizedSignature, 'utf8');
  if (expectedBuffer.length !== headerBuffer.length) {
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

export function assertValidClickUpWebhookSignature(
  rawPayload: unknown,
  headers: ClickUpWebhookHeaders,
  secret: string,
): void {
  const result = validateClickUpWebhookSignature(rawPayload, headers, secret);
  if (!result.ok) {
    throw new Error(
      `Invalid ClickUp webhook signature${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function validateClickUpWebhookTimestamp(
  payloadOrHeaders: unknown,
  headers: ClickUpWebhookHeaders = {},
  toleranceMs = 300_000,
  now = Date.now(),
): ClickUpWebhookTimestampValidationResult {
  const metadata = extractClickUpConnectionMetadata(payloadOrHeaders, headers);
  if (metadata.webhookTimestamp === undefined) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const driftMs = Math.abs(now - metadata.webhookTimestamp);
  if (driftMs > toleranceMs) {
    return {
      ok: false,
      reason: 'stale-timestamp',
      webhookTimestamp: metadata.webhookTimestamp,
      driftMs,
    };
  }

  return {
    ok: true,
    webhookTimestamp: metadata.webhookTimestamp,
    driftMs,
  };
}

export function assertValidClickUpWebhookTimestamp(
  payloadOrHeaders: unknown,
  headers: ClickUpWebhookHeaders = {},
  toleranceMs = 300_000,
  now = Date.now(),
): void {
  const result = validateClickUpWebhookTimestamp(payloadOrHeaders, headers, toleranceMs, now);
  if (!result.ok) {
    throw new Error(
      `Invalid ClickUp webhook timestamp${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

function buildNormalizedPayload(
  payload: ClickUpRecord,
  headers: Record<string, string>,
  connection: ClickUpWebhookConnectionMetadata,
  normalized: {
    eventType: string;
    objectId: string;
    objectType: string;
  },
): ClickUpRecord {
  const existingConnection = getRecord(payload._connection);
  const existingWebhook = getRecord(payload._webhook);
  const event = readOptionalString(payload.event) ?? readOptionalString(headers[CLICKUP_EVENT_HEADER]);

  return {
    ...payload,
    _connection: compactObject({
      ...existingConnection,
      connectionId: connection.connectionId,
      deliveryId: connection.deliveryId,
      provider: connection.provider,
      providerConfigKey: connection.providerConfigKey,
      requestId: connection.requestId,
    }),
    _webhook: compactObject({
      ...existingWebhook,
      action: normalized.eventType.slice(normalized.eventType.lastIndexOf('.') + 1),
      deliveryId: connection.deliveryId ?? readOptionalString(existingWebhook?.deliveryId),
      event,
      eventHeader: readOptionalString(headers[CLICKUP_EVENT_HEADER]) ?? readOptionalString(existingWebhook?.eventHeader),
      eventType: normalized.eventType,
      objectId: normalized.objectId,
      objectType: normalized.objectType,
      signature: connection.signature ?? readOptionalString(existingWebhook?.signature),
      webhookId: connection.webhookId ?? readOptionalString(existingWebhook?.webhookId),
      webhookTimestamp: connection.webhookTimestamp ?? readOptionalNumber(existingWebhook?.webhookTimestamp),
    }),
  };
}

function readTypeSpecificId(
  record: ClickUpRecord,
  data: ClickUpRecord | undefined,
  objectType: string,
): string | undefined {
  switch (objectType) {
    case 'folder':
      return readOptionalString(record.folder_id) ?? readOptionalString(data?.folder_id);
    case 'list':
      return readOptionalString(record.list_id) ?? readOptionalString(data?.list_id);
    case 'space':
      return readOptionalString(record.space_id) ?? readOptionalString(data?.space_id);
    case 'task':
      return readOptionalString(record.task_id) ?? readOptionalString(data?.task_id);
    default:
      return undefined;
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

function normalizeHeaders(headers: ClickUpWebhookHeaders): Record<string, string> {
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

function canonicalizeObjectType(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z]/g, '');
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

  throw new Error(`Unsupported ClickUp webhook object type: ${value}`);
}

function canonicalizeAction(value: string): string {
  const normalized = value.trim().toLowerCase();
  const direct = ACTION_ALIASES[normalized];
  if (direct) {
    return direct;
  }

  if (normalized.includes('created')) return 'created';
  if (normalized.includes('deleted')) return 'deleted';
  if (normalized.includes('removed')) return 'deleted';
  if (normalized.includes('updated')) return 'updated';
  if (normalized.includes('update')) return 'updated';
  if (normalized.includes('create')) return 'created';
  if (normalized.includes('delete')) return 'deleted';
  return 'updated';
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

function normalizeSignatureDigest(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(trimmed)) {
    return undefined;
  }
  return trimmed;
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
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  const numeric = readOptionalNumber(value);
  if (numeric !== undefined) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }

  const stringValue = readOptionalString(value);
  if (!stringValue) {
    return undefined;
  }
  const parsed = Date.parse(stringValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as T;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIterableEntries(value: unknown): value is Iterable<readonly [string, string]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.iterator in value &&
    !(typeof Headers !== 'undefined' && value instanceof Headers) &&
    !Array.isArray(value)
  );
}
