import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './calendly-adapter.js';
import { normalizeCalendlyObjectType, type CalendlyPathObjectType } from './path-mapper.js';

export const CALENDLY_PROVIDER = 'calendly';
export const CALENDLY_SIGNATURE_HEADER = 'calendly-webhook-signature';
export const DEFAULT_CALENDLY_WEBHOOK_TOLERANCE_MS = 3 * 60 * 1000;

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-calendly-connection-id',
  'calendly-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-calendly-provider',
  'calendly-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-calendly-provider-config-key',
  'calendly-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;
const DELIVERY_ID_HEADER_KEYS = ['x-calendly-delivery', 'calendly-delivery', 'x-webhook-delivery'] as const;

type CalendlyRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type CalendlyWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface CalendlyWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  webhookTimestamp?: number;
}

export interface CalendlySignatureHeader {
  signature: string;
  timestamp: number;
  timestampMs: number;
}

export interface CalendlyWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?:
    | 'expired-timestamp'
    | 'invalid-signature'
    | 'malformed-signature'
    | 'missing-secret'
    | 'missing-signature';
  receivedSignature?: string;
  timestamp?: number;
  timestampMs?: number;
}

export interface NormalizeCalendlyWebhookOptions {
  nowMs?: number;
  toleranceMs?: number;
  webhookSecret?: string;
}

export function normalizeCalendlyWebhook(
  rawPayload: unknown,
  headers: CalendlyWebhookHeaders = {},
  options: NormalizeCalendlyWebhookOptions = {},
): NormalizedWebhook {
  const normalizedHeaders = normalizeHeaders(headers);
  if (options.webhookSecret !== undefined) {
    const signatureOptions: Pick<NormalizeCalendlyWebhookOptions, 'nowMs' | 'toleranceMs'> = {};
    if (options.nowMs !== undefined) {
      signatureOptions.nowMs = options.nowMs;
    }
    if (options.toleranceMs !== undefined) {
      signatureOptions.toleranceMs = options.toleranceMs;
    }
    assertValidCalendlyWebhookSignature(rawPayload, normalizedHeaders, options.webhookSecret, signatureOptions);
  }

  const payload = parseCalendlyWebhookPayload(rawPayload);
  const embeddedPayload = getRecord(payload.payload) ?? payload;
  const objectType = extractCalendlyObjectType(payload, embeddedPayload);
  const objectId = extractCalendlyObjectId(embeddedPayload);
  const action = extractCalendlyAction(payload);
  const eventType = `${objectType}.${action}`;
  const connection = extractCalendlyConnectionMetadata(payload, normalizedHeaders);

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

export function validateCalendlyWebhookSignature(
  rawPayload: unknown,
  headers: CalendlyWebhookHeaders = {},
  webhookSecret?: string,
  options: Pick<NormalizeCalendlyWebhookOptions, 'nowMs' | 'toleranceMs'> = {},
): CalendlyWebhookSignatureValidationResult {
  const secret = webhookSecret?.trim();
  if (!secret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const receivedHeader = readOptionalString(normalizedHeaders[CALENDLY_SIGNATURE_HEADER]);
  if (!receivedHeader) {
    return { ok: false, reason: 'missing-signature' };
  }

  const parsed = parseCalendlySignatureHeader(receivedHeader);
  if (!parsed) {
    return {
      ok: false,
      reason: 'malformed-signature',
      receivedSignature: receivedHeader,
    };
  }

  const nowMs = options.nowMs ?? Date.now();
  const toleranceMs = options.toleranceMs ?? DEFAULT_CALENDLY_WEBHOOK_TOLERANCE_MS;
  if (Math.abs(nowMs - parsed.timestampMs) > toleranceMs) {
    return {
      ok: false,
      reason: 'expired-timestamp',
      receivedSignature: parsed.signature,
      timestamp: parsed.timestamp,
      timestampMs: parsed.timestampMs,
    };
  }

  if (!/^[0-9a-f]{64}$/u.test(parsed.signature)) {
    return {
      ok: false,
      reason: 'malformed-signature',
      receivedSignature: parsed.signature,
      timestamp: parsed.timestamp,
      timestampMs: parsed.timestampMs,
    };
  }

  const body = rawPayloadToString(rawPayload);
  const signedPayload = `${parsed.timestamp}.${body}`;
  const expectedSignature = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const receivedBuffer = Buffer.from(parsed.signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const ok = receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);

  if (!ok) {
    return {
      expectedSignature,
      ok: false,
      reason: 'invalid-signature',
      receivedSignature: parsed.signature,
      timestamp: parsed.timestamp,
      timestampMs: parsed.timestampMs,
    };
  }

  return {
    expectedSignature,
    ok: true,
    receivedSignature: parsed.signature,
    timestamp: parsed.timestamp,
    timestampMs: parsed.timestampMs,
  };
}

export function assertValidCalendlyWebhookSignature(
  rawPayload: unknown,
  headers: CalendlyWebhookHeaders = {},
  webhookSecret?: string,
  options: Pick<NormalizeCalendlyWebhookOptions, 'nowMs' | 'toleranceMs'> = {},
): void {
  const result = validateCalendlyWebhookSignature(rawPayload, headers, webhookSecret, options);
  if (!result.ok) {
    throw new Error(`Invalid Calendly webhook signature: ${result.reason}`);
  }
}

export function parseCalendlySignatureHeader(headerValue: string): CalendlySignatureHeader | undefined {
  const parts = headerValue.split(',').map((part) => part.trim());
  let timestamp: number | undefined;
  let signature: string | undefined;

  for (const part of parts) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key === 't') {
      const parsedTimestamp = Number(value);
      if (Number.isFinite(parsedTimestamp) && parsedTimestamp > 0) {
        timestamp = parsedTimestamp;
      }
    }
    if (key === 'v1' && value) {
      signature = value.toLowerCase();
    }
  }

  if (timestamp === undefined || !signature) {
    return undefined;
  }

  return {
    signature,
    timestamp,
    timestampMs: timestampToMilliseconds(timestamp),
  };
}

export function parseCalendlyWebhookPayload(rawPayload: unknown): CalendlyRecord {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Calendly webhook payload must be a JSON object.');
  }
  return decoded;
}

export function extractCalendlyConnectionMetadata(
  payload: unknown,
  headers: CalendlyWebhookHeaders = {},
): CalendlyWebhookConnectionMetadata {
  const normalizedHeaders = normalizeHeaders(headers);
  const record = parseCalendlyWebhookPayload(payload);
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);
  const webhook = getRecord(record._webhook);
  const parsedSignature = readOptionalString(normalizedHeaders[CALENDLY_SIGNATURE_HEADER]);
  const parsedHeader = parsedSignature ? parseCalendlySignatureHeader(parsedSignature) : undefined;

  const result: CalendlyWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      CALENDLY_PROVIDER,
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
    readOptionalString(normalizedConnection?.requestId) ??
    readOptionalString(normalizedConnection?.request_id);
  if (requestId) {
    result.requestId = requestId;
  }

  if (parsedSignature) {
    result.signature = parsedSignature;
  }
  if (parsedHeader) {
    result.webhookTimestamp = parsedHeader.timestampMs;
  }

  return result;
}

function extractCalendlyObjectType(
  envelope: CalendlyRecord,
  payload: CalendlyRecord,
): CalendlyPathObjectType {
  const explicitType =
    readOptionalString(envelope.objectType) ??
    readOptionalString(envelope.object_type) ??
    readOptionalString(payload.objectType) ??
    readOptionalString(payload.object_type);
  if (explicitType) {
    return normalizeCalendlyObjectType(explicitType);
  }

  const event = readOptionalString(envelope.event);
  if (event) {
    const prefix = event.split('.')[0];
    if (prefix) {
      return normalizeCalendlyObjectType(prefix);
    }
  }

  if (payload.event_type !== undefined && (payload.start_time !== undefined || payload.end_time !== undefined)) {
    return 'scheduled_event';
  }
  if (payload.email !== undefined && payload.event !== undefined) {
    return 'invitee';
  }
  if (payload.duration !== undefined || payload.scheduling_url !== undefined) {
    return 'event_type';
  }

  throw new Error('Calendly webhook payload is missing object type');
}

function extractCalendlyObjectId(payload: CalendlyRecord): string {
  const direct =
    readOptionalString(payload.uuid) ??
    readOptionalString(payload.id) ??
    readOptionalString(payload.objectId) ??
    readOptionalString(payload.object_id);
  if (direct) {
    return direct;
  }

  const uri = readOptionalString(payload.uri);
  if (uri) {
    const idFromUri = extractLastUriSegment(uri);
    if (idFromUri) {
      return idFromUri;
    }
  }

  throw new Error('Calendly webhook payload is missing object id');
}

function extractCalendlyAction(envelope: CalendlyRecord): string {
  const explicitAction =
    readOptionalString(envelope.action) ??
    readOptionalString(envelope.eventAction) ??
    readOptionalString(envelope.event_action);
  if (explicitAction) {
    return normalizeAction(explicitAction);
  }

  const event = readOptionalString(envelope.event);
  if (event) {
    const parts = event.split('.');
    const suffix = parts.at(-1);
    if (suffix) {
      return normalizeAction(suffix);
    }
  }

  return 'updated';
}

function buildNormalizedPayload(
  payload: CalendlyRecord,
  headers: Record<string, string>,
  connection: CalendlyWebhookConnectionMetadata,
  webhook: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): CalendlyRecord {
  const innerPayload = getRecord(payload.payload);
  const base = innerPayload ? { ...innerPayload } : { ...payload };

  const connectionPayload: CalendlyRecord = {
    provider: connection.provider,
  };
  if (connection.connectionId) connectionPayload.connectionId = connection.connectionId;
  if (connection.deliveryId) connectionPayload.deliveryId = connection.deliveryId;
  if (connection.providerConfigKey) connectionPayload.providerConfigKey = connection.providerConfigKey;
  if (connection.requestId) connectionPayload.requestId = connection.requestId;

  const webhookPayload: CalendlyRecord = {
    action: webhook.action,
    eventType: webhook.eventType,
    objectId: webhook.objectId,
    objectType: webhook.objectType,
  };
  addStringProperty(webhookPayload, 'createdAt', payload.created_at);
  if (connection.deliveryId) webhookPayload.deliveryId = connection.deliveryId;
  if (connection.signature) webhookPayload.signature = connection.signature;
  if (connection.webhookTimestamp !== undefined) webhookPayload.timestamp = String(connection.webhookTimestamp);

  return {
    ...base,
    _connection: connectionPayload,
    _headers: pickHeaders(headers, [
      CALENDLY_SIGNATURE_HEADER,
      'x-calendly-delivery',
      'x-relay-connection-id',
      'x-relay-provider-config-key',
      'x-request-id',
    ]),
    _webhook: webhookPayload,
  };
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  if (normalized === 'create') return 'created';
  if (normalized === 'update') return 'updated';
  if (normalized === 'cancel') return 'canceled';
  if (normalized === 'delete') return 'deleted';
  return normalized;
}

function timestampToMilliseconds(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function extractLastUriSegment(uri: string): string | undefined {
  const parts = uri.split('/').map((part) => part.trim()).filter((part) => part.length > 0);
  return parts.at(-1);
}

function decodeWebhookPayload(rawPayload: unknown): unknown {
  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    if (!trimmed) {
      throw new Error('Calendly webhook payload is empty.');
    }
    return JSON.parse(trimmed) as unknown;
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
  if (rawPayload instanceof Uint8Array) {
    return Buffer.from(rawPayload).toString('utf8');
  }
  return JSON.stringify(rawPayload);
}

function normalizeHeaders(headers: CalendlyWebhookHeaders): Record<string, string> {
  const result: Record<string, string> = {};

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value;
    });
    return result;
  }

  if (isIterableHeaders(headers)) {
    for (const [key, value] of headers) {
      result[key.toLowerCase()] = value;
    }
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    const normalized = normalizeHeaderValue(value);
    if (normalized !== undefined) {
      result[key.toLowerCase()] = normalized;
    }
  }

  return result;
}

function isIterableHeaders(value: CalendlyWebhookHeaders): value is Iterable<readonly [string, string]> {
  return typeof value !== 'object' || value === null
    ? false
    : Symbol.iterator in value && !(typeof Headers !== 'undefined' && value instanceof Headers);
}

function normalizeHeaderValue(value: HeaderValue): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.join(',');
  }
  return String(value);
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

function pickHeaders(headers: Record<string, string>, keys: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = headers[key.toLowerCase()];
    if (value !== undefined) {
      result[key.toLowerCase()] = value;
    }
  }
  return result;
}

function addStringProperty(target: CalendlyRecord, key: string, value: unknown): void {
  const stringValue = readOptionalString(value);
  if (stringValue) {
    target[key] = stringValue;
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getRecord(value: unknown): CalendlyRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is CalendlyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
