import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedWebhook } from './stripe-adapter.js';
import { normalizeStripeObjectType } from './path-mapper.js';
import type { StripePrimaryObject, StripeWebhookPayload } from './types.js';

export const STRIPE_PROVIDER = 'stripe';
export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';
export const STRIPE_EVENT_HEADER = 'stripe-event';
export const STRIPE_DELIVERY_HEADER = 'stripe-delivery';
export const STRIPE_DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-stripe-connection-id',
  'stripe-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-stripe-provider',
  'stripe-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-stripe-provider-config-key',
  'stripe-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;

type StripeRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type StripeWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface StripeWebhookConnectionMetadata {
  connectionId?: string;
  deliveryId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  stripeAccount?: string;
  stripeRequestId?: string;
  webhookTimestamp?: number;
}

export interface StripeWebhookSignatureParts {
  signatures: string[];
  timestamp: number;
}

export interface StripeWebhookSignatureValidationResult {
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

export interface NormalizeStripeWebhookOptions {
  now?: number;
  toleranceSeconds?: number;
  webhookSecret?: string;
}

export function normalizeStripeWebhook(
  rawPayload: unknown,
  headers: StripeWebhookHeaders = {},
  options: NormalizeStripeWebhookOptions = {},
): NormalizedWebhook {
  if (options.webhookSecret !== undefined) {
    const validationOptions: NormalizeStripeWebhookOptions = {};
    if (options.now !== undefined) {
      validationOptions.now = options.now;
    }
    if (options.toleranceSeconds !== undefined) {
      validationOptions.toleranceSeconds = options.toleranceSeconds;
    }
    assertValidStripeWebhookSignature(rawPayload, headers, options.webhookSecret, {
      ...validationOptions,
    });
  }

  const payload = parseStripeWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const object = extractStripeEventObject(payload);
  const objectType = normalizeStripeObjectType(object.object);
  const objectId = readRequiredString(object.id, 'Stripe webhook data.object.id');
  const eventType = extractStripeEventType(payload, normalizedHeaders);
  const connection = extractStripeConnectionMetadata(payload, normalizedHeaders);

  const normalized: NormalizedWebhook = {
    provider: connection.provider,
    eventType,
    objectType,
    objectId,
    payload: buildNormalizedPayload(payload, object, connection),
  };

  if (connection.connectionId) {
    normalized.connectionId = connection.connectionId;
  }

  return normalized;
}

export function parseStripeWebhookPayload(rawPayload: unknown): StripeWebhookPayload {
  const decoded = decodeWebhookPayload(rawPayload);
  if (!isRecord(decoded)) {
    throw new Error('Stripe webhook payload must be a JSON object.');
  }
  if (decoded.object !== 'event') {
    throw new Error('Stripe webhook payload must have object="event".');
  }
  const data = getRecord(decoded.data);
  if (!data || !isRecord(data.object)) {
    throw new Error('Stripe webhook payload must include data.object.');
  }
  return decoded as unknown as StripeWebhookPayload;
}

export function extractStripeConnectionMetadata(
  payload: unknown,
  headers: StripeWebhookHeaders = {},
): StripeWebhookConnectionMetadata {
  const event = parseStripeWebhookPayload(payload);
  const normalizedHeaders = normalizeHeaders(headers);
  const objectRecord = event.data.object as unknown as StripeRecord;
  const metadata = getRecord(objectRecord.metadata);
  const normalizedConnection = getRecord(objectRecord._connection);
  const normalizedWebhook = getRecord(objectRecord._webhook);

  const result: StripeWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      STRIPE_PROVIDER,
  };

  const connectionId =
    readHeaderValue(normalizedHeaders, CONNECTION_ID_HEADER_KEYS) ??
    readOptionalString(metadata?.connectionId) ??
    readOptionalString(metadata?.connection_id) ??
    readOptionalString(normalizedConnection?.connectionId) ??
    readOptionalString(normalizedConnection?.connection_id);
  if (connectionId) {
    result.connectionId = connectionId;
  }

  const providerConfigKey =
    readHeaderValue(normalizedHeaders, PROVIDER_CONFIG_KEY_HEADER_KEYS) ??
    readOptionalString(metadata?.providerConfigKey) ??
    readOptionalString(metadata?.provider_config_key) ??
    readOptionalString(normalizedConnection?.providerConfigKey) ??
    readOptionalString(normalizedConnection?.provider_config_key);
  if (providerConfigKey) {
    result.providerConfigKey = providerConfigKey;
  }

  const deliveryId =
    readOptionalString(normalizedHeaders[STRIPE_DELIVERY_HEADER]) ??
    readOptionalString(event.id) ??
    readOptionalString(normalizedWebhook?.deliveryId) ??
    readOptionalString(normalizedWebhook?.delivery_id);
  if (deliveryId) {
    result.deliveryId = deliveryId;
  }

  const signature = readOptionalString(normalizedHeaders[STRIPE_SIGNATURE_HEADER]);
  if (signature) {
    result.signature = signature;
  }

  const requestId =
    readHeaderValue(normalizedHeaders, REQUEST_ID_HEADER_KEYS) ??
    readOptionalString(normalizedConnection?.requestId) ??
    readOptionalString(normalizedConnection?.request_id);
  if (requestId) {
    result.requestId = requestId;
  }

  const stripeRequestId = readOptionalString(event.request?.id);
  if (stripeRequestId) {
    result.stripeRequestId = stripeRequestId;
  }

  const stripeAccount = readOptionalString(event.account);
  if (stripeAccount) {
    result.stripeAccount = stripeAccount;
  }

  const signatureParts = parseStripeSignatureHeader(signature);
  const webhookTimestamp = signatureParts?.timestamp ?? readOptionalNumber(event.created);
  if (webhookTimestamp !== undefined) {
    result.webhookTimestamp = webhookTimestamp;
  }

  return result;
}

export function extractStripeEventType(
  payload: unknown,
  headers: StripeWebhookHeaders = {},
): string {
  const event = parseStripeWebhookPayload(payload);
  const normalizedHeaders = normalizeHeaders(headers);
  const headerEvent = readOptionalString(normalizedHeaders[STRIPE_EVENT_HEADER]);
  const eventType = headerEvent ?? readOptionalString(event.type);
  if (!eventType) {
    throw new Error('Stripe webhook payload is missing event type.');
  }
  return eventType.trim().toLowerCase();
}

export function extractStripeEventObject(payload: unknown): StripePrimaryObject {
  const event = parseStripeWebhookPayload(payload);
  const object = event.data.object;
  if (!isRecord(object)) {
    throw new Error('Stripe webhook payload data.object must be an object.');
  }
  readRequiredString(object.id, 'Stripe webhook data.object.id');
  readRequiredString(object.object, 'Stripe webhook data.object.object');
  return object as unknown as StripePrimaryObject;
}

export function computeStripeWebhookSignature(
  rawPayload: unknown,
  secret: string,
  timestamp: number,
): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error('Stripe webhook secret must be a non-empty string.');
  }

  return createHmac('sha256', normalizedSecret)
    .update(`${timestamp}.${toRawBodyString(rawPayload)}`)
    .digest('hex');
}

export function validateStripeWebhookSignature(
  rawPayload: unknown,
  headers: StripeWebhookHeaders,
  secret: string,
  options: NormalizeStripeWebhookOptions = {},
): StripeWebhookSignatureValidationResult {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    return { ok: false, reason: 'missing-secret' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const signatureHeader = readOptionalString(normalizedHeaders[STRIPE_SIGNATURE_HEADER]);
  if (!signatureHeader) {
    return { ok: false, reason: 'missing-signature' };
  }

  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed || parsed.signatures.length === 0) {
    return { ok: false, reason: 'malformed-signature', receivedSignature: signatureHeader };
  }
  const firstSignature = parsed.signatures[0];
  if (!firstSignature) {
    return { ok: false, reason: 'malformed-signature', receivedSignature: signatureHeader };
  }

  const toleranceSeconds = options.toleranceSeconds ?? STRIPE_DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ageSeconds = Math.abs(now - parsed.timestamp);
  if (ageSeconds > toleranceSeconds) {
    return {
      ok: false,
      reason: 'expired-timestamp',
      receivedSignature: firstSignature,
      timestamp: parsed.timestamp,
    };
  }

  const expectedSignature = computeStripeWebhookSignature(rawPayload, normalizedSecret, parsed.timestamp);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  for (const receivedSignature of parsed.signatures) {
    const normalizedSignature = normalizeSignatureDigest(receivedSignature);
    if (!normalizedSignature) {
      continue;
    }
    const receivedBuffer = Buffer.from(normalizedSignature, 'hex');
    if (receivedBuffer.length !== expectedBuffer.length) {
      continue;
    }
    if (timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return {
        ok: true,
        expectedSignature,
        receivedSignature,
        timestamp: parsed.timestamp,
      };
    }
  }

  return {
    ok: false,
    reason: 'invalid-signature',
    expectedSignature,
    receivedSignature: firstSignature,
    timestamp: parsed.timestamp,
  };
}

export function assertValidStripeWebhookSignature(
  rawPayload: unknown,
  headers: StripeWebhookHeaders,
  secret: string,
  options: NormalizeStripeWebhookOptions = {},
): void {
  const result = validateStripeWebhookSignature(rawPayload, headers, secret, options);
  if (!result.ok) {
    throw new Error(
      `Invalid Stripe webhook signature${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function parseStripeSignatureHeader(
  header: string | undefined,
): StripeWebhookSignatureParts | undefined {
  const value = readOptionalString(header);
  if (!value) {
    return undefined;
  }

  const signatures: string[] = [];
  let timestamp: number | undefined;

  for (const part of value.split(',')) {
    const [rawKey, ...rawValueParts] = part.split('=');
    const key = rawKey?.trim();
    const rawValue = rawValueParts.join('=').trim();
    if (!key || !rawValue) {
      continue;
    }
    if (key === 't') {
      const parsedTimestamp = Number(rawValue);
      if (Number.isInteger(parsedTimestamp) && parsedTimestamp > 0) {
        timestamp = parsedTimestamp;
      }
      continue;
    }
    if (key === 'v1') {
      signatures.push(rawValue);
    }
  }

  if (timestamp === undefined) {
    return undefined;
  }

  return { signatures, timestamp };
}

function buildNormalizedPayload(
  event: StripeWebhookPayload,
  object: StripePrimaryObject,
  connection: StripeWebhookConnectionMetadata,
): StripeRecord {
  const objectRecord = object as unknown as StripeRecord;
  const existingConnection = getRecord(objectRecord._connection);
  const existingWebhook = getRecord(objectRecord._webhook);

  return compactObject({
    ...objectRecord,
    _connection: compactObject({
      ...existingConnection,
      connectionId: connection.connectionId,
      deliveryId: connection.deliveryId,
      provider: connection.provider,
      providerConfigKey: connection.providerConfigKey,
      requestId: connection.requestId,
    }),
    _stripe_event: compactObject({
      account: connection.stripeAccount,
      apiVersion: event.api_version,
      created: event.created,
      eventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      pendingWebhooks: event.pending_webhooks,
      previousAttributes: event.data.previous_attributes,
      requestId: connection.stripeRequestId,
      requestIdempotencyKey: event.request?.idempotency_key,
    }),
    _webhook: compactObject({
      ...existingWebhook,
      deliveryId: connection.deliveryId,
      eventType: event.type,
      objectId: object.id,
      objectType: object.object,
      signature: connection.signature,
      webhookTimestamp: connection.webhookTimestamp,
    }),
  });
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

function toRawBodyString(rawPayload: unknown): string {
  if (typeof rawPayload === 'string') {
    return rawPayload;
  }

  if (Buffer.isBuffer(rawPayload)) {
    return rawPayload.toString('utf8');
  }

  if (rawPayload instanceof Uint8Array) {
    return Buffer.from(rawPayload).toString('utf8');
  }

  if (rawPayload instanceof ArrayBuffer) {
    return Buffer.from(rawPayload).toString('utf8');
  }

  return JSON.stringify(rawPayload);
}

function normalizeHeaders(headers: StripeWebhookHeaders): Record<string, string> {
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

function normalizeHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(',');
  }
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function normalizeSignatureDigest(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function readRequiredString(value: unknown, label: string): string {
  const stringValue = readOptionalString(value);
  if (!stringValue) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return stringValue;
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
  return undefined;
}

function compactObject(input: Record<string, unknown>): StripeRecord {
  const output: StripeRecord = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function getRecord(value: unknown): StripeRecord | undefined {
  if (isRecord(value)) {
    return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is StripeRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIterableEntries(value: unknown): value is Iterable<readonly [string, string]> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Symbol.iterator in value && typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}
