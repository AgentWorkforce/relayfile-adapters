import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './shopify-adapter.js';
import { normalizeShopifyObjectType } from './path-mapper.js';

export const SHOPIFY_PROVIDER = 'shopify';
export const SHOPIFY_HMAC_HEADER = 'x-shopify-hmac-sha256';
export const SHOPIFY_TOPIC_HEADER = 'x-shopify-topic';
export const SHOPIFY_SHOP_DOMAIN_HEADER = 'x-shopify-shop-domain';
export const SHOPIFY_API_VERSION_HEADER = 'x-shopify-api-version';
export const SHOPIFY_WEBHOOK_ID_HEADER = 'x-shopify-webhook-id';
export const SHOPIFY_TRIGGERED_AT_HEADER = 'x-shopify-triggered-at';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-shopify-connection-id',
  'shopify-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-shopify-provider',
  'shopify-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-shopify-provider-config-key',
  'shopify-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;
const DEFAULT_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

type ShopifyRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type ShopifyWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface ShopifyWebhookConnectionMetadata {
  apiVersion?: string;
  connectionId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  shopDomain?: string;
  signature?: string;
  webhookId?: string;
  webhookTimestamp?: number;
}

export interface ShopifyWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?: 'invalid-signature' | 'malformed-signature' | 'missing-secret' | 'missing-signature';
  receivedSignature?: string;
}

export interface ShopifyWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

export interface NormalizeShopifyWebhookOptions {
  nowMs?: number;
  requireTimestamp?: boolean;
  toleranceMs?: number;
  webhookSecret?: string;
}

export function normalizeShopifyWebhook(
  rawPayload: unknown,
  headers: ShopifyWebhookHeaders = {},
  options: NormalizeShopifyWebhookOptions = {},
): NormalizedWebhook {
  const normalizedHeaders = normalizeHeaders(headers);
  if (options.webhookSecret !== undefined) {
    assertValidShopifyWebhookSignature(rawPayload, normalizedHeaders, options.webhookSecret);
  }

  const timestampResult = validateShopifyWebhookTimestamp(
    normalizedHeaders,
    options.toleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS,
    options.nowMs,
    options.requireTimestamp ?? false,
  );
  if (!timestampResult.ok) {
    throw new Error(`Invalid Shopify webhook timestamp: ${timestampResult.reason}`);
  }

  const payload = parseShopifyWebhookPayload(rawPayload);
  const topic = extractShopifyTopic(payload, normalizedHeaders);
  const objectType = extractShopifyObjectType(payload, normalizedHeaders, topic);
  const objectId = extractShopifyObjectId(payload);
  const action = extractShopifyAction(payload, topic);
  const eventType = `${objectType}.${action}`;
  const connection = extractShopifyConnectionMetadata(payload, normalizedHeaders);

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
      topic,
    }),
  };

  if (connection.connectionId) {
    normalized.connectionId = connection.connectionId;
  }

  return normalized;
}

export function parseShopifyWebhookPayload(rawPayload: unknown): ShopifyRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Shopify webhook payload must be a JSON object.');
  }
  return decoded;
}

export function computeShopifyWebhookSignature(rawPayload: unknown, webhookSecret: string): string {
  const secret = webhookSecret.trim();
  if (!secret) {
    throw new Error('Shopify webhook secret must be a non-empty string.');
  }
  return createHmac('sha256', secret).update(toRawBodyBuffer(rawPayload)).digest('base64');
}

export function validateShopifyWebhookSignature(
  rawPayload: unknown,
  headers: ShopifyWebhookHeaders = {},
  webhookSecret?: string,
): ShopifyWebhookSignatureValidationResult {
  const secret = webhookSecret?.trim();
  if (!secret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedSignature = readOptionalString(normalizedHeaders[SHOPIFY_HMAC_HEADER]);
  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature' };
  }

  const headerBuffer = decodeBase64Signature(receivedSignature);
  if (!headerBuffer) {
    return {
      ok: false,
      reason: 'malformed-signature',
      receivedSignature,
    };
  }

  const expectedSignature = computeShopifyWebhookSignature(rawPayload, secret);
  const expectedBuffer = Buffer.from(expectedSignature, 'base64');
  const ok = headerBuffer.length === expectedBuffer.length && timingSafeEqual(headerBuffer, expectedBuffer);

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

export function assertValidShopifyWebhookSignature(
  rawPayload: unknown,
  headers: ShopifyWebhookHeaders = {},
  webhookSecret?: string,
): void {
  const result = validateShopifyWebhookSignature(rawPayload, headers, webhookSecret);
  if (!result.ok) {
    throw new Error(`Invalid Shopify webhook signature: ${result.reason}`);
  }
}

export function validateShopifyWebhookTimestamp(
  headers: ShopifyWebhookHeaders = {},
  toleranceMs = DEFAULT_WEBHOOK_TOLERANCE_MS,
  nowMs = Date.now(),
  requireTimestamp = false,
): ShopifyWebhookTimestampValidationResult {
  const normalizedHeaders = normalizeHeaders(headers);
  const webhookTimestamp = readOptionalTimestamp(normalizedHeaders[SHOPIFY_TRIGGERED_AT_HEADER]);

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

export function extractShopifyConnectionMetadata(
  payload: unknown,
  headers: ShopifyWebhookHeaders = {},
): ShopifyWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseShopifyWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: ShopifyWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      SHOPIFY_PROVIDER,
  };

  copyOptional(result, 'connectionId',
    readHeaderValue(normalizedHeaders, CONNECTION_ID_HEADER_KEYS) ??
      readOptionalString(record.connectionId) ??
      readOptionalString(record.connection_id) ??
      readOptionalString(metadata?.connectionId) ??
      readOptionalString(metadata?.connection_id) ??
      readOptionalString(normalizedConnection?.connectionId) ??
      readOptionalString(normalizedConnection?.connection_id) ??
      readOptionalString(connection?.id));

  copyOptional(result, 'providerConfigKey',
    readHeaderValue(normalizedHeaders, PROVIDER_CONFIG_KEY_HEADER_KEYS) ??
      readOptionalString(record.providerConfigKey) ??
      readOptionalString(record.provider_config_key) ??
      readOptionalString(metadata?.providerConfigKey) ??
      readOptionalString(metadata?.provider_config_key) ??
      readOptionalString(normalizedConnection?.providerConfigKey) ??
      readOptionalString(normalizedConnection?.provider_config_key));

  copyOptional(result, 'requestId',
    readHeaderValue(normalizedHeaders, REQUEST_ID_HEADER_KEYS) ??
      readOptionalString(record.requestId) ??
      readOptionalString(record.request_id) ??
      readOptionalString(metadata?.requestId) ??
      readOptionalString(metadata?.request_id) ??
      readOptionalString(normalizedConnection?.requestId) ??
      readOptionalString(normalizedConnection?.request_id));

  copyOptional(result, 'shopDomain',
    readOptionalString(normalizedHeaders[SHOPIFY_SHOP_DOMAIN_HEADER]) ??
      readOptionalString(record.shopDomain) ??
      readOptionalString(record.shop_domain) ??
      readOptionalString(metadata?.shopDomain) ??
      readOptionalString(metadata?.shop_domain) ??
      readOptionalString(normalizedConnection?.shopDomain) ??
      readOptionalString(normalizedConnection?.shop_domain));

  copyOptional(result, 'apiVersion',
    readOptionalString(normalizedHeaders[SHOPIFY_API_VERSION_HEADER]) ??
      readOptionalString(record.apiVersion) ??
      readOptionalString(record.api_version) ??
      readOptionalString(metadata?.apiVersion) ??
      readOptionalString(metadata?.api_version) ??
      readOptionalString(webhook?.apiVersion) ??
      readOptionalString(webhook?.api_version));

  copyOptional(result, 'webhookId',
    readOptionalString(normalizedHeaders[SHOPIFY_WEBHOOK_ID_HEADER]) ??
      readOptionalString(record.webhookId) ??
      readOptionalString(record.webhook_id) ??
      readOptionalString(metadata?.webhookId) ??
      readOptionalString(metadata?.webhook_id) ??
      readOptionalString(webhook?.webhookId) ??
      readOptionalString(webhook?.webhook_id));

  copyOptional(result, 'signature',
    readOptionalString(normalizedHeaders[SHOPIFY_HMAC_HEADER]) ??
      readOptionalString(record.signature) ??
      readOptionalString(metadata?.signature) ??
      readOptionalString(webhook?.signature));

  const webhookTimestamp =
    readOptionalTimestamp(normalizedHeaders[SHOPIFY_TRIGGERED_AT_HEADER]) ??
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

export function extractShopifyTopic(payload: unknown, headers: ShopifyWebhookHeaders = {}): string {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseShopifyWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const topic =
    readOptionalString(normalizedHeaders[SHOPIFY_TOPIC_HEADER]) ??
    readOptionalString(record.topic) ??
    readOptionalString(record.shopifyTopic) ??
    readOptionalString(record.shopify_topic) ??
    readOptionalString(metadata?.topic) ??
    readOptionalString(webhook?.topic);

  if (!topic) {
    throw new Error('Shopify webhook is missing X-Shopify-Topic.');
  }
  return topic.toLowerCase();
}

export function extractShopifyObjectType(
  payload: unknown,
  headers: ShopifyWebhookHeaders = {},
  topic?: string,
): string {
  const record = parseShopifyWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const topicType = objectTypeFromTopic(topic ?? readOptionalString(normalizeHeaders(headers)[SHOPIFY_TOPIC_HEADER]));
  const rawType =
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(record.type) ??
    readOptionalString(metadata?.objectType) ??
    readOptionalString(metadata?.object_type) ??
    readOptionalString(webhook?.objectType) ??
    readOptionalString(webhook?.object_type) ??
    topicType ??
    inferObjectType(record);

  return normalizeShopifyObjectType(rawType);
}

export function extractShopifyObjectId(payload: unknown): string {
  const record = parseShopifyWebhookPayload(payload);
  const data = getRecord(record.data);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const objectId =
    stringifyId(data?.id) ??
    readOptionalString(data?.admin_graphql_api_id) ??
    stringifyId(record.id) ??
    readOptionalString(record.admin_graphql_api_id) ??
    readOptionalString(record.objectId) ??
    readOptionalString(record.object_id) ??
    readOptionalString(metadata?.objectId) ??
    readOptionalString(metadata?.object_id) ??
    readOptionalString(webhook?.objectId) ??
    readOptionalString(webhook?.object_id);

  if (!objectId) {
    throw new Error('Shopify webhook payload is missing an object identifier.');
  }
  return objectId;
}

export function extractShopifyAction(payload: unknown, topic?: string): string {
  const record = parseShopifyWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const rawAction =
    readOptionalString(record.action) ??
    readOptionalString(metadata?.action) ??
    readOptionalString(webhook?.action) ??
    actionFromTopic(topic) ??
    'update';
  return normalizeAction(rawAction);
}

function buildNormalizedPayload(
  payload: ShopifyRecord,
  headers: Record<string, string>,
  connection: ShopifyWebhookConnectionMetadata,
  normalized: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
    topic: string;
  },
): ShopifyRecord {
  const existingConnection = getRecord(payload._connection);
  const existingWebhook = getRecord(payload._webhook);
  const normalizedPayload: ShopifyRecord = { ...payload };

  normalizedPayload._connection = compactRecord({
    ...existingConnection,
    connectionId: connection.connectionId,
    provider: connection.provider,
    providerConfigKey: connection.providerConfigKey,
    requestId: connection.requestId,
    shopDomain: connection.shopDomain,
  });

  normalizedPayload._webhook = compactRecord({
    ...existingWebhook,
    action: normalized.action,
    apiVersion: connection.apiVersion,
    eventType: normalized.eventType,
    objectId: normalized.objectId,
    objectType: normalized.objectType,
    shopDomain: connection.shopDomain,
    signature: connection.signature,
    topic: normalized.topic,
    webhookId: connection.webhookId,
    webhookTimestamp: connection.webhookTimestamp,
    triggeredAt: readOptionalString(headers[SHOPIFY_TRIGGERED_AT_HEADER]),
  });

  return normalizedPayload;
}

function decodeBase64Signature(signature: string): Buffer | undefined {
  const trimmed = signature.trim();
  if (!trimmed || !/^[A-Za-z0-9+/]+={0,2}$/u.test(trimmed)) {
    return undefined;
  }
  const buffer = Buffer.from(trimmed, 'base64');
  return buffer.length > 0 ? buffer : undefined;
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
  if (rawPayload instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(rawPayload).toString('utf8')) as unknown;
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

function normalizeHeaders(headers: ShopifyWebhookHeaders): Record<string, string> {
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

function copyOptional(target: object, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') {
    (target as Record<string, unknown>)[key] = value;
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

function objectTypeFromTopic(topic: string | undefined): string | undefined {
  if (!topic) {
    return undefined;
  }
  const [resource] = topic.toLowerCase().split('/');
  if (!resource) {
    return undefined;
  }
  switch (resource) {
    case 'orders':
      return 'order';
    case 'products':
      return 'product';
    case 'customers':
      return 'customer';
    case 'fulfillments':
      return 'fulfillment';
    default:
      return undefined;
  }
}

function actionFromTopic(topic: string | undefined): string | undefined {
  if (!topic) {
    return undefined;
  }
  const [, action] = topic.toLowerCase().split('/');
  return action ? normalizeAction(action) : undefined;
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'create':
    case 'created':
      return 'create';
    case 'delete':
    case 'deleted':
    case 'redact':
      return 'delete';
    case 'fulfill':
    case 'fulfilled':
      return 'fulfill';
    case 'cancelled':
    case 'edited':
    case 'paid':
    case 'partially_fulfilled':
    case 'update':
    case 'updated':
      return 'update';
    default:
      return normalized || 'update';
  }
}

function inferObjectType(payload: ShopifyRecord): string {
  if ('line_items' in payload && ('total_price' in payload || 'order_number' in payload || 'financial_status' in payload)) {
    return 'order';
  }
  if ('variants' in payload || 'product_type' in payload || 'vendor' in payload) {
    return 'product';
  }
  if ('orders_count' in payload || 'total_spent' in payload || 'default_address' in payload) {
    return 'customer';
  }
  if ('tracking_number' in payload || 'shipment_status' in payload || 'order_id' in payload) {
    return 'fulfillment';
  }
  throw new Error('Unable to infer Shopify object type from webhook payload.');
}

function stringifyId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return readOptionalString(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function getRecord(value: unknown): ShopifyRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is ShopifyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
