import { createHmac, timingSafeEqual } from 'node:crypto';

import { rampLookupPathForEvent } from './path-mapper.js';
import {
  RAMP_HOOKDECK_DELIVERY_HEADER,
  RAMP_PROVIDER,
  RAMP_SIGNATURE_HEADER,
  type RampWebhookPayload,
} from './types.js';

type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type RampWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface NormalizedRampWebhook {
  provider: typeof RAMP_PROVIDER;
  eventType: string;
  objectType: string;
  objectId: string;
  eventId?: string;
  payload: Record<string, unknown>;
  businessId?: string;
  connectionId?: string;
  providerConfigKey?: string;
  deliveryId?: string;
  signature?: string;
  lookupPath?: string;
  isTransportEvent?: boolean;
}

export interface RampWebhookSignatureValidationResult {
  ok: boolean;
  reason?: 'invalid-signature' | 'malformed-signature' | 'missing-secret' | 'missing-signature';
  expectedSignature?: string;
  receivedSignature?: string;
}

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-ramp-connection-id',
  'ramp-connection-id',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-ramp-provider-config-key',
  'ramp-provider-config-key',
] as const;

export function normalizeRampWebhook(
  rawPayload: unknown,
  headers: RampWebhookHeaders = {},
): NormalizedRampWebhook {
  const payload = parseRampWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const eventType = readNonEmptyString(payload.type) ?? readNonEmptyString(payload.event_type);
  if (!eventType) {
    throw new Error('Ramp webhook payload missing type');
  }

  const objectType = rampObjectType(eventType);
  const eventId = readNonEmptyString(payload.id);
  const objectId = extractRampObjectId(payload, eventType, eventId);

  if (!objectId) {
    throw new Error(`Ramp webhook payload missing object.id/id for ${eventType}`);
  }

  const lookupPath = rampLookupPathForEvent(eventType, objectId);
  const normalized: NormalizedRampWebhook = {
    provider: RAMP_PROVIDER,
    eventType,
    objectType,
    objectId,
    payload,
    ...(eventId ? { eventId } : {}),
    ...(lookupPath ? { lookupPath } : {}),
  };

  const businessId = readNonEmptyString(payload.business_id);
  if (businessId) normalized.businessId = businessId;

  const deliveryId = readNonEmptyString(normalizedHeaders[RAMP_HOOKDECK_DELIVERY_HEADER]);
  if (deliveryId) normalized.deliveryId = deliveryId;

  const signature = readNonEmptyString(normalizedHeaders[RAMP_SIGNATURE_HEADER]);
  if (signature) normalized.signature = signature;

  const connectionId = readHeaderValue(normalizedHeaders, CONNECTION_ID_HEADER_KEYS)
    ?? readNonEmptyString(payload.connection_id)
    ?? readNonEmptyString(payload.connectionId);
  if (connectionId) normalized.connectionId = connectionId;

  const providerConfigKey = readHeaderValue(normalizedHeaders, PROVIDER_CONFIG_KEY_HEADER_KEYS)
    ?? readNonEmptyString(payload.provider_config_key)
    ?? readNonEmptyString(payload.providerConfigKey);
  if (providerConfigKey) normalized.providerConfigKey = providerConfigKey;

  if (eventType === 'webhooks.verification' || eventType === 'tests.test_event') {
    normalized.isTransportEvent = true;
  }

  return normalized;
}

export function parseRampWebhookPayload(rawPayload: unknown): RampWebhookPayload {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Ramp webhook payload must be a JSON object.');
  }
  return decoded as RampWebhookPayload;
}

export function computeRampWebhookSignature(
  rawPayload: string | Uint8Array | ArrayBuffer,
  secret: string,
): string {
  return createHmac('sha256', secret).update(toRawBodyBuffer(rawPayload)).digest('hex');
}

export function validateRampWebhookSignature(
  rawPayload: string | Uint8Array | ArrayBuffer,
  headers: RampWebhookHeaders = {},
  secret?: string,
): RampWebhookSignatureValidationResult {
  const normalizedHeaders = normalizeHeaders(headers);
  const receivedSignature = readNonEmptyString(normalizedHeaders[RAMP_SIGNATURE_HEADER]);
  if (!receivedSignature) {
    return { ok: false, reason: 'missing-signature' };
  }
  if (!secret) {
    return { ok: false, reason: 'missing-secret', receivedSignature };
  }

  const normalizedSignature = receivedSignature.startsWith('sha256=')
    ? receivedSignature.slice('sha256='.length)
    : receivedSignature;
  if (!/^[a-f0-9]{64}$/iu.test(normalizedSignature)) {
    return {
      ok: false,
      reason: 'malformed-signature',
      receivedSignature,
    };
  }

  const expectedSignature = computeRampWebhookSignature(rawPayload, secret);
  const expected = Buffer.from(expectedSignature, 'hex');
  const received = Buffer.from(normalizedSignature, 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return {
      ok: false,
      reason: 'invalid-signature',
      expectedSignature,
      receivedSignature,
    };
  }

  return {
    ok: true,
    expectedSignature,
    receivedSignature,
  };
}

export function assertValidRampWebhookSignature(
  rawPayload: string | Uint8Array | ArrayBuffer,
  headers: RampWebhookHeaders = {},
  secret?: string,
): void {
  const result = validateRampWebhookSignature(rawPayload, headers, secret);
  if (!result.ok) {
    throw new Error(`Invalid Ramp webhook signature: ${result.reason}`);
  }
}

export function rampObjectType(eventType: string): string {
  if (eventType === 'payments.updated') return 'bill';
  const family = eventType.split('.')[0] ?? '';
  switch (family) {
    case 'bills':
      return 'bill';
    case 'item_receipts':
      return 'item-receipt';
    case 'purchase_orders':
      return 'purchase-order';
    case 'reimbursements':
      return 'reimbursement';
    case 'transactions':
      return 'transaction';
    case 'vendor_agreements':
      return 'vendor-agreement';
    case 'vendors':
      return 'vendor';
    case 'entities':
      return 'entity';
    case 'users':
      return 'user';
    case 'unified_requests':
      return 'unified-request';
    case 'spend_requests':
      return 'spend-request';
    case 'applications':
      return 'application';
    case 'webhooks':
      return 'webhook';
    case 'tests':
      return 'test-event';
    default:
      return family || 'unknown';
  }
}

function extractRampObjectId(
  payload: RampWebhookPayload,
  eventType: string,
  eventId?: string,
): string | undefined {
  const objectId =
    readNonEmptyString(payload.object?.id) ??
    readNonEmptyString(payload.object_id);
  if (objectId) {
    return objectId;
  }

  if (eventType === 'webhooks.verification' || eventType === 'tests.test_event') {
    return (
      readNonEmptyString(payload.webhook_id) ??
      eventId ??
      readNonEmptyString(payload.challenge)
    );
  }

  return undefined;
}

function decodeWebhookPayload(rawPayload: unknown): unknown {
  if (isRecord(rawPayload)) {
    return rawPayload;
  }
  if (typeof rawPayload === 'string') {
    return JSON.parse(rawPayload) as unknown;
  }
  if (rawPayload instanceof Uint8Array) {
    return JSON.parse(Buffer.from(rawPayload).toString('utf8')) as unknown;
  }
  if (rawPayload instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(rawPayload).toString('utf8')) as unknown;
  }
  throw new Error('Ramp webhook payload must be JSON object, string, Uint8Array, or ArrayBuffer.');
}

function toRawBodyBuffer(rawPayload: string | Uint8Array | ArrayBuffer): Buffer {
  if (typeof rawPayload === 'string') {
    return Buffer.from(rawPayload, 'utf8');
  }
  if (rawPayload instanceof Uint8Array) {
    return Buffer.from(rawPayload);
  }
  return Buffer.from(rawPayload);
}

function normalizeHeaders(headers: RampWebhookHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }

  if (typeof headers === 'object' && headers !== null && Symbol.iterator in Object(headers)) {
    for (const pair of headers as Iterable<readonly [string, string]>) {
      if (Array.isArray(pair) && pair.length >= 2) {
        normalized[pair[0].toLowerCase()] = pair[1];
      }
    }
    return normalized;
  }

  for (const [key, rawValue] of Object.entries(headers as Record<string, HeaderValue>)) {
    if (Array.isArray(rawValue)) {
      const first = rawValue.find((entry) => typeof entry === 'string');
      if (first) normalized[key.toLowerCase()] = first;
      continue;
    }
    if (typeof rawValue === 'string') {
      normalized[key.toLowerCase()] = rawValue;
      continue;
    }
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      normalized[key.toLowerCase()] = String(rawValue);
    }
  }

  return normalized;
}

function readHeaderValue(
  headers: Record<string, string>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = readNonEmptyString(headers[key]);
    if (value) return value;
  }
  return undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
