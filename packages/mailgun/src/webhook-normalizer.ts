import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './mailgun-adapter.js';

export const MAILGUN_PROVIDER = 'mailgun';
export const MAILGUN_SIGNATURE_HEADER = 'x-mailgun-signature';
export const MAILGUN_TIMESTAMP_HEADER = 'x-mailgun-timestamp';
export const MAILGUN_TOKEN_HEADER = 'x-mailgun-token';
export const MAILGUN_EVENT_HEADER = 'x-mailgun-event';
export const MAILGUN_DOMAIN_HEADER = 'x-mailgun-domain';
export const MAILGUN_DELIVERY_HEADER = 'x-mailgun-delivery';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-mailgun-connection-id',
  'mailgun-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-mailgun-provider',
  'mailgun-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-mailgun-provider-config-key',
  'mailgun-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;

const DEFAULT_TIMESTAMP_TOLERANCE_MS = 15 * 60 * 1000;

type MailgunRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type MailgunWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface MailgunWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  domain?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  token?: string;
  webhookTimestamp?: number;
}

export interface MailgunWebhookSignatureParts {
  signature: string;
  timestamp: string;
  token: string;
}

export interface MailgunWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?:
    | 'invalid-signature'
    | 'malformed-signature'
    | 'missing-api-key'
    | 'missing-header'
    | 'missing-signature'
    | 'missing-timestamp'
    | 'missing-token';
  receivedSignature?: string;
}

export interface MailgunWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

export function normalizeMailgunWebhook(
  rawPayload: unknown,
  headers: MailgunWebhookHeaders = {},
): NormalizedWebhook {
  const payload = parseMailgunWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const data = extractMailgunEventData(payload);
  const objectType = extractMailgunObjectType(payload, data, normalizedHeaders);
  const action = extractMailgunAction(payload, data, normalizedHeaders, objectType);
  const objectId = extractMailgunObjectId(payload, data, objectType);
  const eventType = `${objectType}.${action}`;
  const connection = extractMailgunConnectionMetadata(payload, normalizedHeaders);

  const normalized: NormalizedWebhook = {
    provider: connection.provider,
    eventType,
    objectType,
    objectId,
    payload: buildNormalizedPayload(payload, data, normalizedHeaders, connection, {
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

export function parseMailgunWebhookPayload(rawPayload: unknown): MailgunRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Mailgun webhook payload must be a JSON object.');
  }
  return decoded;
}

export function validateMailgunWebhookSignature(
  rawPayload: unknown,
  headers: MailgunWebhookHeaders,
  apiKey: string | undefined,
): MailgunWebhookSignatureValidationResult {
  const secret = apiKey?.trim();
  if (!secret) {
    return { ok: false, reason: 'missing-api-key' };
  }

  let payload: MailgunRecord;
  try {
    payload = parseMailgunWebhookPayload(rawPayload);
  } catch {
    return { ok: false, reason: 'missing-signature' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const parts = extractSignatureParts(payload, normalizedHeaders);
  if (!parts.signature) {
    return { ok: false, reason: parts.source === 'headers' ? 'missing-header' : 'missing-signature' };
  }
  if (!parts.timestamp) {
    return { ok: false, reason: 'missing-timestamp' };
  }
  if (!parts.token) {
    return { ok: false, reason: 'missing-token' };
  }

  const receivedSignature = parts.signature.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(receivedSignature)) {
    return {
      ok: false,
      reason: 'malformed-signature',
      receivedSignature: parts.signature,
    };
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${parts.timestamp}${parts.token}`)
    .digest('hex');

  const expected = Buffer.from(expectedSignature, 'hex');
  const received = Buffer.from(receivedSignature, 'hex');
  const ok = expected.length === received.length && timingSafeEqual(expected, received);
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

export function assertValidMailgunWebhookSignature(
  rawPayload: unknown,
  headers: MailgunWebhookHeaders,
  apiKey: string | undefined,
): void {
  const result = validateMailgunWebhookSignature(rawPayload, headers, apiKey);
  if (!result.ok) {
    throw new Error(`Invalid Mailgun webhook signature: ${result.reason ?? 'unknown'}`);
  }
}

export function validateMailgunWebhookTimestamp(
  rawPayload: unknown,
  toleranceMs = DEFAULT_TIMESTAMP_TOLERANCE_MS,
  nowMs = Date.now(),
): MailgunWebhookTimestampValidationResult {
  const payload = parseMailgunWebhookPayload(rawPayload);
  const signature = getRecord(payload.signature);
  const timestamp =
    readOptionalTimestamp(signature?.timestamp) ??
    readOptionalTimestamp(payload.timestamp) ??
    readOptionalTimestamp(extractMailgunEventData(payload).timestamp);

  if (timestamp === undefined) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const driftMs = Math.abs(nowMs - timestamp);
  if (driftMs > toleranceMs) {
    return {
      driftMs,
      ok: false,
      reason: 'stale-timestamp',
      webhookTimestamp: timestamp,
    };
  }

  return {
    driftMs,
    ok: true,
    webhookTimestamp: timestamp,
  };
}

export function extractMailgunConnectionMetadata(
  payload: unknown,
  headers: MailgunWebhookHeaders = {},
): MailgunWebhookConnectionMetadata {
  const record = parseMailgunWebhookPayload(payload);
  const normalizedHeaders = normalizeHeaders(headers);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const signature = getRecord(record.signature);
  const data = extractMailgunEventData(record);

  const result: MailgunWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      MAILGUN_PROVIDER,
  };

  const connectionId =
    readHeaderValue(normalizedHeaders, CONNECTION_ID_HEADER_KEYS) ??
    readOptionalString(record.connectionId) ??
    readOptionalString(record.connection_id) ??
    readOptionalString(metadata?.connectionId) ??
    readOptionalString(metadata?.connection_id) ??
    readOptionalString(connection?.id);
  if (connectionId) {
    result.connectionId = connectionId;
  }

  const providerConfigKey =
    readHeaderValue(normalizedHeaders, PROVIDER_CONFIG_KEY_HEADER_KEYS) ??
    readOptionalString(record.providerConfigKey) ??
    readOptionalString(record.provider_config_key) ??
    readOptionalString(metadata?.providerConfigKey) ??
    readOptionalString(metadata?.provider_config_key);
  if (providerConfigKey) {
    result.providerConfigKey = providerConfigKey;
  }

  const deliveryId =
    readOptionalString(normalizedHeaders[MAILGUN_DELIVERY_HEADER]) ??
    readOptionalString(record.deliveryId) ??
    readOptionalString(record.delivery_id) ??
    readOptionalString(metadata?.deliveryId) ??
    readOptionalString(metadata?.delivery_id);
  if (deliveryId) {
    result.deliveryId = deliveryId;
  }

  const domain =
    readOptionalString(normalizedHeaders[MAILGUN_DOMAIN_HEADER]) ??
    readOptionalString(record.domain) ??
    readOptionalString(data.domain) ??
    readOptionalString(metadata?.domain);
  if (domain) {
    result.domain = domain;
  }

  const requestId =
    readHeaderValue(normalizedHeaders, REQUEST_ID_HEADER_KEYS) ??
    readOptionalString(record.requestId) ??
    readOptionalString(record.request_id) ??
    readOptionalString(metadata?.requestId) ??
    readOptionalString(metadata?.request_id);
  if (requestId) {
    result.requestId = requestId;
  }

  const signatureValue =
    readOptionalString(signature?.signature) ??
    readOptionalString(normalizedHeaders[MAILGUN_SIGNATURE_HEADER]);
  if (signatureValue) {
    result.signature = signatureValue;
  }

  const token =
    readOptionalString(signature?.token) ??
    readOptionalString(normalizedHeaders[MAILGUN_TOKEN_HEADER]);
  if (token) {
    result.token = token;
  }

  const webhookTimestamp =
    readOptionalTimestamp(signature?.timestamp) ??
    readOptionalTimestamp(normalizedHeaders[MAILGUN_TIMESTAMP_HEADER]) ??
    readOptionalTimestamp(record.timestamp) ??
    readOptionalTimestamp(data.timestamp);
  if (webhookTimestamp !== undefined) {
    result.webhookTimestamp = webhookTimestamp;
  }

  return result;
}

export function extractMailgunEventData(payload: unknown): MailgunRecord {
  const record = parseMailgunWebhookPayload(payload);
  const data = record['event-data'] ?? record.eventData ?? record.data;
  if (isRecord(data)) {
    return data;
  }
  if (isRecord(record.message)) {
    return record.message;
  }
  return record;
}

export function extractMailgunObjectType(
  payload: unknown,
  data = extractMailgunEventData(payload),
  headers: MailgunWebhookHeaders = {},
): 'event' | 'list' | 'message' {
  const record = parseMailgunWebhookPayload(payload);
  const normalizedHeaders = normalizeHeaders(headers);
  const explicit =
    readOptionalString(record.objectType) ??
    readOptionalString(record.type) ??
    readOptionalString(data.objectType) ??
    readOptionalString(data.type) ??
    readOptionalString(normalizedHeaders[MAILGUN_EVENT_HEADER]);
  if (explicit) {
    const normalized = tryNormalizeObjectType(explicit);
    if (normalized) return normalized;
  }

  if (readOptionalString(data.address) && !readOptionalString(data.recipient)) {
    return 'list';
  }
  if (readOptionalString(data.event) || isRecord(record['event-data']) || isRecord(record.eventData)) {
    return 'event';
  }
  return 'message';
}

export function extractMailgunAction(
  payload: unknown,
  data = extractMailgunEventData(payload),
  headers: MailgunWebhookHeaders = {},
  objectType = extractMailgunObjectType(payload, data, headers),
): string {
  const record = parseMailgunWebhookPayload(payload);
  const normalizedHeaders = normalizeHeaders(headers);
  const explicit =
    readOptionalString(data.event) ??
    readOptionalString(record.event) ??
    readOptionalString(record.action) ??
    readOptionalString(data.action) ??
    readOptionalString(normalizedHeaders[MAILGUN_EVENT_HEADER]);
  if (explicit) {
    return normalizeAction(explicit);
  }
  if (objectType === 'list') return 'updated';
  return 'stored';
}

export function extractMailgunObjectId(
  payload: unknown,
  data = extractMailgunEventData(payload),
  objectType = extractMailgunObjectType(payload, data),
): string {
  const record = parseMailgunWebhookPayload(payload);
  const direct =
    readOptionalString(data.id) ??
    readOptionalString(data.messageId) ??
    readOptionalString(data.message_id) ??
    readOptionalString(data['Message-Id']) ??
    readOptionalString(data['message-id']) ??
    readOptionalString(record.id);
  if (direct) return direct;

  if (objectType === 'list') {
    const address = readOptionalString(data.address) ?? readOptionalString(record.address);
    if (address) return address;
  }

  if (objectType === 'event') {
    const message = getRecord(data.message);
    const messageId = message
      ? readOptionalString(message.id) ??
        readOptionalString(message.messageId) ??
        readOptionalString(message.message_id)
      : undefined;
    const synthetic = [
      readOptionalString(data.event),
      messageId,
      readOptionalString(data.recipient) ?? readOptionalString(record.recipient),
      readOptionalString(data.timestamp) ?? readOptionalString(record.timestamp),
    ]
      .filter((part): part is string => Boolean(part))
      .join(':');
    if (synthetic) return synthetic;
  }

  throw new Error(`Mailgun ${objectType} webhook is missing object id`);
}

function buildNormalizedPayload(
  payload: MailgunRecord,
  data: MailgunRecord,
  headers: Record<string, string>,
  connection: MailgunWebhookConnectionMetadata,
  webhook: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    ...data,
  };

  if (connection.domain && !readOptionalString(normalized.domain)) {
    normalized.domain = connection.domain;
  }

  const connectionPayload: Record<string, unknown> = {
    provider: connection.provider,
  };
  addDefined(connectionPayload, 'connectionId', connection.connectionId);
  addDefined(connectionPayload, 'deliveryId', connection.deliveryId);
  addDefined(connectionPayload, 'domain', connection.domain);
  addDefined(connectionPayload, 'providerConfigKey', connection.providerConfigKey);
  addDefined(connectionPayload, 'requestId', connection.requestId);
  normalized._connection = connectionPayload;

  const webhookPayload: Record<string, unknown> = {
    action: webhook.action,
    eventType: webhook.eventType,
    objectId: webhook.objectId,
    objectType: webhook.objectType,
  };
  addDefined(webhookPayload, 'signature', connection.signature);
  addDefined(webhookPayload, 'timestamp', connection.webhookTimestamp);
  addDefined(webhookPayload, 'token', connection.token);
  addDefined(webhookPayload, 'rawEvent', readOptionalString(payload.event));
  addDefined(webhookPayload, 'deliveryId', connection.deliveryId);
  normalized._webhook = webhookPayload;

  const headerSnapshot = snapshotRelayHeaders(headers);
  if (Object.keys(headerSnapshot).length > 0) {
    normalized._headers = headerSnapshot;
  }

  return normalized;
}

function extractSignatureParts(
  payload: MailgunRecord,
  headers: Record<string, string>,
): {
  signature?: string;
  source: 'headers' | 'payload';
  timestamp?: string;
  token?: string;
} {
  const signaturePayload = getRecord(payload.signature);
  const payloadSignature = readOptionalString(signaturePayload?.signature);
  const payloadTimestamp = readOptionalString(signaturePayload?.timestamp);
  const payloadToken = readOptionalString(signaturePayload?.token);
  if (payloadSignature || payloadTimestamp || payloadToken) {
    const parts: {
      signature?: string;
      source: 'headers' | 'payload';
      timestamp?: string;
      token?: string;
    } = {
      source: 'payload',
    };
    addOptionalString(parts, 'signature', payloadSignature);
    addOptionalString(parts, 'timestamp', payloadTimestamp);
    addOptionalString(parts, 'token', payloadToken);
    return parts;
  }

  const parts: {
    signature?: string;
    source: 'headers' | 'payload';
    timestamp?: string;
    token?: string;
  } = {
    source: 'headers',
  };
  addOptionalString(parts, 'signature', readOptionalString(headers[MAILGUN_SIGNATURE_HEADER]));
  addOptionalString(parts, 'timestamp', readOptionalString(headers[MAILGUN_TIMESTAMP_HEADER]));
  addOptionalString(parts, 'token', readOptionalString(headers[MAILGUN_TOKEN_HEADER]));
  return parts;
}

function snapshotRelayHeaders(headers: Record<string, string>): Record<string, string> {
  const selected = [
    MAILGUN_DELIVERY_HEADER,
    MAILGUN_DOMAIN_HEADER,
    MAILGUN_EVENT_HEADER,
    'x-relay-connection-id',
    'x-relay-provider-config-key',
    'x-request-id',
  ];
  const snapshot: Record<string, string> = {};
  for (const key of selected) {
    const value = headers[key];
    if (value) snapshot[key] = value;
  }
  return snapshot;
}

function normalizeAction(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (normalized === 'permanent_failure') return 'permanent_fail';
  return normalized || 'stored';
}

function tryNormalizeObjectType(value: string): 'event' | 'list' | 'message' | undefined {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  switch (normalized) {
    case 'email':
    case 'mailgunmessage':
    case 'message':
    case 'messages':
      return 'message';
    case 'event':
    case 'events':
    case 'mailgunevent':
      return 'event';
    case 'list':
    case 'lists':
    case 'mailgunlist':
    case 'mailinglist':
    case 'mailinglists':
      return 'list';
    default:
      return undefined;
  }
}

function decodeWebhookPayload(rawPayload: unknown): unknown {
  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (!trimmed) {
      throw new Error('Mailgun webhook payload must not be empty.');
    }
    return JSON.parse(trimmed) as unknown;
  }
  if (rawPayload instanceof Uint8Array) {
    return JSON.parse(Buffer.from(rawPayload).toString('utf8')) as unknown;
  }
  return rawPayload;
}

function normalizeHeaders(headers: MailgunWebhookHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (isHeadersLike(headers)) {
    headers.forEach((value, key) => {
      normalized[key.toLowerCase()] = value;
    });
    return normalized;
  }

  if (isIterableHeaders(headers)) {
    for (const [key, value] of headers) {
      normalized[String(key).toLowerCase()] = String(value);
    }
    return normalized;
  }

  for (const [key, value] of Object.entries(headers)) {
    const normalizedValue = normalizeHeaderValue(value);
    if (normalizedValue !== undefined) {
      normalized[key.toLowerCase()] = normalizedValue;
    }
  }
  return normalized;
}

function isHeadersLike(headers: MailgunWebhookHeaders): headers is Headers {
  return typeof Headers !== 'undefined' && headers instanceof Headers;
}

function isIterableHeaders(headers: MailgunWebhookHeaders): headers is Iterable<readonly [string, string]> {
  return typeof (headers as Iterable<readonly [string, string]>)[Symbol.iterator] === 'function' &&
    !Array.isArray(headers) &&
    !isRecord(headers);
}

function normalizeHeaderValue(value: HeaderValue): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const joined = value.map((item) => String(item).trim()).filter(Boolean).join(', ');
    return joined || undefined;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim() || undefined;
}

function readHeaderValue(
  headers: Record<string, string>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = readOptionalString(headers[key]);
    if (value) return value;
  }
  return undefined;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeTimestampNumber(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return normalizeTimestampNumber(numeric);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeTimestampNumber(value: number): number {
  return value < 10_000_000_000 ? value * 1000 : value;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function addDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
}

function addOptionalString(
  target: Record<string, unknown>,
  key: string,
  value: string | undefined,
): void {
  if (value) {
    target[key] = value;
  }
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
