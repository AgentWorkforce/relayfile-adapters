import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './linear-adapter.js';

export const LINEAR_PROVIDER = 'linear';
export const LINEAR_SIGNATURE_HEADER = 'linear-signature';
export const LINEAR_EVENT_HEADER = 'linear-event';
export const LINEAR_DELIVERY_HEADER = 'linear-delivery';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-linear-connection-id',
  'linear-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-linear-provider',
  'linear-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-linear-provider-config-key',
  'linear-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;

const OBJECT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  comment: 'comment',
  comments: 'comment',
  cycle: 'cycle',
  cycles: 'cycle',
  customer: 'customer',
  customers: 'customer',
  document: 'document',
  documents: 'document',
  initiative: 'initiative',
  initiatives: 'initiative',
  issue: 'issue',
  issues: 'issue',
  label: 'label',
  labels: 'label',
  milestone: 'milestone',
  milestones: 'milestone',
  project: 'project',
  projectmilestone: 'milestone',
  projectmilestones: 'milestone',
  projects: 'project',
  reaction: 'reaction',
  reactions: 'reaction',
  roadmap: 'roadmap',
  roadmaps: 'roadmap',
  team: 'team',
  teams: 'team',
  user: 'user',
  users: 'user',
};

type LinearRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type LinearWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface LinearWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  webhookId?: string;
  webhookTimestamp?: number;
}

export interface LinearWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?: 'invalid-signature' | 'malformed-signature' | 'missing-secret' | 'missing-signature';
  receivedSignature?: string;
}

export interface LinearWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

export function normalizeLinearWebhook(
  rawPayload: unknown,
  headers: LinearWebhookHeaders = {},
): NormalizedWebhook {
  const payload = parseLinearWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const action = extractLinearAction(payload, rawPayload).toLowerCase();
  const objectType = extractLinearObjectType(payload, normalizedHeaders);
  const objectId = extractLinearObjectId(payload);
  const eventType = extractLinearEventType(payload, normalizedHeaders, objectType, action);
  const connection = extractLinearConnectionMetadata(payload, normalizedHeaders);

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

export function parseLinearWebhookPayload(rawPayload: unknown): LinearRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Linear webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractLinearConnectionMetadata(
  payload: unknown,
  headers: LinearWebhookHeaders = {},
): LinearWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseLinearWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: LinearWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      LINEAR_PROVIDER,
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
    readOptionalString(normalizedHeaders[LINEAR_DELIVERY_HEADER]) ??
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
    readOptionalString(normalizedHeaders[LINEAR_SIGNATURE_HEADER]) ??
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
    readOptionalString(record.webhookId) ??
    readOptionalString(record.webhook_id) ??
    readOptionalString(metadata?.webhookId) ??
    readOptionalString(metadata?.webhook_id) ??
    readOptionalString(webhook?.webhookId) ??
    readOptionalString(webhook?.webhook_id);
  if (webhookId) {
    result.webhookId = webhookId;
  }

  const webhookTimestamp =
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

export function extractLinearEventType(
  payload: unknown,
  headers: LinearWebhookHeaders = {},
  objectType?: string,
  action?: string,
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseLinearWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const resolvedObjectType = objectType ?? extractLinearObjectType(record, normalizedHeaders);
  const resolvedAction = action ?? extractLinearAction(record, payload).toLowerCase();

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

export function extractLinearObjectType(
  payload: unknown,
  headers: LinearWebhookHeaders = {},
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseLinearWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const rawType =
    readOptionalString(record.type) ??
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(normalizedHeaders[LINEAR_EVENT_HEADER]) ??
    readOptionalString(metadata?.type) ??
    readOptionalString(metadata?.objectType) ??
    readOptionalString(metadata?.object_type) ??
    readOptionalString(webhook?.objectType) ??
    readOptionalString(webhook?.object_type);

  if (!rawType) {
    throw new Error('Linear webhook payload is missing type metadata.');
  }

  return canonicalizeObjectType(rawType);
}

export function extractLinearObjectId(payload: unknown): string {
  const record = parseLinearWebhookPayload(payload);
  const data = getRecord(record.data);
  const issueData = getRecord(record.issueData);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);

  const objectId =
    readOptionalString(data?.id) ??
    readOptionalString(issueData?.id) ??
    readOptionalString(record.objectId) ??
    readOptionalString(record.object_id) ??
    readOptionalString(metadata?.objectId) ??
    readOptionalString(metadata?.object_id) ??
    readOptionalString(webhook?.objectId) ??
    readOptionalString(webhook?.object_id) ??
    readOptionalString(record.oauthClientId) ??
    readOptionalString(record.id);

  if (!objectId) {
    throw new Error('Linear webhook payload is missing an object identifier.');
  }

  return objectId;
}

export function computeLinearWebhookSignature(
  rawPayload: unknown,
  secret: string,
): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error('Linear webhook secret must be a non-empty string.');
  }

  return createHmac('sha256', normalizedSecret)
    .update(toRawBodyBuffer(rawPayload))
    .digest('hex');
}

export function validateLinearWebhookSignature(
  rawPayload: unknown,
  headers: LinearWebhookHeaders,
  secret: string,
): LinearWebhookSignatureValidationResult {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedSignature = readOptionalString(normalizedHeaders[LINEAR_SIGNATURE_HEADER]);
  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature' };
  }

  const normalizedSignature = normalizeSignatureDigest(receivedSignature);
  if (!normalizedSignature) {
    return { ok: false, reason: 'malformed-signature', receivedSignature };
  }

  const headerBuffer = Buffer.from(normalizedSignature, 'hex');
  const expectedSignature = computeLinearWebhookSignature(rawPayload, normalizedSecret);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

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

export function assertValidLinearWebhookSignature(
  rawPayload: unknown,
  headers: LinearWebhookHeaders,
  secret: string,
): void {
  const result = validateLinearWebhookSignature(rawPayload, headers, secret);
  if (!result.ok) {
    throw new Error(
      `Invalid Linear webhook signature${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function validateLinearWebhookTimestamp(
  payload: unknown,
  toleranceMs = 60_000,
  now = Date.now(),
): LinearWebhookTimestampValidationResult {
  const record = parseLinearWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const webhookTimestamp =
    readOptionalTimestamp(record.webhookTimestamp) ??
    readOptionalTimestamp(record.webhook_timestamp) ??
    readOptionalTimestamp(metadata?.webhookTimestamp) ??
    readOptionalTimestamp(metadata?.webhook_timestamp) ??
    readOptionalTimestamp(webhook?.webhookTimestamp) ??
    readOptionalTimestamp(webhook?.webhook_timestamp);
  if (webhookTimestamp === undefined) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const driftMs = Math.abs(now - webhookTimestamp);
  if (driftMs > toleranceMs) {
    return { ok: false, reason: 'stale-timestamp', webhookTimestamp, driftMs };
  }

  return { ok: true, webhookTimestamp, driftMs };
}

export function assertValidLinearWebhookTimestamp(
  payload: unknown,
  toleranceMs = 60_000,
  now = Date.now(),
): void {
  const result = validateLinearWebhookTimestamp(payload, toleranceMs, now);
  if (!result.ok) {
    throw new Error(
      `Invalid Linear webhook timestamp${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

function buildNormalizedPayload(
  payload: LinearRecord,
  headers: Record<string, string>,
  connection: LinearWebhookConnectionMetadata,
  normalized: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): LinearRecord {
  const existingConnection = getRecord(payload._connection);
  const existingWebhook = getRecord(payload._webhook);

  const normalizedPayload: LinearRecord = { ...payload };

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
    actor: getRecord(payload.actor) ?? existingWebhook?.actor,
    createdAt: readOptionalString(payload.createdAt) ?? readOptionalString(existingWebhook?.createdAt),
    deliveryId: connection.deliveryId ?? readOptionalString(existingWebhook?.deliveryId),
    eventHeader: readOptionalString(headers[LINEAR_EVENT_HEADER]) ?? readOptionalString(existingWebhook?.eventHeader),
    eventType: normalized.eventType,
    objectId: normalized.objectId,
    objectType: normalized.objectType,
    organizationId:
      readOptionalString(payload.organizationId) ?? readOptionalString(existingWebhook?.organizationId),
    previousData:
      getRecord(payload.updatedFrom) ??
      getRecord(payload.previousData) ??
      getRecord(existingWebhook?.previousData),
    signature: connection.signature ?? readOptionalString(existingWebhook?.signature),
    url: readOptionalString(payload.url) ?? readOptionalString(existingWebhook?.url),
    webhookId: connection.webhookId ?? readOptionalString(existingWebhook?.webhookId),
    webhookTimestamp:
      connection.webhookTimestamp ?? readOptionalNumber(payload.webhookTimestamp) ?? readOptionalNumber(existingWebhook?.webhookTimestamp),
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

function normalizeHeaders(headers: LinearWebhookHeaders): Record<string, string> {
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

function extractLinearAction(record: LinearRecord, context: unknown): string {
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const action =
    readOptionalString(record.action) ??
    readOptionalString(metadata?.action) ??
    readOptionalString(webhook?.action);

  if (!action) {
    throw new Error('Linear webhook payload is missing action.');
  }

  return action;
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

  if (normalized === objectType) {
    return `${objectType}.${action}`;
  }

  return normalized;
}

function canonicalizeObjectType(value: string): string {
  const normalized = value.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (mapped) {
    return mapped;
  }

  for (const token of normalized.split(/[^a-z]+/)) {
    const tokenMatch = OBJECT_TYPE_ALIASES[token];
    if (tokenMatch) {
      return tokenMatch;
    }
  }

  return normalized;
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

function getRecord(value: unknown): LinearRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is LinearRecord {
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

function compactObject(value: LinearRecord): LinearRecord {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries);
}

function normalizeSignatureDigest(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const unprefixed = trimmed.replace(/^sha256=/i, '');
  return isHexDigest(unprefixed) ? unprefixed.toLowerCase() : undefined;
}

function isHexDigest(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

function readRequiredString(record: LinearRecord, key: string, context: unknown): string {
  const value = readOptionalString(record[key]);
  if (!value) {
    throw new Error(`Linear webhook payload is missing ${key}.`);
  }
  return value;
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
    return numericValue;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
