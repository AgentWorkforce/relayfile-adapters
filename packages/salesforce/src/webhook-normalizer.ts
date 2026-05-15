import { timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './salesforce-adapter.js';
import { normalizeSalesforceObjectType } from './path-mapper.js';
import type { SalesforceAdapterConfig } from './types.js';

export const SALESFORCE_PROVIDER = 'salesforce';
export const SALESFORCE_WEBHOOK_SECRET_HEADER = 'x-sfdc-webhook-secret';
export const SALESFORCE_WEBHOOK_TIMESTAMP_HEADER = 'x-sfdc-webhook-timestamp';
export const SALESFORCE_ORGANIZATION_ID_HEADER = 'x-sfdc-organization-id';
export const SALESFORCE_DELIVERY_ID_HEADER = 'x-sfdc-delivery-id';

export const SALESFORCE_MTLS_DEPLOYMENT_NOTE =
  'Salesforce Outbound Messages SOAP transport should be protected with org-level mTLS; this package verifies the application-layer X-SFDC-Webhook-Secret shared-secret header (literal value compare, not HMAC).';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-salesforce-connection-id',
  'salesforce-connection-id',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-salesforce-provider-config-key',
  'salesforce-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;

type HeaderValue = boolean | number | readonly string[] | string | null | undefined;
type SalesforceRecord = Record<string, unknown>;

export type SalesforceWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface SalesforceWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  organizationId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  secretDigest?: string;
  webhookTimestamp?: number;
}

export interface SalesforceWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?: 'invalid-secret' | 'missing-secret' | 'missing-secret-header';
  receivedSignature?: string;
}

export interface SalesforceWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

export interface NormalizeSalesforceWebhookOptions {
  now?: number;
  requireTimestamp?: boolean;
  timestampToleranceMs?: number;
}

export function normalizeSalesforceWebhook(
  rawPayload: unknown,
  headers: SalesforceWebhookHeaders = {},
  config: SalesforceAdapterConfig = {},
  options: NormalizeSalesforceWebhookOptions = {},
): NormalizedWebhook {
  if (config.webhookSecret) {
    assertValidSalesforceWebhookSecret(rawPayload, headers, config.webhookSecret);
  }

  const toleranceMs = options.timestampToleranceMs ?? config.webhookTimestampToleranceMs;
  if (options.requireTimestamp || toleranceMs !== undefined) {
    assertValidSalesforceWebhookTimestamp(headers, toleranceMs ?? 300_000, options.now);
  }

  const payload = parseSalesforceWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const objectType = extractSalesforceObjectType(payload);
  const objectId = extractSalesforceObjectId(payload);
  const action = extractSalesforceAction(payload);
  const eventType = `${objectType}.${action}`;
  const connection = extractSalesforceConnectionMetadata(payload, normalizedHeaders);

  const normalized: NormalizedWebhook = {
    provider: connection.provider,
    eventType,
    objectType,
    objectId,
    payload: buildNormalizedPayload(payload, connection, {
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

export function parseSalesforceWebhookPayload(rawPayload: unknown): SalesforceRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Salesforce webhook payload must be a JSON object or SOAP notification.');
  }
  return decoded;
}

export function extractSalesforceConnectionMetadata(
  payload: unknown,
  headers: SalesforceWebhookHeaders = {},
): SalesforceWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseSalesforceWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);

  const result: SalesforceWebhookConnectionMetadata = {
    provider:
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      SALESFORCE_PROVIDER,
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
    readOptionalString(normalizedHeaders[SALESFORCE_DELIVERY_ID_HEADER]) ??
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

  const organizationId =
    readOptionalString(normalizedHeaders[SALESFORCE_ORGANIZATION_ID_HEADER]) ??
    readOptionalString(record.organizationId) ??
    readOptionalString(record.organization_id) ??
    readOptionalString(metadata?.organizationId) ??
    readOptionalString(metadata?.organization_id) ??
    readOptionalString(webhook?.organizationId) ??
    readOptionalString(webhook?.organization_id);
  if (organizationId) {
    result.organizationId = organizationId;
  }

  const webhookTimestamp =
    readTimestamp(normalizedHeaders[SALESFORCE_WEBHOOK_TIMESTAMP_HEADER]) ??
    readTimestamp(record.timestamp) ??
    readTimestamp(record.webhookTimestamp) ??
    readTimestamp(record.webhook_timestamp) ??
    readTimestamp(metadata?.timestamp) ??
    readTimestamp(metadata?.webhookTimestamp) ??
    readTimestamp(webhook?.timestamp) ??
    readTimestamp(webhook?.webhookTimestamp);
  if (webhookTimestamp !== undefined) {
    result.webhookTimestamp = webhookTimestamp;
  }

  const secretDigest = readOptionalString(normalizedHeaders[SALESFORCE_WEBHOOK_SECRET_HEADER]);
  if (secretDigest) {
    result.secretDigest = secretDigest;
  }

  return result;
}

export function extractSalesforceObjectType(payload: unknown): string {
  const record = parseSalesforceWebhookPayload(payload);
  const data = getWebhookData(record);
  const attributes = getRecord(data?.attributes);
  const rawType =
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(record.type) ??
    readOptionalString(record.sobjectType) ??
    readOptionalString(record.sObjectType) ??
    readOptionalString(data?.objectType) ??
    readOptionalString(data?.type) ??
    readOptionalString(attributes?.type) ??
    readOptionalString(getRecord(record._webhook)?.objectType);

  if (!rawType) {
    throw new Error('Salesforce webhook payload is missing object type metadata.');
  }

  return normalizeSalesforceObjectType(rawType);
}

export function extractSalesforceObjectId(payload: unknown): string {
  const record = parseSalesforceWebhookPayload(payload);
  const data = getWebhookData(record);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);

  const objectId =
    readOptionalString(data?.Id) ??
    readOptionalString(data?.id) ??
    readOptionalString(record.objectId) ??
    readOptionalString(record.object_id) ??
    readOptionalString(record.Id) ??
    readOptionalString(record.id) ??
    readOptionalString(metadata?.objectId) ??
    readOptionalString(metadata?.object_id) ??
    readOptionalString(webhook?.objectId) ??
    readOptionalString(webhook?.object_id);

  if (!objectId) {
    throw new Error('Salesforce webhook payload is missing an object identifier.');
  }

  return objectId;
}

export function extractSalesforceAction(payload: unknown): string {
  const record = parseSalesforceWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const webhook = getRecord(record._webhook);
  const action = normalizeAction(
    readOptionalString(record.action) ??
    readOptionalString(record.eventAction) ??
    readOptionalString(record.event_action) ??
    readOptionalString(metadata?.action) ??
    readOptionalString(webhook?.action) ??
    'updated',
  );

  if (action === 'updated' || action === 'upserted') {
    return inferSalesforceLifecycleAction(record) ?? action;
  }

  return action;
}

/**
 * Salesforce Outbound Messages do not HMAC-sign the body — the
 * `X-SFDC-Webhook-Secret` header carries the literal shared secret value
 * configured on the Outbound Message. Transport integrity is provided by
 * org-level mTLS (see SALESFORCE_MTLS_DEPLOYMENT_NOTE). This function exists
 * only for callers that previously imported it; it now returns the raw
 * configured secret so the contract `header === computed` still holds.
 *
 * @deprecated Use the configured secret directly; HMAC computation does not
 * apply to Salesforce webhook verification.
 */
export function computeSalesforceWebhookSecret(_rawPayload: unknown, secret: string): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error('Salesforce webhook secret must be a non-empty string.');
  }
  return normalizedSecret;
}

export function validateSalesforceWebhookSecret(
  _rawPayload: unknown,
  headers: SalesforceWebhookHeaders,
  secret: string,
): SalesforceWebhookSignatureValidationResult {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedSecret = readOptionalString(normalizedHeaders[SALESFORCE_WEBHOOK_SECRET_HEADER]);
  if (!receivedSecret) {
    return { ok: false, reason: 'missing-secret-header' };
  }

  const expectedBuffer = Buffer.from(normalizedSecret, 'utf8');
  const headerBuffer = Buffer.from(receivedSecret, 'utf8');

  if (headerBuffer.length !== expectedBuffer.length) {
    return {
      ok: false,
      reason: 'invalid-secret',
      receivedSignature: receivedSecret,
    };
  }

  const ok = timingSafeEqual(expectedBuffer, headerBuffer);
  return {
    ok,
    ...(ok
      ? { receivedSignature: receivedSecret }
      : { reason: 'invalid-secret', receivedSignature: receivedSecret }),
  };
}

export function assertValidSalesforceWebhookSecret(
  rawPayload: unknown,
  headers: SalesforceWebhookHeaders,
  secret: string,
): void {
  const result = validateSalesforceWebhookSecret(rawPayload, headers, secret);
  if (!result.ok) {
    throw new Error(
      `Invalid Salesforce webhook secret${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function validateSalesforceWebhookTimestamp(
  headers: SalesforceWebhookHeaders,
  toleranceMs = 300_000,
  now = Date.now(),
): SalesforceWebhookTimestampValidationResult {
  const normalizedHeaders = normalizeHeaders(headers);
  const webhookTimestamp = readTimestamp(normalizedHeaders[SALESFORCE_WEBHOOK_TIMESTAMP_HEADER]);
  if (webhookTimestamp === undefined) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const driftMs = Math.abs(now - webhookTimestamp);
  if (driftMs > toleranceMs) {
    return { ok: false, reason: 'stale-timestamp', webhookTimestamp, driftMs };
  }

  return { ok: true, webhookTimestamp, driftMs };
}

export function assertValidSalesforceWebhookTimestamp(
  headers: SalesforceWebhookHeaders,
  toleranceMs = 300_000,
  now = Date.now(),
): void {
  const result = validateSalesforceWebhookTimestamp(headers, toleranceMs, now);
  if (!result.ok) {
    throw new Error(
      `Invalid Salesforce webhook timestamp${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

function buildNormalizedPayload(
  payload: SalesforceRecord,
  connection: SalesforceWebhookConnectionMetadata,
  normalized: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): SalesforceRecord {
  const existingConnection = getRecord(payload._connection);
  const existingWebhook = getRecord(payload._webhook);
  const data = getWebhookData(payload) ?? {};
  const normalizedPayload: SalesforceRecord = { ...data };

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
    deliveryId: connection.deliveryId,
    eventType: normalized.eventType,
    mTLS: 'required-at-deployment',
    objectId: normalized.objectId,
    objectType: normalized.objectType,
    organizationId: connection.organizationId,
    timestamp: connection.webhookTimestamp,
    webhookSecretHeader: SALESFORCE_WEBHOOK_SECRET_HEADER,
  });

  return normalizedPayload;
}

function decodeWebhookPayload(rawPayload: unknown): unknown {
  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (trimmed.startsWith('<')) {
      return parseSalesforceSoapNotification(trimmed);
    }
    return JSON.parse(trimmed);
  }

  if (Buffer.isBuffer(rawPayload)) {
    return decodeWebhookPayload(rawPayload.toString('utf8'));
  }

  if (rawPayload instanceof Uint8Array) {
    return decodeWebhookPayload(Buffer.from(rawPayload).toString('utf8'));
  }

  if (rawPayload instanceof ArrayBuffer) {
    return decodeWebhookPayload(Buffer.from(rawPayload).toString('utf8'));
  }

  return rawPayload;
}

function parseSalesforceSoapNotification(xml: string): SalesforceRecord {
  const notification = firstXmlBlock(xml, 'Notification') ?? xml;
  const sObject = firstXmlBlock(notification, 'sObject') ?? notification;
  const objectType =
    readXmlAttribute(sObject, 'type') ??
    readXmlAttribute(sObject, 'xsi:type') ??
    readXmlAttribute(sObject, 'sObjectType') ??
    'Account';
  const unprefixedType = objectType.includes(':') ? objectType.split(':').at(-1) ?? objectType : objectType;
  const data = parseSimpleXmlFields(sObject);

  if (!data.Id) {
    const notificationId = readXmlText(notification, 'Id');
    if (notificationId) {
      data.Id = notificationId;
    }
  }

  return compactObject({
    action: 'updated',
    objectType: unprefixedType,
    organizationId: readXmlText(xml, 'OrganizationId'),
    data,
  });
}

function parseSimpleXmlFields(xml: string): SalesforceRecord {
  const record: SalesforceRecord = {};
  const fieldXml = xml.replace(/^<[^>]+>/u, '').replace(/<\/[^>]+>\s*$/u, '');
  const fieldPattern = /<((?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/gu;
  for (const match of fieldXml.matchAll(fieldPattern)) {
    const rawName = match[1];
    const rawValue = match[2];
    if (!rawName || rawValue === undefined || rawValue.includes('<')) {
      continue;
    }
    const name = stripXmlPrefix(rawName);
    const value = decodeXmlEntities(rawValue.trim());
    if (name && value) {
      record[name] = value;
    }
  }
  return record;
}

function firstXmlBlock(xml: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<((?:[A-Za-z_][\\w.-]*:)?${tagName})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'u');
  return pattern.exec(xml)?.[0];
}

function readXmlText(xml: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${tagName}>`, 'u');
  const value = pattern.exec(xml)?.[1];
  return value ? decodeXmlEntities(value.trim()) : undefined;
}

function readXmlAttribute(xml: string, attributeName: string): string | undefined {
  const escaped = attributeName.replace(':', '(?::|:)');
  const pattern = new RegExp(`\\s${escaped}=["']([^"']+)["']`, 'u');
  const value = pattern.exec(xml)?.[1];
  return value ? decodeXmlEntities(value.trim()) : undefined;
}

function stripXmlPrefix(name: string): string {
  return name.includes(':') ? name.split(':').at(-1) ?? name : name;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function getWebhookData(record: SalesforceRecord): SalesforceRecord | undefined {
  return getRecord(record.data) ?? getRecord(record.sObject) ?? getRecord(record.sobject) ?? record;
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'create':
    case 'created':
    case 'insert':
    case 'inserted':
      return 'created';
    case 'delete':
    case 'deleted':
    case 'remove':
    case 'removed':
      return 'deleted';
    case 'upsert':
    case 'upserted':
      return 'upserted';
    case 'close':
    case 'closed':
      return 'closed';
    case 'convert':
    case 'converted':
      return 'converted';
    case 'update':
    case 'updated':
    default:
      return normalized || 'updated';
  }
}

function inferSalesforceLifecycleAction(record: SalesforceRecord): string | undefined {
  const objectType = extractSalesforceObjectType(record).toLowerCase();
  const data = getWebhookData(record);
  if (!data) return undefined;
  const changedFields = getChangedFields(data);

  if (
    objectType === 'lead' &&
    fieldChanged(changedFields, 'IsConverted') &&
    (data.IsConverted === true || data.isConverted === true)
  ) {
    return 'converted';
  }

  if (objectType === 'case') {
    const status = readOptionalString(data.Status) ?? readOptionalString(data.status);
    if (
      (fieldChanged(changedFields, 'IsClosed') && (data.IsClosed === true || data.isClosed === true)) ||
      (fieldChanged(changedFields, 'Status') && isSalesforceClosedValue(status))
    ) {
      return 'closed';
    }
  }

  if (objectType === 'opportunity') {
    const stage = readOptionalString(data.StageName) ?? readOptionalString(data.stageName);
    if (
      (fieldChanged(changedFields, 'IsClosed') && (data.IsClosed === true || data.isClosed === true)) ||
      (fieldChanged(changedFields, 'StageName') && isSalesforceClosedValue(stage))
    ) {
      return 'closed';
    }
  }

  return undefined;
}

function getChangedFields(data: SalesforceRecord): Set<string> {
  const header = getRecord(data.ChangeEventHeader) ?? getRecord(data.changeEventHeader);
  const raw = header?.changedFields;
  if (!Array.isArray(raw)) {
    return new Set();
  }
  return new Set(
    raw
      .map((field) => readOptionalString(field))
      .filter((field): field is string => Boolean(field)),
  );
}

function fieldChanged(changedFields: Set<string>, field: string): boolean {
  const lowerFirst = field ? field.charAt(0).toLowerCase() + field.slice(1) : field;
  return changedFields.has(field) || changedFields.has(lowerFirst);
}

function isSalesforceClosedValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized === 'closed' || normalized === 'closed won' || normalized === 'closed lost' || normalized === 'converted';
}

function normalizeHeaders(headers: SalesforceWebhookHeaders): Record<string, string> {
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
    return value.map((entry) => String(entry).trim()).filter(Boolean).join(',');
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return readOptionalString(value);
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

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readTimestamp(value: unknown): number | undefined {
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
    const dateMs = Date.parse(trimmed);
    return Number.isFinite(dateMs) ? dateMs : undefined;
  }
  return undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as T;
}
