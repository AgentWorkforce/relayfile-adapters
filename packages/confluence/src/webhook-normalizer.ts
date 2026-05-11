import { createHmac, timingSafeEqual } from 'node:crypto';

import { CONFLUENCE_PROVIDER_NAME, type ConfluenceNormalizedEvent } from './types.js';

export const CONFLUENCE_PROVIDER = CONFLUENCE_PROVIDER_NAME;
export const CONFLUENCE_SIGNATURE_HEADER = 'x-atlassian-webhook-identifier';
export const CONFLUENCE_EVENT_HEADER = 'x-atlassian-webhook-event';
export const CONFLUENCE_DELIVERY_HEADER = 'x-atlassian-webhook-delivery';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-confluence-connection-id',
  'confluence-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-confluence-provider',
  'confluence-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-confluence-provider-config-key',
  'confluence-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;

/**
 * Confluence Cloud emits webhooks with `webhookEvent: "page_created"`,
 * `"page_updated"`, etc. Map the snake_case events plus the v2 dot-notation
 * (`"page.created"`) to canonical `<objectType>.<action>` strings. Atlassian
 * Connect events arrive as `confluence:page_created` and similar — the prefix
 * is stripped here.
 */
const EVENT_ALIASES: Readonly<Record<string, string>> = {
  page_created: 'page.create',
  page_updated: 'page.update',
  page_removed: 'page.remove',
  page_trashed: 'page.remove',
  page_restored: 'page.update',
  page_archived: 'page.update',
  space_created: 'space.create',
  space_updated: 'space.update',
  space_removed: 'space.remove',
  'confluence:page_created': 'page.create',
  'confluence:page_updated': 'page.update',
  'confluence:page_removed': 'page.remove',
  'confluence:page_trashed': 'page.remove',
  'confluence:space_created': 'space.create',
  'confluence:space_updated': 'space.update',
  'confluence:space_removed': 'space.remove',
};

const OBJECT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  page: 'page',
  pages: 'page',
  space: 'space',
  spaces: 'space',
  confluencepage: 'page',
  confluencespace: 'space',
};

type ConfluenceRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type ConfluenceWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface ConfluenceWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  webhookId?: string;
  webhookTimestamp?: number;
}

export interface ConfluenceWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?: 'invalid-signature' | 'malformed-signature' | 'missing-secret' | 'missing-signature';
  receivedSignature?: string;
}

export interface ConfluenceWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

/**
 * Normalize a Confluence webhook payload into the adapter's
 * `ConfluenceNormalizedEvent` shape. The Atlassian webhook contract varies
 * between Cloud Connect apps and Forge webhooks; this normalizer pulls
 * `webhookEvent` or `eventType` from the envelope and resolves the underlying
 * object id from `page.id` / `space.id` / `content.id`. Callers in the cloud
 * webhook router should pass headers; everything else falls back to safe
 * defaults so the normalizer never crashes on partial payloads.
 *
 * NOTE: HMAC signing semantics for Confluence Connect/Forge webhooks are
 * complex (JWT-based for Connect; signed query secret for Forge) and the
 * upstream cloud handler does not validate signatures today. The
 * `validateConfluenceWebhookSignature` helper below implements the same
 * `sha256` HMAC contract Linear uses so it can be wired up symmetrically
 * once Confluence-side signing is enabled — until then the cloud-side
 * handler should skip signature validation.
 */
export function normalizeConfluenceWebhook(
  rawPayload: unknown,
  headers: ConfluenceWebhookHeaders = {},
): ConfluenceNormalizedEvent {
  const payload = parseConfluenceWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const eventType = extractConfluenceEventType(payload, normalizedHeaders);
  const objectType = extractConfluenceObjectType(payload, normalizedHeaders, eventType);
  const objectId = extractConfluenceObjectId(payload, objectType);
  const connection = extractConfluenceConnectionMetadata(payload, normalizedHeaders);

  const subject = pickSubject(payload, objectType);
  const ingestedPayload: ConfluenceRecord = {
    ...subject,
    _webhook: compactObject({
      eventHeader: normalizedHeaders[CONFLUENCE_EVENT_HEADER],
      deliveryId: connection.deliveryId,
      eventType,
      objectId,
      objectType,
      webhookId: connection.webhookId,
      webhookTimestamp: connection.webhookTimestamp,
    }),
    _connection: compactObject({
      connectionId: connection.connectionId,
      deliveryId: connection.deliveryId,
      provider: connection.provider,
      providerConfigKey: connection.providerConfigKey,
      requestId: connection.requestId,
    }),
  };

  if (subject?.id === undefined && objectId) {
    ingestedPayload.id = objectId;
  }

  const normalized: ConfluenceNormalizedEvent = {
    provider: connection.provider,
    eventType,
    objectType: objectType === 'space' ? 'space' : 'page',
    objectId,
    payload: ingestedPayload,
  };

  if (connection.connectionId) {
    normalized.connectionId = connection.connectionId;
  }
  if (connection.providerConfigKey) {
    normalized.providerConfigKey = connection.providerConfigKey;
  }

  return normalized;
}

export function parseConfluenceWebhookPayload(rawPayload: unknown): ConfluenceRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Confluence webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractConfluenceEventType(
  payload: unknown,
  headers: ConfluenceWebhookHeaders = {},
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseConfluenceWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const raw =
    readOptionalString(record.eventType) ??
    readOptionalString(record.event_type) ??
    readOptionalString(record.webhookEvent) ??
    readOptionalString(metadata?.eventType) ??
    readOptionalString(metadata?.event_type) ??
    readOptionalString(metadata?.webhookEvent) ??
    readOptionalString(webhook?.eventType) ??
    readOptionalString(webhook?.event_type) ??
    readOptionalString(normalizedHeaders[CONFLUENCE_EVENT_HEADER]);

  if (!raw) {
    throw new Error('Confluence webhook payload is missing eventType / webhookEvent.');
  }

  const canonical = EVENT_ALIASES[raw];
  if (canonical) return canonical;

  // Fallback: treat dot-notation `<type>.<action>` as canonical; otherwise
  // best-effort split on underscore so an unrecognized `space_renamed` event
  // still surfaces as `space.renamed`.
  if (raw.includes('.')) return raw.toLowerCase();
  const underscoreIndex = raw.indexOf('_');
  if (underscoreIndex > 0 && underscoreIndex < raw.length - 1) {
    const head = raw.slice(0, underscoreIndex).toLowerCase();
    const tail = raw.slice(underscoreIndex + 1).toLowerCase();
    const mappedHead = OBJECT_TYPE_ALIASES[head] ?? head;
    return `${mappedHead}.${tail}`;
  }
  return raw.toLowerCase();
}

export function extractConfluenceObjectType(
  payload: unknown,
  headers: ConfluenceWebhookHeaders = {},
  resolvedEventType?: string,
): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseConfluenceWebhookPayload(payload);
  const explicit =
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(getRecord(record.metadata)?.objectType) ??
    readOptionalString(getRecord(record._webhook)?.objectType) ??
    readOptionalString(normalizedHeaders['x-atlassian-webhook-object-type']);
  if (explicit) {
    return canonicalObjectType(explicit);
  }

  if (isRecord(record.page) || record.contentType === 'page') return 'page';
  if (isRecord(record.space) || record.contentType === 'space') return 'space';

  const eventType = resolvedEventType ?? extractConfluenceEventType(payload, headers);
  const dotIndex = eventType.indexOf('.');
  if (dotIndex > 0) {
    return canonicalObjectType(eventType.slice(0, dotIndex));
  }

  throw new Error('Confluence webhook payload is missing objectType.');
}

export function extractConfluenceObjectId(payload: unknown, objectType?: string): string {
  const record = parseConfluenceWebhookPayload(payload);
  const subject = pickSubject(record, objectType);
  const objectId =
    readOptionalString(subject?.id) ??
    readOptionalString(record.objectId) ??
    readOptionalString(record.object_id) ??
    readOptionalString(getRecord(record.metadata)?.objectId) ??
    readOptionalString(getRecord(record._webhook)?.objectId) ??
    readOptionalString(record.id);

  if (!objectId) {
    throw new Error('Confluence webhook payload is missing an object identifier.');
  }
  return objectId;
}

export function extractConfluenceConnectionMetadata(
  payload: unknown,
  headers: ConfluenceWebhookHeaders = {},
): ConfluenceWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseConfluenceWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: ConfluenceWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      CONFLUENCE_PROVIDER_NAME,
  };

  const connectionId =
    readHeaderValue(normalizedHeaders, CONNECTION_ID_HEADER_KEYS) ??
    readOptionalString(record.connectionId) ??
    readOptionalString(record.connection_id) ??
    readOptionalString(metadata?.connectionId) ??
    readOptionalString(metadata?.connection_id) ??
    readOptionalString(normalizedConnection?.connectionId) ??
    readOptionalString(connection?.id);
  if (connectionId) result.connectionId = connectionId;

  const providerConfigKey =
    readHeaderValue(normalizedHeaders, PROVIDER_CONFIG_KEY_HEADER_KEYS) ??
    readOptionalString(record.providerConfigKey) ??
    readOptionalString(record.provider_config_key) ??
    readOptionalString(metadata?.providerConfigKey) ??
    readOptionalString(normalizedConnection?.providerConfigKey);
  if (providerConfigKey) result.providerConfigKey = providerConfigKey;

  const deliveryId =
    readOptionalString(normalizedHeaders[CONFLUENCE_DELIVERY_HEADER]) ??
    readOptionalString(record.deliveryId) ??
    readOptionalString(record.delivery_id) ??
    readOptionalString(metadata?.deliveryId) ??
    readOptionalString(webhook?.deliveryId);
  if (deliveryId) result.deliveryId = deliveryId;

  const signature =
    readOptionalString(normalizedHeaders[CONFLUENCE_SIGNATURE_HEADER]) ??
    readOptionalString(record.signature) ??
    readOptionalString(metadata?.signature) ??
    readOptionalString(webhook?.signature);
  if (signature) result.signature = signature;

  const requestId =
    readHeaderValue(normalizedHeaders, REQUEST_ID_HEADER_KEYS) ??
    readOptionalString(record.requestId) ??
    readOptionalString(record.request_id);
  if (requestId) result.requestId = requestId;

  const webhookId =
    readOptionalString(record.webhookId) ??
    readOptionalString(record.webhook_id) ??
    readOptionalString(metadata?.webhookId) ??
    readOptionalString(webhook?.webhookId);
  if (webhookId) result.webhookId = webhookId;

  const webhookTimestamp =
    readOptionalTimestamp(record.timestamp) ??
    readOptionalTimestamp(record.webhookTimestamp) ??
    readOptionalTimestamp(record.webhook_timestamp) ??
    readOptionalTimestamp(metadata?.timestamp) ??
    readOptionalTimestamp(metadata?.webhookTimestamp) ??
    readOptionalTimestamp(webhook?.webhookTimestamp);
  if (webhookTimestamp !== undefined) result.webhookTimestamp = webhookTimestamp;

  return result;
}

export function computeConfluenceWebhookSignature(rawPayload: unknown, secret: string): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error('Confluence webhook secret must be a non-empty string.');
  }
  return createHmac('sha256', normalizedSecret)
    .update(toRawBodyBuffer(rawPayload))
    .digest('hex');
}

export function validateConfluenceWebhookSignature(
  rawPayload: unknown,
  headers: ConfluenceWebhookHeaders,
  secret: string,
): ConfluenceWebhookSignatureValidationResult {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedSignature = readOptionalString(normalizedHeaders[CONFLUENCE_SIGNATURE_HEADER]);
  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature' };
  }

  const normalizedSignature = normalizeSignatureDigest(receivedSignature);
  if (!normalizedSignature) {
    return { ok: false, reason: 'malformed-signature', receivedSignature };
  }

  const headerBuffer = Buffer.from(normalizedSignature, 'hex');
  const expectedSignature = computeConfluenceWebhookSignature(rawPayload, normalizedSecret);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (headerBuffer.length === 0 || headerBuffer.length !== expectedBuffer.length) {
    return { ok: false, reason: 'invalid-signature', expectedSignature, receivedSignature };
  }

  const ok = timingSafeEqual(expectedBuffer, headerBuffer);
  return {
    ok,
    ...(ok
      ? { expectedSignature, receivedSignature }
      : { reason: 'invalid-signature', expectedSignature, receivedSignature }),
  };
}

export function assertValidConfluenceWebhookSignature(
  rawPayload: unknown,
  headers: ConfluenceWebhookHeaders,
  secret: string,
): void {
  const result = validateConfluenceWebhookSignature(rawPayload, headers, secret);
  if (!result.ok) {
    throw new Error(
      `Invalid Confluence webhook signature${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function validateConfluenceWebhookTimestamp(
  payload: unknown,
  toleranceMs = 60_000,
  now = Date.now(),
): ConfluenceWebhookTimestampValidationResult {
  const record = parseConfluenceWebhookPayload(payload);
  const webhook = getRecord(record._webhook);
  const metadata = getRecord(record.metadata);
  const webhookTimestamp =
    readOptionalTimestamp(record.timestamp) ??
    readOptionalTimestamp(record.webhookTimestamp) ??
    readOptionalTimestamp(record.webhook_timestamp) ??
    readOptionalTimestamp(metadata?.timestamp) ??
    readOptionalTimestamp(metadata?.webhookTimestamp) ??
    readOptionalTimestamp(webhook?.webhookTimestamp);
  if (webhookTimestamp === undefined) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const driftMs = Math.abs(now - webhookTimestamp);
  if (driftMs > toleranceMs) {
    return { ok: false, reason: 'stale-timestamp', webhookTimestamp, driftMs };
  }

  return { ok: true, webhookTimestamp, driftMs };
}

function pickSubject(record: ConfluenceRecord, objectType?: string): ConfluenceRecord | undefined {
  if (objectType === 'page') {
    return getRecord(record.page) ?? getRecord(record.content);
  }
  if (objectType === 'space') {
    return getRecord(record.space);
  }
  return getRecord(record.page) ?? getRecord(record.space) ?? getRecord(record.content);
}

function canonicalObjectType(value: string): string {
  const normalized = value.trim().toLowerCase();
  return OBJECT_TYPE_ALIASES[normalized] ?? normalized;
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
  if (typeof rawPayload === 'string') return Buffer.from(rawPayload, 'utf8');
  if (Buffer.isBuffer(rawPayload)) return rawPayload;
  if (rawPayload instanceof Uint8Array) return Buffer.from(rawPayload);
  if (rawPayload instanceof ArrayBuffer) return Buffer.from(rawPayload);
  return Buffer.from(JSON.stringify(rawPayload), 'utf8');
}

function normalizeHeaders(headers: ConfluenceWebhookHeaders): Record<string, string> {
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
    if (value) return value;
  }
  return undefined;
}

function normalizeHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    const values = value.map((entry) => readOptionalString(entry)).filter(isDefined);
    return values.length > 0 ? values.join(', ') : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return readOptionalString(value);
}

function compactObject(value: ConfluenceRecord): ConfluenceRecord {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries);
}

function normalizeSignatureDigest(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const unprefixed = trimmed.replace(/^sha256=/i, '');
  return isHexDigest(unprefixed) ? unprefixed.toLowerCase() : undefined;
}

function isHexDigest(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

function getRecord(value: unknown): ConfluenceRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is ConfluenceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIterableEntries(value: unknown): value is Iterable<readonly [string, string]> {
  if (!value || typeof value !== 'object') return false;
  if (typeof Headers !== 'undefined' && value instanceof Headers) return false;
  return Symbol.iterator in value;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
