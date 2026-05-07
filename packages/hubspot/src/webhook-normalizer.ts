import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './hubspot-adapter.js';
import type { HubSpotObjectType, HubSpotWebhookPayload } from './types.js';

export const HUBSPOT_PROVIDER = 'hubspot';
export const HUBSPOT_SIGNATURE_V3_HEADER = 'x-hubspot-signature-v3';
export const HUBSPOT_REQUEST_TIMESTAMP_HEADER = 'x-hubspot-request-timestamp';
export const HUBSPOT_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-hubspot-connection-id',
  'hubspot-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-hubspot-provider',
  'hubspot-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-hubspot-provider-config-key',
  'hubspot-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;

const OBJECT_TYPE_ALIASES: Readonly<Record<string, HubSpotObjectType>> = {
  company: 'company',
  companycreation: 'company',
  companydeletion: 'company',
  companypropertychange: 'company',
  companies: 'company',
  contact: 'contact',
  contactcreation: 'contact',
  contactdeletion: 'contact',
  contactpropertychange: 'contact',
  contacts: 'contact',
  deal: 'deal',
  dealcreation: 'deal',
  dealdeletion: 'deal',
  dealpropertychange: 'deal',
  deals: 'deal',
  ticket: 'ticket',
  ticketcreation: 'ticket',
  ticketdeletion: 'ticket',
  ticketpropertychange: 'ticket',
  tickets: 'ticket',
};

type HeaderValue = boolean | number | readonly string[] | string | null | undefined;
type HeaderMap = Record<string, string>;
type HubSpotRecord = Record<string, unknown>;

export type HubSpotWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface HubSpotWebhookConnectionMetadata {
  connectionId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  timestamp?: number;
}

export interface HubSpotWebhookSignatureValidationInput {
  body: Buffer | string;
  clientSecret: string;
  headers: HubSpotWebhookHeaders;
  nowMs?: number;
  requestMethod: string;
  requestUri: string;
  toleranceMs?: number;
}

export interface HubSpotWebhookSignatureValidationResult {
  expectedSignature?: string;
  ok: boolean;
  reason?:
    | 'expired-timestamp'
    | 'invalid-signature'
    | 'malformed-signature'
    | 'missing-secret'
    | 'missing-signature'
    | 'missing-timestamp';
  receivedSignature?: string;
  timestamp?: number;
}

interface NormalizationHints {
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
}

export function normalizeHubSpotWebhook(
  rawPayload: unknown,
  headers: HubSpotWebhookHeaders = {},
  hints: NormalizationHints = {},
): NormalizedWebhook {
  const payloads = parseHubSpotWebhookPayloads(rawPayload);
  const [first] = payloads;
  if (!first) {
    throw new Error('HubSpot webhook payload must contain at least one event.');
  }
  return normalizeHubSpotWebhookEvent(first, headers, hints);
}

export function normalizeHubSpotWebhookBatch(
  rawPayload: unknown,
  headers: HubSpotWebhookHeaders = {},
  hints: NormalizationHints = {},
): NormalizedWebhook[] {
  return parseHubSpotWebhookPayloads(rawPayload).map((payload) =>
    normalizeHubSpotWebhookEvent(payload, headers, hints),
  );
}

export function normalizeHubSpotWebhookEvent(
  payload: HubSpotWebhookPayload,
  headers: HubSpotWebhookHeaders = {},
  hints: NormalizationHints = {},
): NormalizedWebhook {
  const normalizedHeaders = normalizeHeaders(headers);
  const metadata = extractHubSpotConnectionMetadata(payload, normalizedHeaders, hints);
  const objectType = extractHubSpotObjectType(payload);
  const objectId = String(payload.objectId).trim();
  if (!objectId) {
    throw new Error('HubSpot webhook event is missing objectId.');
  }
  const eventType = extractHubSpotEventType(payload, objectType);
  const normalized: NormalizedWebhook = {
    eventType,
    objectId,
    objectType,
    payload: buildNormalizedPayload(payload, normalizedHeaders, metadata, {
      eventType,
      objectId,
      objectType,
    }),
    provider: metadata.provider,
  };
  if (metadata.connectionId) {
    normalized.connectionId = metadata.connectionId;
  }
  return normalized;
}

export function parseHubSpotWebhookPayloads(rawPayload: unknown): HubSpotWebhookPayload[] {
  const decoded = decodeWebhookPayload(rawPayload);
  const payloads = Array.isArray(decoded) ? decoded : [decoded];
  return payloads.map((payload) => {
    if (!isRecord(payload)) {
      throw new Error('HubSpot webhook payload entries must be JSON objects.');
    }
    if (payload.objectId === undefined || payload.objectId === null) {
      throw new Error('HubSpot webhook payload entry is missing objectId.');
    }
    if (!readOptionalString(payload.subscriptionType)) {
      throw new Error('HubSpot webhook payload entry is missing subscriptionType.');
    }
    return payload as unknown as HubSpotWebhookPayload;
  });
}

export function extractHubSpotConnectionMetadata(
  payload: unknown,
  headers: HubSpotWebhookHeaders = {},
  hints: NormalizationHints = {},
): HubSpotWebhookConnectionMetadata {
  const normalizedHeaders = isNormalizedHeaderMap(headers) ? headers : normalizeHeaders(headers);
  const record = isRecord(payload) ? payload : {};
  const metadata = getRecord(record.metadata);
  const connection = getRecord(record.connection);
  const normalizedConnection = getRecord(record._connection);

  const result: HubSpotWebhookConnectionMetadata = {
    provider:
      hints.provider ??
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      HUBSPOT_PROVIDER,
  };

  const connectionId =
    hints.connectionId ??
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
    hints.providerConfigKey ??
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

  const requestId =
    readHeaderValue(normalizedHeaders, REQUEST_ID_HEADER_KEYS) ??
    readOptionalString(record.requestId) ??
    readOptionalString(record.request_id) ??
    readOptionalString(metadata?.requestId) ??
    readOptionalString(metadata?.request_id);
  if (requestId) {
    result.requestId = requestId;
  }

  const signature = readOptionalString(normalizedHeaders[HUBSPOT_SIGNATURE_V3_HEADER]);
  if (signature) {
    result.signature = signature;
  }

  const timestamp = readOptionalTimestamp(normalizedHeaders[HUBSPOT_REQUEST_TIMESTAMP_HEADER]);
  if (timestamp !== undefined) {
    result.timestamp = timestamp;
  }

  return result;
}

export function validateHubSpotWebhookSignature(
  input: HubSpotWebhookSignatureValidationInput,
): HubSpotWebhookSignatureValidationResult {
  const clientSecret = input.clientSecret.trim();
  if (!clientSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(input.headers);
  const receivedSignature = readOptionalString(normalizedHeaders[HUBSPOT_SIGNATURE_V3_HEADER]);
  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature' };
  }

  const timestamp = readOptionalTimestamp(normalizedHeaders[HUBSPOT_REQUEST_TIMESTAMP_HEADER]);
  if (timestamp === undefined) {
    return {
      ok: false,
      reason: 'missing-timestamp',
      receivedSignature,
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const toleranceMs = input.toleranceMs ?? HUBSPOT_SIGNATURE_TOLERANCE_MS;
  if (nowMs - timestamp > toleranceMs) {
    return {
      ok: false,
      reason: 'expired-timestamp',
      receivedSignature,
      timestamp,
    };
  }

  const expectedSignature = computeHubSpotSignatureV3({
    body: input.body,
    clientSecret,
    requestMethod: input.requestMethod,
    requestTimestamp: String(timestamp),
    requestUri: input.requestUri,
  });

  if (!isComparableSignature(receivedSignature)) {
    return {
      expectedSignature,
      ok: false,
      reason: 'malformed-signature',
      receivedSignature,
      timestamp,
    };
  }

  const ok = timingSafeCompare(receivedSignature, expectedSignature);
  if (!ok) {
    return {
      expectedSignature,
      ok: false,
      reason: 'invalid-signature',
      receivedSignature,
      timestamp,
    };
  }

  return {
    expectedSignature,
    ok: true,
    receivedSignature,
    timestamp,
  };
}

export function assertValidHubSpotWebhookSignature(
  input: HubSpotWebhookSignatureValidationInput,
): void {
  const result = validateHubSpotWebhookSignature(input);
  if (!result.ok) {
    throw new Error(`Invalid HubSpot webhook signature: ${result.reason}`);
  }
}

export function computeHubSpotSignatureV3(input: {
  body: Buffer | string;
  clientSecret: string;
  requestMethod: string;
  requestTimestamp: string;
  requestUri: string;
}): string {
  const source = `${input.requestMethod}${input.requestUri}${bodyToString(input.body)}${input.requestTimestamp}`;
  return createHmac('sha256', input.clientSecret).update(source).digest('base64');
}

export function extractHubSpotObjectType(payload: HubSpotWebhookPayload): HubSpotObjectType {
  const subscriptionType = payload.subscriptionType.trim();
  const objectPrefix = subscriptionType.split('.')[0];
  const direct = objectPrefix ? OBJECT_TYPE_ALIASES[objectPrefix.toLowerCase()] : undefined;
  if (direct) {
    return direct;
  }

  const collapsed = subscriptionType.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const collapsedMatch = OBJECT_TYPE_ALIASES[collapsed];
  if (collapsedMatch) {
    return collapsedMatch;
  }

  throw new Error(`Unsupported HubSpot webhook subscription type: ${subscriptionType}`);
}

export function extractHubSpotEventType(
  payload: HubSpotWebhookPayload,
  objectType = extractHubSpotObjectType(payload),
): string {
  const explicit = readOptionalString(payload.eventType);
  if (explicit) {
    return explicit.toLowerCase();
  }

  const [, rawAction] = payload.subscriptionType.split('.');
  const action = normalizeHubSpotAction(rawAction ?? payload.subscriptionType);
  return `${objectType}.${action}`;
}

function normalizeHubSpotAction(rawAction: string): string {
  const normalized = rawAction.trim();
  if (!normalized) {
    return 'updated';
  }
  switch (normalized.toLowerCase()) {
    case 'creation':
    case 'created':
      return 'created';
    case 'deletion':
    case 'deleted':
      return 'deleted';
    case 'propertychange':
    case 'property_change':
    case 'property-change':
      return 'propertyChange';
    case 'merge':
    case 'merged':
      return 'merged';
    case 'associationchange':
    case 'association_change':
    case 'association-change':
      return 'associationChange';
    default:
      return normalized;
  }
}

function buildNormalizedPayload(
  payload: HubSpotWebhookPayload,
  headers: HeaderMap,
  metadata: HubSpotWebhookConnectionMetadata,
  event: {
    eventType: string;
    objectId: string;
    objectType: HubSpotObjectType;
  },
): Record<string, unknown> {
  const normalizedPayload: Record<string, unknown> = {
    ...payload,
    _connection: compactRecord({
      connectionId: metadata.connectionId,
      provider: metadata.provider,
      providerConfigKey: metadata.providerConfigKey,
      requestId: metadata.requestId,
    }),
    _webhook: compactRecord({
      appId: payload.appId,
      attemptNumber: payload.attemptNumber,
      changeSource: payload.changeSource,
      eventId: payload.eventId,
      eventType: event.eventType,
      objectId: event.objectId,
      objectType: event.objectType,
      occurredAt: payload.occurredAt,
      portalId: payload.portalId,
      propertyName: payload.propertyName,
      signature: metadata.signature,
      subscriptionId: payload.subscriptionId,
      subscriptionType: payload.subscriptionType,
      timestamp: metadata.timestamp,
    }),
  };

  const requestTimestamp = readOptionalString(headers[HUBSPOT_REQUEST_TIMESTAMP_HEADER]);
  if (requestTimestamp) {
    normalizedPayload._headers = {
      [HUBSPOT_REQUEST_TIMESTAMP_HEADER]: requestTimestamp,
    };
  }
  return normalizedPayload;
}

function decodeWebhookPayload(rawPayload: unknown): unknown {
  if (Buffer.isBuffer(rawPayload)) {
    return JSON.parse(rawPayload.toString('utf8'));
  }
  if (typeof rawPayload === 'string') {
    return JSON.parse(rawPayload);
  }
  return rawPayload;
}

function normalizeHeaders(headers: HubSpotWebhookHeaders): HeaderMap {
  const normalized: HeaderMap = {};
  if (headers instanceof Headers) {
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

function normalizeHeaderValue(value: HeaderValue): string | undefined {
  if (value === null || value === undefined || value === false) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

function readHeaderValue(headers: HeaderMap, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readOptionalString(headers[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const stringValue = readOptionalString(value);
  if (!stringValue) {
    return undefined;
  }
  const parsed = Number(stringValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getRecord(value: unknown): HubSpotRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is HubSpotRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIterableHeaders(value: unknown): value is Iterable<readonly [string, string]> {
  return Boolean(value) && typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

function isNormalizedHeaderMap(value: unknown): value is HeaderMap {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function bodyToString(body: Buffer | string): string {
  return Buffer.isBuffer(body) ? body.toString('utf8') : body;
}

function isComparableSignature(signature: string): boolean {
  return signature.length > 0 && /^[A-Za-z0-9+/=]+$/u.test(signature);
}

function timingSafeCompare(receivedSignature: string, expectedSignature: string): boolean {
  const received = Buffer.from(receivedSignature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (received.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(received, expected);
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== null && value !== '') {
      compacted[key] = value;
    }
  }
  return compacted;
}
