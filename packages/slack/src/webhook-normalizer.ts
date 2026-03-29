import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  createSlackMessageObjectId,
  createSlackReactionObjectId,
  createSlackThreadObjectId,
  createSlackThreadReplyObjectId,
} from './path-mapper.js';
import type {
  SlackEnvelope,
  SlackEventCallbackEnvelope,
  SlackUrlVerificationEnvelope,
} from './types.js';

export interface NormalizedWebhook {
  provider: 'slack';
  connectionId?: string;
  eventType: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
}

export type SlackWebhookHeaders =
  | Headers
  | Record<string, string | string[] | undefined>
  | Array<[string, string]>;

export interface SlackEnvelopeMetadata {
  eventType: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
}

export interface SlackWebhookSignatureValidationOptions {
  now?: Date | number;
  toleranceSeconds?: number;
}

export type SlackWebhookSignatureFailureReason =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'stale_timestamp'
  | 'signature_mismatch';

export interface SlackWebhookSignatureValidationResult {
  ok: boolean;
  reason?: SlackWebhookSignatureFailureReason;
  providedSignature?: string;
  expectedSignature?: string;
  timestamp?: number;
  ageSeconds?: number;
}

export class SlackWebhookSignatureError extends Error {
  readonly validation: SlackWebhookSignatureValidationResult;

  constructor(message: string, validation: SlackWebhookSignatureValidationResult) {
    super(message);
    this.name = 'SlackWebhookSignatureError';
    this.validation = validation;
  }
}

const CONNECTION_ID_HEADERS = [
  'x-connection-id',
  'x-provider-connection-id',
  'x-relay-connection-id',
  'x-relayfile-connection-id',
] as const;
const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 60 * 5;
export const SLACK_REQUEST_TIMESTAMP_HEADER = 'x-slack-request-timestamp';
export const SLACK_SIGNATURE_HEADER = 'x-slack-signature';

export function normalizeSlackWebhook(
  rawPayload: unknown,
  headers: SlackWebhookHeaders = {},
): NormalizedWebhook {
  const envelope = parseSlackWebhookEnvelope(rawPayload);
  const metadata = extractSlackEnvelopeMetadata(envelope);
  const connectionId = extractSlackConnectionId(headers);
  const normalized: NormalizedWebhook = {
    provider: 'slack',
    eventType: metadata.eventType,
    objectType: metadata.objectType,
    objectId: metadata.objectId,
    payload: metadata.payload,
  };

  if (connectionId) {
    normalized.connectionId = connectionId;
  }

  return normalized;
}

export function parseSlackWebhookEnvelope(rawPayload: unknown): SlackEnvelope {
  const payload = parseSlackWebhookPayload(rawPayload);
  const type = readString(payload.type);

  if (type === 'event_callback') {
    if (!isRecord(payload.event)) {
      throw new TypeError('Slack event_callback payload is missing an event object');
    }
    return payload as unknown as SlackEnvelope;
  }

  if (type === 'url_verification') {
    if (typeof payload.challenge !== 'string') {
      throw new TypeError('Slack url_verification payload is missing a challenge string');
    }
    return payload as unknown as SlackEnvelope;
  }

  if (type === 'app_rate_limited') {
    return payload as unknown as SlackEnvelope;
  }

  throw new TypeError(`Unsupported Slack webhook envelope type: ${type ?? 'unknown'}`);
}

export function parseSlackWebhookPayload(rawPayload: unknown): Record<string, unknown> {
  if (typeof rawPayload === 'string') {
    return parseSlackWebhookJson(rawPayload);
  }

  if (rawPayload instanceof Uint8Array) {
    return parseSlackWebhookJson(Buffer.from(rawPayload).toString('utf8'));
  }

  if (!isRecord(rawPayload)) {
    throw new TypeError('Slack webhook payload must be a JSON object, string, or Uint8Array');
  }

  return { ...rawPayload };
}

export function normalizeSlackHeaders(headers: SlackWebhookHeaders = {}): Record<string, string> {
  const normalized: Record<string, string> = {};

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    for (const [name, value] of headers.entries()) {
      normalized[name.toLowerCase()] = value;
    }
    return normalized;
  }

  if (Array.isArray(headers)) {
    for (const [name, value] of headers) {
      normalized[name.toLowerCase()] = value;
    }
    return normalized;
  }

  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[name.toLowerCase()] = value;
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      normalized[name.toLowerCase()] = value[0] ?? '';
    }
  }

  return normalized;
}

export function extractSlackConnectionId(headers: SlackWebhookHeaders = {}): string | undefined {
  const normalizedHeaders = normalizeSlackHeaders(headers);

  for (const headerName of CONNECTION_ID_HEADERS) {
    const value = normalizedHeaders[headerName];
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function extractSlackEnvelopeMetadata(envelope: SlackEnvelope): SlackEnvelopeMetadata {
  switch (envelope.type) {
    case 'url_verification':
      return {
        eventType: 'url_verification',
        objectType: 'challenge',
        objectId: envelope.challenge,
        payload: toRecord(envelope),
      };
    case 'app_rate_limited':
      return {
        eventType: 'app_rate_limited',
        objectType: 'team',
        objectId: envelope.team_id,
        payload: toRecord(envelope),
      };
    case 'event_callback':
      return extractSlackEventCallbackMetadata(envelope);
  }
}

export function isSlackUrlVerificationEnvelope(
  value: unknown,
): value is SlackUrlVerificationEnvelope {
  return isRecord(value) && value.type === 'url_verification' && typeof value.challenge === 'string';
}

export function createSlackUrlVerificationResponse(
  input: NormalizedWebhook | SlackUrlVerificationEnvelope | unknown,
): { challenge: string } {
  if (isNormalizedSlackUrlVerification(input)) {
    const challenge = readString(input.payload.challenge) ?? input.objectId;
    return { challenge };
  }

  const envelope = isSlackUrlVerificationEnvelope(input)
    ? input
    : parseSlackWebhookEnvelope(input);

  if (envelope.type !== 'url_verification') {
    throw new TypeError('Slack webhook is not a url_verification envelope');
  }

  return { challenge: envelope.challenge };
}

export function computeSlackWebhookSignature(
  rawPayload: unknown,
  signingSecret: string,
  timestamp: number | string,
): string {
  const requestTimestamp = String(timestamp);
  const rawBody = getSlackRawBody(rawPayload);
  const signatureBase = `v0:${requestTimestamp}:${rawBody}`;
  const digest = createHmac('sha256', signingSecret).update(signatureBase).digest('hex');
  return `v0=${digest}`;
}

export function validateSlackWebhookSignature(
  rawPayload: unknown,
  headers: SlackWebhookHeaders,
  signingSecret: string,
  options: SlackWebhookSignatureValidationOptions = {},
): SlackWebhookSignatureValidationResult {
  const normalizedHeaders = normalizeSlackHeaders(headers);
  const providedSignature = normalizedHeaders[SLACK_SIGNATURE_HEADER];
  const timestampHeader = normalizedHeaders[SLACK_REQUEST_TIMESTAMP_HEADER];

  if (!providedSignature) {
    return { ok: false, reason: 'missing_signature' };
  }

  if (!timestampHeader) {
    return { ok: false, reason: 'missing_timestamp', providedSignature };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return {
      ok: false,
      reason: 'invalid_timestamp',
      providedSignature,
    };
  }

  const nowSeconds = resolveCurrentTime(options.now);
  const ageSeconds = Math.abs(nowSeconds - timestamp);
  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;

  if (ageSeconds > toleranceSeconds) {
    return {
      ok: false,
      reason: 'stale_timestamp',
      providedSignature,
      timestamp,
      ageSeconds,
    };
  }

  const expectedSignature = computeSlackWebhookSignature(rawPayload, signingSecret, timestamp);
  const ok = secureCompare(expectedSignature, providedSignature);

  return ok
    ? {
        ok: true,
        providedSignature,
        expectedSignature,
        timestamp,
        ageSeconds,
      }
    : {
        ok: false,
        reason: 'signature_mismatch',
        providedSignature,
        expectedSignature,
        timestamp,
        ageSeconds,
      };
}

export function assertSlackWebhookSignature(
  rawPayload: unknown,
  headers: SlackWebhookHeaders,
  signingSecret: string,
  options: SlackWebhookSignatureValidationOptions = {},
): void {
  const validation = validateSlackWebhookSignature(rawPayload, headers, signingSecret, options);

  if (!validation.ok) {
    throw new SlackWebhookSignatureError(
      `Invalid Slack webhook signature: ${validation.reason ?? 'unknown'}`,
      validation,
    );
  }
}

function extractSlackEventCallbackMetadata(
  envelope: SlackEventCallbackEnvelope,
): SlackEnvelopeMetadata {
  const normalizedEventRecord = toRecord(envelope.event);
  const payload = materializeSlackEventPayload(normalizedEventRecord);
  const eventType = mapSlackEventType(normalizedEventRecord);
  const objectType = inferSlackObjectType(normalizedEventRecord, payload);
  const objectId = inferSlackObjectId(normalizedEventRecord, payload, objectType, envelope.event_id);

  return {
    eventType,
    objectType,
    objectId,
    payload,
  };
}

function materializeSlackEventPayload(event: Record<string, unknown>): Record<string, unknown> {
  if (readString(event.type) !== 'message') {
    return { ...event };
  }

  const subtype = readString(event.subtype);
  if (subtype === 'message_changed') {
    const message = asRecord(event.message) ?? {};
    return compactRecord({
      ...message,
      channel: readString(event.channel) ?? readString(message.channel),
      event_ts: readString(event.event_ts),
      hidden: event.hidden,
      message: event.message,
      previous_message: event.previous_message,
      subtype,
      ts: readString(message.ts) ?? readString(event.ts),
      type: 'message',
    });
  }

  if (subtype === 'message_deleted') {
    const previousMessage = asRecord(event.previous_message) ?? {};
    const deletedTs =
      readString(event.deleted_ts) ?? readString(previousMessage.ts) ?? readString(event.ts);

    return compactRecord({
      ...previousMessage,
      channel: readString(event.channel) ?? readString(previousMessage.channel),
      deleted_ts: deletedTs,
      event_ts: readString(event.event_ts),
      hidden: event.hidden,
      previous_message: event.previous_message,
      subtype,
      ts: deletedTs,
      type: 'message',
    });
  }

  return { ...event };
}

function mapSlackEventType(event: Record<string, unknown>): string {
  const type = readString(event.type);

  switch (type) {
    case 'message': {
      const subtype = readString(event.subtype);
      if (subtype === 'message_changed') {
        return 'message.updated';
      }
      if (subtype === 'message_deleted') {
        return 'message.deleted';
      }
      return 'message.created';
    }
    case 'reaction_added':
      return 'reaction.added';
    case 'reaction_removed':
      return 'reaction.removed';
    case 'channel_archive':
      return 'channel.archived';
    case 'channel_created':
      return 'channel.created';
    case 'channel_rename':
      return 'channel.renamed';
    case 'channel_unarchive':
      return 'channel.unarchived';
    case 'member_joined_channel':
      return 'channel.member_joined';
    case 'member_left_channel':
      return 'channel.member_left';
    default:
      return type?.replace(/_/g, '.') ?? 'unknown';
  }
}

function inferSlackObjectType(
  event: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const type = readString(event.type);

  switch (type) {
    case 'message':
      return inferSlackMessageObjectType(payload);
    case 'reaction_added':
    case 'reaction_removed':
      return 'reaction';
    case 'channel_archive':
    case 'channel_created':
    case 'channel_rename':
    case 'channel_unarchive':
    case 'member_joined_channel':
    case 'member_left_channel':
      return 'channel';
    default:
      return type ?? 'event';
  }
}

function inferSlackObjectId(
  event: Record<string, unknown>,
  payload: Record<string, unknown>,
  objectType: string,
  fallback: string,
): string {
  switch (objectType) {
    case 'message': {
      const channelId = readString(payload.channel);
      const messageTs = readString(payload.ts) ?? readString(payload.event_ts);
      return channelId && messageTs
        ? createSlackMessageObjectId(channelId, messageTs)
        : fallback;
    }
    case 'thread': {
      const channelId = readString(payload.channel);
      const threadTs = readString(payload.thread_ts) ?? readString(payload.ts);
      return channelId && threadTs
        ? createSlackThreadObjectId(channelId, threadTs)
        : fallback;
    }
    case 'thread_reply': {
      const channelId = readString(payload.channel);
      const threadTs = readString(payload.thread_ts);
      const replyTs = readString(payload.ts);
      return channelId && threadTs && replyTs
        ? createSlackThreadReplyObjectId(channelId, threadTs, replyTs)
        : fallback;
    }
    case 'reaction': {
      const reactionId = inferSlackReactionObjectId(payload);
      return reactionId ?? fallback;
    }
    case 'channel':
      return readString(payload.channel)
        ?? readString(asRecord(payload.channel)?.id)
        ?? readString(event.channel)
        ?? readString(asRecord(event.channel)?.id)
        ?? fallback;
    case 'user':
      return readString(payload.user) ?? fallback;
    case 'file':
      return readString(payload.file) ?? fallback;
    case 'file_comment':
      return readString(payload.file_comment) ?? fallback;
    default:
      return fallback;
  }
}

function inferSlackMessageObjectType(payload: Record<string, unknown>): string {
  const threadTs = readString(payload.thread_ts);
  const messageTs = readString(payload.ts);

  if (!threadTs || !messageTs) {
    return 'message';
  }

  return threadTs === messageTs ? 'thread' : 'thread_reply';
}

function inferSlackReactionObjectId(payload: Record<string, unknown>): string | null {
  const item = asRecord(payload.item);
  const reaction = readString(payload.reaction);
  const userId = readString(payload.user);

  if (!item || !reaction || !userId) {
    return null;
  }

  const itemType = readString(item.type);
  switch (itemType) {
    case 'message': {
      const channelId = readString(item.channel);
      const messageTs = readString(item.ts);
      const threadTs = readString(payload.thread_ts);

      if (!channelId || !messageTs) {
        return null;
      }

      if (threadTs && threadTs !== messageTs) {
        return createSlackReactionObjectId({
          targetType: 'thread_reply',
          channelId,
          threadTs,
          replyTs: messageTs,
          reaction,
          userId,
        });
      }

      if (threadTs && threadTs === messageTs) {
        return createSlackReactionObjectId({
          targetType: 'thread',
          channelId,
          threadTs,
          reaction,
          userId,
        });
      }

      return createSlackReactionObjectId({
        targetType: 'message',
        channelId,
        messageTs,
        reaction,
        userId,
      });
    }
    case 'file': {
      const fileId = readString(item.file);
      return fileId
        ? createSlackReactionObjectId({ targetType: 'file', fileId, reaction, userId })
        : null;
    }
    case 'file_comment': {
      const fileCommentId = readString(item.file_comment);
      return fileCommentId
        ? createSlackReactionObjectId({
            targetType: 'file_comment',
            fileCommentId,
            reaction,
            userId,
          })
        : null;
    }
    default:
      return null;
  }
}

function getSlackRawBody(rawPayload: unknown): string {
  if (typeof rawPayload === 'string') {
    return rawPayload;
  }

  if (rawPayload instanceof Uint8Array) {
    return Buffer.from(rawPayload).toString('utf8');
  }

  return JSON.stringify(rawPayload);
}

function parseSlackWebhookJson(rawPayload: string): Record<string, unknown> {
  const parsed = JSON.parse(rawPayload) as unknown;
  if (!isRecord(parsed)) {
    throw new TypeError('Slack webhook JSON payload must decode to an object');
  }
  return parsed;
}

function resolveCurrentTime(now: Date | number | undefined): number {
  if (now instanceof Date) {
    return Math.floor(now.getTime() / 1000);
  }

  if (typeof now === 'number') {
    return now > 1_000_000_000_000 ? Math.floor(now / 1000) : Math.floor(now);
  }

  return Math.floor(Date.now() / 1000);
}

function secureCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

function toRecord<T extends object>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function isNormalizedSlackUrlVerification(
  value: NormalizedWebhook | SlackUrlVerificationEnvelope | unknown,
): value is NormalizedWebhook {
  return (
    isRecord(value)
    && value.provider === 'slack'
    && value.eventType === 'url_verification'
    && isRecord(value.payload)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
