import { createHmac, timingSafeEqual, verify } from 'node:crypto';

import type { NormalizedWebhook } from './sendgrid-adapter.js';

export const SENDGRID_PROVIDER = 'sendgrid';
export const SENDGRID_SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
export const SENDGRID_TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

const CONNECTION_ID_HEADER_KEYS = [
  'x-relay-connection-id',
  'x-connection-id',
  'x-sendgrid-connection-id',
  'sendgrid-connection-id',
] as const;

const PROVIDER_HEADER_KEYS = [
  'x-relay-provider',
  'x-provider',
  'x-sendgrid-provider',
  'sendgrid-provider',
] as const;

const PROVIDER_CONFIG_KEY_HEADER_KEYS = [
  'x-relay-provider-config-key',
  'x-provider-config-key',
  'x-sendgrid-provider-config-key',
  'sendgrid-provider-config-key',
] as const;

const REQUEST_ID_HEADER_KEYS = ['x-request-id', 'x-correlation-id', 'x-relay-request-id'] as const;

type SendGridRecord = Record<string, unknown>;
type HeaderValue = boolean | number | readonly string[] | string | null | undefined;

export type SendGridWebhookHeaders =
  | Headers
  | Iterable<readonly [string, string]>
  | Record<string, HeaderValue>;

export interface SendGridWebhookConnectionMetadata {
  connectionId?: string;
  provider: string;
  providerConfigKey?: string;
  requestId?: string;
  signature?: string;
  timestamp?: string;
}

export interface SendGridWebhookSignatureValidationResult {
  ok: boolean;
  reason?:
    | 'invalid-public-key'
    | 'invalid-signature'
    | 'malformed-signature'
    | 'missing-public-key'
    | 'missing-signature'
    | 'missing-timestamp';
  receivedSignature?: string;
}

export interface SendGridWebhookTimestampValidationResult {
  driftMs?: number;
  ok: boolean;
  reason?: 'invalid-timestamp' | 'missing-timestamp' | 'stale-timestamp';
  webhookTimestamp?: number;
}

export function normalizeSendGridWebhook(
  rawPayload: unknown,
  headers: SendGridWebhookHeaders = {},
): NormalizedWebhook {
  const events = normalizeSendGridWebhookEvents(rawPayload, headers);
  const first = events[0];
  if (!first) {
    throw new Error('SendGrid webhook payload produced no events.');
  }
  return first;
}

export function normalizeSendGridWebhookEvents(
  rawPayload: unknown,
  headers: SendGridWebhookHeaders = {},
): NormalizedWebhook[] {
  const payload = parseSendGridWebhookPayload(rawPayload);
  const normalizedHeaders = normalizeHeaders(headers);
  const connection = extractSendGridConnectionMetadata(payload, normalizedHeaders);
  const records = expandWebhookRecords(payload);

  return records.map((record) => {
    const objectType = inferSendGridObjectType(record);
    const objectId = extractSendGridObjectId(objectType, record);
    const action = inferSendGridAction(objectType, record);
    const normalized: NormalizedWebhook = {
      provider: connection.provider,
      eventType: `${objectType}.${action}`,
      objectType,
      objectId,
      payload: buildNormalizedPayload(record, payload, connection, {
        action,
        eventType: `${objectType}.${action}`,
        objectId,
        objectType,
      }),
    };
    if (connection.connectionId) {
      normalized.connectionId = connection.connectionId;
    }
    return normalized;
  });
}

export function parseSendGridWebhookPayload(rawPayload: unknown): unknown {
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

export function extractSendGridConnectionMetadata(
  payload: unknown,
  headers: SendGridWebhookHeaders = {},
): SendGridWebhookConnectionMetadata {
  const normalizedHeaders = isNormalizedHeaderRecord(headers) ? headers : normalizeHeaders(headers);
  const record = firstRecord(payload);
  const metadata = getRecord(record?.metadata);
  const normalizedConnection = getRecord(record?._connection);

  const result: SendGridWebhookConnectionMetadata = {
    provider:
      readHeaderValue(normalizedHeaders, PROVIDER_HEADER_KEYS) ??
      readOptionalString(record?.provider) ??
      readOptionalString(metadata?.provider) ??
      readOptionalString(normalizedConnection?.provider) ??
      SENDGRID_PROVIDER,
  };

  const connectionId =
    readHeaderValue(normalizedHeaders, CONNECTION_ID_HEADER_KEYS) ??
    readOptionalString(record?.connectionId) ??
    readOptionalString(record?.connection_id) ??
    readOptionalString(metadata?.connectionId) ??
    readOptionalString(metadata?.connection_id) ??
    readOptionalString(normalizedConnection?.connectionId) ??
    readOptionalString(normalizedConnection?.connection_id);
  if (connectionId) {
    result.connectionId = connectionId;
  }

  const providerConfigKey =
    readHeaderValue(normalizedHeaders, PROVIDER_CONFIG_KEY_HEADER_KEYS) ??
    readOptionalString(record?.providerConfigKey) ??
    readOptionalString(record?.provider_config_key) ??
    readOptionalString(metadata?.providerConfigKey) ??
    readOptionalString(metadata?.provider_config_key) ??
    readOptionalString(normalizedConnection?.providerConfigKey) ??
    readOptionalString(normalizedConnection?.provider_config_key);
  if (providerConfigKey) {
    result.providerConfigKey = providerConfigKey;
  }

  const requestId =
    readHeaderValue(normalizedHeaders, REQUEST_ID_HEADER_KEYS) ??
    readOptionalString(record?.requestId) ??
    readOptionalString(record?.request_id) ??
    readOptionalString(metadata?.requestId) ??
    readOptionalString(metadata?.request_id);
  if (requestId) {
    result.requestId = requestId;
  }

  const signature = readOptionalString(normalizedHeaders[SENDGRID_SIGNATURE_HEADER]);
  if (signature) {
    result.signature = signature;
  }

  const timestamp = readOptionalString(normalizedHeaders[SENDGRID_TIMESTAMP_HEADER]);
  if (timestamp) {
    result.timestamp = timestamp;
  }

  return result;
}

export function validateSendGridWebhookSignature(
  rawPayload: unknown,
  headers: SendGridWebhookHeaders,
  publicKey: string | Buffer | undefined,
): SendGridWebhookSignatureValidationResult {
  if (!publicKey || (typeof publicKey === 'string' && publicKey.trim().length === 0)) {
    return { ok: false, reason: 'missing-public-key' };
  }

  const normalizedHeaders = normalizeHeaders(headers);
  const signature = readOptionalString(normalizedHeaders[SENDGRID_SIGNATURE_HEADER]);
  if (!signature) {
    return { ok: false, reason: 'missing-signature' };
  }

  const timestamp = readOptionalString(normalizedHeaders[SENDGRID_TIMESTAMP_HEADER]);
  if (!timestamp) {
    return { ok: false, reason: 'missing-timestamp', receivedSignature: signature };
  }

  const signatureBuffer = decodeBase64Signature(signature);
  if (!signatureBuffer) {
    return { ok: false, reason: 'malformed-signature', receivedSignature: signature };
  }

  const signedPayload = Buffer.concat([
    Buffer.from(timestamp, 'utf8'),
    toRawBodyBuffer(rawPayload),
  ]);

  try {
    const ok = verify('SHA256', signedPayload, publicKey, signatureBuffer);
    return ok
      ? { ok: true, receivedSignature: signature }
      : { ok: false, reason: 'invalid-signature', receivedSignature: signature };
  } catch {
    return { ok: false, reason: 'invalid-public-key', receivedSignature: signature };
  }
}

export function assertValidSendGridWebhookSignature(
  rawPayload: unknown,
  headers: SendGridWebhookHeaders,
  publicKey: string | Buffer | undefined,
): void {
  const result = validateSendGridWebhookSignature(rawPayload, headers, publicKey);
  if (!result.ok) {
    throw new Error(
      `Invalid SendGrid webhook signature${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function validateSendGridWebhookTimestamp(
  headers: SendGridWebhookHeaders,
  toleranceMs = 300_000,
  now = Date.now(),
): SendGridWebhookTimestampValidationResult {
  const normalizedHeaders = normalizeHeaders(headers);
  const timestampHeader = readOptionalString(normalizedHeaders[SENDGRID_TIMESTAMP_HEADER]);
  if (!timestampHeader) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: 'invalid-timestamp' };
  }

  const webhookTimestamp = timestampSeconds * 1000;
  const driftMs = Math.abs(now - webhookTimestamp);
  if (driftMs > toleranceMs) {
    return { ok: false, reason: 'stale-timestamp', webhookTimestamp, driftMs };
  }

  return { ok: true, webhookTimestamp, driftMs };
}

export function assertValidSendGridWebhookTimestamp(
  headers: SendGridWebhookHeaders,
  toleranceMs = 300_000,
  now = Date.now(),
): void {
  const result = validateSendGridWebhookTimestamp(headers, toleranceMs, now);
  if (!result.ok) {
    throw new Error(
      `Invalid SendGrid webhook timestamp${result.reason ? ` (${result.reason})` : ''}.`,
    );
  }
}

export function computeSendGridWebhookBodyHmac(rawPayload: unknown, secret: string): string {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error('SendGrid webhook fingerprint secret must be a non-empty string.');
  }
  return createHmac('sha256', normalizedSecret)
    .update(toRawBodyBuffer(rawPayload))
    .digest('hex');
}

function buildNormalizedPayload(
  record: SendGridRecord,
  originalPayload: unknown,
  connection: SendGridWebhookConnectionMetadata,
  normalized: {
    action: string;
    eventType: string;
    objectId: string;
    objectType: string;
  },
): SendGridRecord {
  const existingConnection = getRecord(record._connection);
  const existingWebhook = getRecord(record._webhook);
  const payload: SendGridRecord = { ...record };

  if (Array.isArray(originalPayload)) {
    payload.events = originalPayload;
  }

  payload._connection = compactObject({
    ...existingConnection,
    connectionId: connection.connectionId,
    provider: connection.provider,
    providerConfigKey: connection.providerConfigKey,
    requestId: connection.requestId,
  });

  payload._webhook = compactObject({
    ...existingWebhook,
    action: normalized.action,
    eventType: normalized.eventType,
    objectId: normalized.objectId,
    objectType: normalized.objectType,
    signature: connection.signature,
    timestamp: connection.timestamp,
  });

  return payload;
}

function expandWebhookRecords(payload: unknown): SendGridRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is SendGridRecord => isRecord(entry));
  }
  if (isRecord(payload)) {
    const events = payload.events;
    if (Array.isArray(events) && events.every((entry) => isRecord(entry))) {
      return events as SendGridRecord[];
    }
    return [payload];
  }
  throw new Error('SendGrid webhook payload must be a JSON object or event array.');
}

function inferSendGridObjectType(record: SendGridRecord): 'contact' | 'event' | 'mail' {
  const explicit =
    readOptionalString(record.objectType) ??
    readOptionalString(record.object_type) ??
    readOptionalString(record.type);
  if (explicit) {
    const normalized = explicit.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (normalized === 'contact' || normalized === 'contacts' || normalized === 'marketingcontact') {
      return 'contact';
    }
    if (normalized === 'mail' || normalized === 'message' || normalized === 'email') {
      return 'mail';
    }
    if (normalized === 'event' || normalized === 'events' || normalized === 'webhookevent') {
      return 'event';
    }
  }

  if (readOptionalString(record.event) || readOptionalString(record.sg_event_id)) {
    return 'event';
  }
  if (isRecord(record.contact)) {
    return 'contact';
  }
  if (readOptionalString(record.email) && !isRecord(record.from) && !Array.isArray(record.personalizations)) {
    return 'contact';
  }
  if (isRecord(record.mail) || isRecord(record.from) || Array.isArray(record.personalizations)) {
    return 'mail';
  }

  throw new Error('Unable to infer SendGrid webhook object type.');
}

function extractSendGridObjectId(objectType: string, record: SendGridRecord): string {
  const data = getRecord(record.data);
  const mail = getRecord(record.mail);
  const contact = getRecord(record.contact);

  if (objectType === 'event') {
    const id =
      readOptionalString(record.sg_event_id) ??
      readOptionalString(record.event_id) ??
      readOptionalString(record.id) ??
      readOptionalString(data?.sg_event_id) ??
      readOptionalString(data?.event_id) ??
      readOptionalString(data?.id) ??
      readOptionalString(record.sg_message_id) ??
      readOptionalString(data?.sg_message_id);
    if (id) {
      return id;
    }
  }

  if (objectType === 'mail') {
    const id =
      readOptionalString(record.id) ??
      readOptionalString(record.message_id) ??
      readOptionalString(record.sg_message_id) ??
      readOptionalString(mail?.id) ??
      readOptionalString(mail?.message_id) ??
      readOptionalString(data?.id) ??
      readOptionalString(data?.message_id);
    if (id) {
      return id;
    }
  }

  if (objectType === 'contact') {
    const id =
      readOptionalString(record.id) ??
      readOptionalString(contact?.id) ??
      readOptionalString(data?.id) ??
      readOptionalString(record.email) ??
      readOptionalString(contact?.email) ??
      readOptionalString(data?.email);
    if (id) {
      return id;
    }
  }

  throw new Error(`SendGrid ${objectType} webhook is missing an object identifier.`);
}

function inferSendGridAction(objectType: string, record: SendGridRecord): string {
  const explicit =
    readOptionalString(record.action) ??
    readOptionalString(record.eventType)?.split('.').pop() ??
    readOptionalString(record.event_type)?.split('.').pop();
  if (explicit) {
    return explicit.toLowerCase();
  }
  if (objectType === 'event') {
    return readOptionalString(record.event)?.toLowerCase() ?? 'processed';
  }
  return 'update';
}

function decodeBase64Signature(signature: string): Buffer | undefined {
  try {
    const decoded = Buffer.from(signature, 'base64');
    const reencoded = decoded.toString('base64').replace(/=+$/u, '');
    const normalized = signature.trim().replace(/=+$/u, '');
    if (!constantTimeStringEqual(reencoded, normalized)) {
      return undefined;
    }
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
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

function normalizeHeaders(headers: SendGridWebhookHeaders): Record<string, string> {
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

function firstRecord(payload: unknown): SendGridRecord | undefined {
  if (Array.isArray(payload)) {
    return payload.find((entry): entry is SendGridRecord => isRecord(entry));
  }
  return isRecord(payload) ? payload : undefined;
}

function compactObject(value: SendGridRecord): SendGridRecord {
  const compacted: SendGridRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== null && entry !== '') {
      compacted[key] = entry;
    }
  }
  return compacted;
}

function normalizeHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(',');
  }
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value.trim() : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getRecord(value: unknown): SendGridRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is SendGridRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIterableEntries(value: unknown): value is Iterable<readonly [string, string]> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Symbol.iterator in value && typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

function isNormalizedHeaderRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
}
