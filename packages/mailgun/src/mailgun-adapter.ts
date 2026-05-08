import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeMailgunPath,
  mailgunEventPath,
  mailgunListPath,
  mailgunMessagePath,
  normalizeMailgunObjectType,
} from './path-mapper.js';
import { MAILGUN_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  MailgunAdapterConfig,
  MailgunEventPayload,
  MailgunListPayload,
  MailgunMessagePayload,
  MailgunWebhookPayload,
} from './types.js';

export interface FileSemantics {
  properties?: Record<string, string>;
  relations?: string[];
  permissions?: string[];
  comments?: string[];
}

export interface IngestError {
  path: string;
  error: string;
}

export interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: IngestError[];
}

export interface NormalizedWebhook {
  provider: string;
  connectionId?: string;
  eventType: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
}

export interface WriteFileInput {
  workspaceId: string;
  path: string;
  content: string;
  contentType?: string;
  semantics?: FileSemantics;
}

export interface WriteFileResult {
  created?: boolean;
  updated?: boolean;
  status?: 'created' | 'updated' | 'queued' | 'pending';
}

export interface DeleteFileInput {
  workspaceId: string;
  path: string;
}

export interface RelayFileClientLike {
  writeFile(input: WriteFileInput): Promise<WriteFileResult | void>;
  deleteFile?(input: DeleteFileInput): Promise<void> | void;
}

export abstract class IntegrationAdapter {
  protected readonly client: RelayFileClientLike;
  protected readonly provider: ConnectionProvider;

  abstract readonly name: string;
  abstract readonly version: string;

  constructor(client: RelayFileClientLike, provider: ConnectionProvider) {
    this.client = client;
    this.provider = provider;
  }

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | MailgunWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  supportedEvents?(): string[];
}

type MailgunRecord = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const MAILGUN_PROVIDER_NAME = 'mailgun';
const SUPPORTED_EVENTS = MAILGUN_WEBHOOK_OBJECT_TYPES;

const EVENT_ACTIONS = [
  'accepted',
  'clicked',
  'complained',
  'delivered',
  'failed',
  'opened',
  'permanent_fail',
  'stored',
  'unsubscribed',
] as const;

export class MailgunAdapter extends IntegrationAdapter {
  override readonly name = MAILGUN_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: MailgunAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: MailgunAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return [
      'message.accepted',
      'message.delivered',
      'message.failed',
      'message.stored',
      ...EVENT_ACTIONS.map((action) => `event.${action}`),
      'list.created',
      'list.updated',
    ];
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | MailgunWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const domain = readDomain(normalized.payload, this.config.defaultDomain);
      const path = computeMailgunPath(
        normalized.objectType,
        normalized.objectId,
        domain,
      );

      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content: this.renderContent(workspaceId, normalized, domain),
        contentType: JSON_CONTENT_TYPE,
        semantics: this.computeSemantics(
          normalized.objectType,
          normalized.objectId,
          normalized.payload,
        ),
      });

      const counts = inferWriteCounts(writeResult);
      return {
        filesWritten: counts.filesWritten,
        filesUpdated: counts.filesUpdated,
        filesDeleted: 0,
        paths: [path],
        errors: [],
      };
    } catch (error) {
      const fallbackPath = inferFallbackPath(event, this.config.defaultDomain);
      return {
        filesWritten: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        paths: fallbackPath ? [fallbackPath] : [],
        errors: [
          {
            path: fallbackPath,
            error: toErrorMessage(error),
          },
        ],
      };
    }
  }

  override computePath(objectType: string, objectId: string, domain?: string): string {
    return computeMailgunPath(objectType, objectId, domain ?? this.config.defaultDomain);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeMailgunObjectType(objectType);
    const properties: Record<string, string> = {
      provider: MAILGUN_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'mailgun.id': objectId,
      'mailgun.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    addStringProperty(properties, 'mailgun.domain', readDomain(payload, this.config.defaultDomain));
    addStringProperty(properties, 'mailgun.url', payload.url);

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'mailgun.webhook.action', webhook.action);
      addStringProperty(properties, 'mailgun.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'mailgun.webhook.timestamp', webhook.timestamp);
      addStringProperty(properties, 'mailgun.webhook.token', webhook.token);
    }

    switch (normalizedType) {
      case 'message':
        applyMessageSemantics(properties, relations, comments, payload as MailgunRecord);
        break;
      case 'event':
        applyEventSemantics(properties, relations, comments, payload as MailgunRecord, this.config.defaultDomain);
        break;
      case 'list':
        applyListSemantics(properties, payload as MailgunRecord);
        break;
    }

    const semantics: FileSemantics = {
      properties,
      relations: sortStrings(relations),
    };
    if (comments.length > 0) {
      semantics.comments = comments;
    }
    return compactSemantics(semantics);
  }

  private normalizeEvent(event: NormalizedWebhook | MailgunWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || MAILGUN_PROVIDER_NAME,
        eventType: normalizeMailgunEventType(event.eventType, event.objectType),
        objectType: normalizeMailgunObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const payload = unwrapMailgunPayload(event);
    const objectType = inferObjectType(payload, event);
    const objectId = extractObjectId(objectType, payload, event);
    const action = inferAction(objectType, payload, event);
    const mergedPayload = mergeMailgunPayload(event, payload, objectType, objectId, action);

    const normalized: NormalizedWebhook = {
      provider: this.config.provider || readOptionalString(event.provider) || MAILGUN_PROVIDER_NAME,
      eventType: `${objectType}.${action}`,
      objectType,
      objectId,
      payload: mergedPayload,
    };
    const connectionId = readOptionalString(event.connectionId) ??
      readOptionalString(event.connection_id) ??
      this.config.connectionId;
    if (connectionId) {
      normalized.connectionId = connectionId;
    }
    return normalized;
  }

  private renderContent(
    workspaceId: string,
    event: NormalizedWebhook,
    domain: string | undefined,
  ): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeMailgunObjectType(event.objectType),
      objectId: event.objectId,
      domain: domain ?? null,
      payload: event.payload,
    });
  }
}

function applyMessageSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: MailgunRecord,
): void {
  const message = payload as Partial<MailgunMessagePayload> & MailgunRecord;
  addFirstStringProperty(properties, 'mailgun.message_id', message.messageId, message.message_id, message.id);
  addStringProperty(properties, 'mailgun.subject', message.subject);
  addFirstStringProperty(properties, 'mailgun.from', message.from, message.sender);
  addStringProperty(properties, 'mailgun.sender', message.sender);
  addFirstStringProperty(properties, 'mailgun.created_at', message.createdAt, message.created_at);
  addStringProperty(properties, 'mailgun.timestamp', message.timestamp);
  addNumberProperty(properties, 'mailgun.size', message.size);

  const recipients = collectRecipients(message.to, message.recipient, message.recipients);
  if (recipients.length > 0) {
    properties['mailgun.recipients'] = recipients.join(', ');
    properties['mailgun.recipient_count'] = String(recipients.length);
    for (const recipient of recipients) {
      relations.add(`mailto:${recipient}`);
    }
  }

  const cc = collectRecipients(message.cc);
  if (cc.length > 0) {
    properties['mailgun.cc'] = cc.join(', ');
  }

  const bcc = collectRecipients(message.bcc);
  if (bcc.length > 0) {
    properties['mailgun.bcc'] = bcc.join(', ');
  }

  const tags = asStringArray(message.tags);
  if (tags.length > 0) {
    properties['mailgun.tags'] = tags.sort((left, right) => left.localeCompare(right)).join(', ');
  }

  const campaigns = asStringArray(message.campaigns);
  if (campaigns.length > 0) {
    properties['mailgun.campaigns'] = campaigns.sort((left, right) => left.localeCompare(right)).join(', ');
  }

  const storage = getRecord(message.storage);
  if (storage) {
    addStringProperty(properties, 'mailgun.storage_key', storage.key);
    addStringProperty(properties, 'mailgun.storage_url', storage.url);
  }

  const text = readOptionalString(message.text);
  if (text) {
    comments.push(text);
    properties['mailgun.text_length'] = String(text.length);
  }
}

function applyEventSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: MailgunRecord,
  defaultDomain: string | undefined,
): void {
  const event = payload as Partial<MailgunEventPayload> & MailgunRecord;
  addStringProperty(properties, 'mailgun.event', event.event);
  addStringProperty(properties, 'mailgun.severity', event.severity);
  addStringProperty(properties, 'mailgun.reason', event.reason);
  addStringProperty(properties, 'mailgun.recipient', event.recipient);
  addStringProperty(properties, 'mailgun.timestamp', event.timestamp);

  const eventName = readOptionalString(event.event);
  if (eventName) {
    properties['mailgun.event_category'] = categorizeEvent(eventName);
  }

  const recipient = readOptionalString(event.recipient);
  if (recipient) {
    relations.add(`mailto:${recipient}`);
  }

  const message = getRecord(event.message);
  if (message) {
    const messageId = readOptionalString(message.id) ??
      readOptionalString(message.messageId) ??
      readOptionalString(message.message_id) ??
      readOptionalString(message.headers && getRecord(message.headers)?.['message-id']);
    if (messageId) {
      relations.add(mailgunMessagePath(messageId, readDomain(payload, defaultDomain)));
      addStringProperty(properties, 'mailgun.message_id', messageId);
    }
    addStringProperty(properties, 'mailgun.subject', message.subject);
  }

  const envelope = getRecord(event.envelope);
  if (envelope) {
    addStringProperty(properties, 'mailgun.envelope_sender', envelope.sender);
    addStringProperty(properties, 'mailgun.envelope_targets', envelope.targets);
    addStringProperty(properties, 'mailgun.envelope_transport', envelope.transport);
  }

  const deliveryStatus = getRecord(event.deliveryStatus) ?? getRecord(event.delivery_status);
  if (deliveryStatus) {
    addNumberProperty(properties, 'mailgun.delivery_status_code', deliveryStatus.code);
    addStringProperty(properties, 'mailgun.delivery_status_description', deliveryStatus.description);
    addStringProperty(properties, 'mailgun.delivery_status_message', deliveryStatus.message);
    const messageText = readOptionalString(deliveryStatus.message);
    if (messageText) comments.push(messageText);
  }

  const geolocation = getRecord(event.geolocation);
  if (geolocation) {
    addStringProperty(properties, 'mailgun.geo_city', geolocation.city);
    addStringProperty(properties, 'mailgun.geo_country', geolocation.country);
    addStringProperty(properties, 'mailgun.geo_region', geolocation.region);
  }

  const tags = asStringArray(event.tags);
  if (tags.length > 0) {
    properties['mailgun.tags'] = tags.sort((left, right) => left.localeCompare(right)).join(', ');
  }
}

function applyListSemantics(
  properties: Record<string, string>,
  payload: MailgunRecord,
): void {
  const list = payload as Partial<MailgunListPayload> & MailgunRecord;
  addStringProperty(properties, 'mailgun.list.address', list.address);
  addStringProperty(properties, 'mailgun.list.name', list.name);
  addStringProperty(properties, 'mailgun.list.description', list.description);
  addFirstStringProperty(properties, 'mailgun.list.access_level', list.accessLevel, list.access_level);
  addFirstStringProperty(properties, 'mailgun.list.reply_preference', list.replyPreference, list.reply_preference);
  addFirstStringProperty(properties, 'mailgun.created_at', list.createdAt, list.created_at);
  addFirstNumberProperty(properties, 'mailgun.list.members_count', list.membersCount, list.members_count);
}

function unwrapMailgunPayload(event: MailgunWebhookPayload): MailgunRecord {
  const data = event['event-data'] ?? event.eventData ?? event.data;
  if (isRecord(data)) {
    return data;
  }
  if (isRecord(event.message)) {
    return event.message;
  }
  return event as MailgunRecord;
}

function inferObjectType(
  payload: MailgunRecord,
  envelope: MailgunWebhookPayload,
): 'event' | 'list' | 'message' {
  const explicitType = readOptionalString(payload.object) ??
    readOptionalString(payload.objectType) ??
    readOptionalString(payload.type) ??
    readOptionalString(envelope.event);
  if (explicitType) {
    const normalized = tryMailgunType(explicitType);
    if (normalized) return normalized;
  }

  if (readOptionalString(payload.address) && !readOptionalString(payload.recipient)) {
    return 'list';
  }
  if (readOptionalString(payload.event) || isRecord(envelope['event-data'])) {
    return 'event';
  }
  return 'message';
}

function inferAction(
  objectType: 'event' | 'list' | 'message',
  payload: MailgunRecord,
  envelope: MailgunWebhookPayload,
): string {
  const explicit = readOptionalString(payload.action) ??
    readOptionalString(payload.event) ??
    readOptionalString(envelope.event);
  if (explicit) {
    return normalizeAction(explicit);
  }

  switch (objectType) {
    case 'event':
      return 'stored';
    case 'list':
      return 'updated';
    case 'message':
      return 'stored';
  }
}

function extractObjectId(
  objectType: 'event' | 'list' | 'message',
  payload: MailgunRecord,
  envelope: MailgunWebhookPayload,
): string {
  const direct = readOptionalString(payload.id) ??
    readOptionalString(payload.messageId) ??
    readOptionalString(payload.message_id) ??
    readOptionalString(payload['Message-Id']) ??
    readOptionalString(payload['message-id']);
  if (direct) return direct;

  if (objectType === 'list') {
    const address = readOptionalString(payload.address);
    if (address) return address;
  }

  if (objectType === 'event') {
    const message = getRecord(payload.message);
    const messageId = message
      ? readOptionalString(message.id) ??
        readOptionalString(message.messageId) ??
        readOptionalString(message.message_id)
      : undefined;
    const timestamp = readOptionalString(payload.timestamp) ?? readOptionalString(envelope.timestamp);
    const recipient = readOptionalString(payload.recipient) ?? readOptionalString(envelope.recipient);
    const eventName = readOptionalString(payload.event) ?? readOptionalString(envelope.event);
    const synthetic = [eventName, messageId, recipient, timestamp]
      .filter((part): part is string => Boolean(part))
      .join(':');
    if (synthetic) return synthetic;
  }

  throw new Error(`Mailgun ${objectType} webhook is missing an object id`);
}

function mergeMailgunPayload(
  envelope: MailgunWebhookPayload,
  payload: MailgunRecord,
  objectType: string,
  objectId: string,
  action: string,
): MailgunRecord {
  const merged: MailgunRecord = {
    ...payload,
  };
  const domain = readDomain(payload, readOptionalString(envelope.domain));
  if (domain) {
    merged.domain = domain;
  }
  const metadata = getRecord(envelope.metadata);
  if (metadata) {
    merged.metadata = metadata;
  }
  const signature = getRecord(envelope.signature);
  const webhook: MailgunRecord = {
    action,
    eventType: `${objectType}.${action}`,
    objectId,
    objectType,
  };
  if (signature) {
    addMaybe(webhook, 'timestamp', signature.timestamp);
    addMaybe(webhook, 'token', signature.token);
  }
  addMaybe(webhook, 'timestamp', envelope.timestamp);
  merged._webhook = webhook;

  const connection = buildConnectionMetadata(envelope);
  if (Object.keys(connection).length > 0) {
    merged._connection = connection;
  }
  return merged;
}

function buildConnectionMetadata(envelope: MailgunWebhookPayload): MailgunRecord {
  const connection: MailgunRecord = {};
  addMaybe(connection, 'connectionId', envelope.connectionId ?? envelope.connection_id);
  addMaybe(connection, 'provider', envelope.provider ?? MAILGUN_PROVIDER_NAME);
  addMaybe(connection, 'providerConfigKey', envelope.providerConfigKey ?? envelope.provider_config_key);
  return connection;
}

function inferFallbackPath(
  event: NormalizedWebhook | MailgunWebhookPayload,
  defaultDomain: string | undefined,
): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeMailgunPath(
        event.objectType,
        event.objectId || 'unknown',
        readDomain(event.payload, defaultDomain),
      );
    }
    const payload = unwrapMailgunPayload(event);
    const type = inferObjectType(payload, event);
    const id = extractObjectId(type, payload, event);
    return computeMailgunPath(type, id, readDomain(payload, defaultDomain));
  } catch {
    return `${mailgunEventPath('unknown', defaultDomain)}`;
  }
}

function normalizeMailgunEventType(eventType: string, objectType: string): string {
  const trimmed = eventType.trim().toLowerCase();
  if (trimmed.includes('.')) return trimmed;
  return `${normalizeMailgunObjectType(objectType)}.${normalizeAction(trimmed)}`;
}

function normalizeAction(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (normalized === 'permanent_failure') return 'permanent_fail';
  return normalized || 'updated';
}

function tryMailgunType(value: string): 'event' | 'list' | 'message' | undefined {
  try {
    return normalizeMailgunObjectType(value);
  } catch {
    return undefined;
  }
}

function collectRecipients(
  ...values: unknown[]
): string[] {
  const recipients = new Set<string>();
  for (const value of values) {
    for (const recipient of flattenRecipients(value)) {
      recipients.add(recipient);
    }
  }
  return [...recipients].sort((left, right) => left.localeCompare(right));
}

function flattenRecipients(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenRecipients(item));
  }
  if (isRecord(value)) {
    const email = readOptionalString(value.email) ?? readOptionalString(value.address);
    return email ? [email] : [];
  }
  return [];
}

function categorizeEvent(eventName: string): string {
  switch (normalizeAction(eventName)) {
    case 'accepted':
    case 'delivered':
    case 'stored':
      return 'delivery';
    case 'clicked':
    case 'opened':
      return 'engagement';
    case 'complained':
    case 'failed':
    case 'permanent_fail':
    case 'unsubscribed':
      return 'risk';
    default:
      return 'other';
  }
}

function readDomain(
  payload: Record<string, unknown>,
  fallback: string | undefined,
): string | undefined {
  const direct = readOptionalString(payload.domain);
  if (direct) return direct;
  const envelope = getRecord(payload.envelope);
  const sendingDomain = envelope ? readOptionalString(envelope.sending_domain) : undefined;
  if (sendingDomain) return sendingDomain;
  return fallback;
}

function isNormalizedWebhook(event: unknown): event is NormalizedWebhook {
  if (!isRecord(event)) return false;
  return typeof event.eventType === 'string' &&
    typeof event.objectType === 'string' &&
    typeof event.objectId === 'string' &&
    isRecord(event.payload);
}

function inferWriteCounts(writeResult: WriteFileResult | void): { filesUpdated: number; filesWritten: number } {
  if (!writeResult) {
    return { filesWritten: 1, filesUpdated: 0 };
  }
  if (writeResult.status === 'updated' || writeResult.updated) {
    return { filesWritten: 0, filesUpdated: 1 };
  }
  if (writeResult.status === 'created' || writeResult.created) {
    return { filesWritten: 1, filesUpdated: 0 };
  }
  return { filesWritten: 1, filesUpdated: 0 };
}

function addStringProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  const stringValue = readOptionalString(value);
  if (stringValue) {
    properties[key] = stringValue;
  }
}

function addFirstStringProperty(
  properties: Record<string, string>,
  key: string,
  ...values: unknown[]
): void {
  for (const value of values) {
    const stringValue = readOptionalString(value);
    if (stringValue) {
      properties[key] = stringValue;
      return;
    }
  }
}

function addNumberProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  const numberValue = asNumber(value);
  if (numberValue !== undefined) {
    properties[key] = String(numberValue);
  }
}

function addFirstNumberProperty(
  properties: Record<string, string>,
  key: string,
  ...values: unknown[]
): void {
  for (const value of values) {
    const numberValue = asNumber(value);
    if (numberValue !== undefined) {
      properties[key] = String(numberValue);
      return;
    }
  }
}

function addMaybe(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
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

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactSemantics(semantics: FileSemantics): FileSemantics {
  const compacted: FileSemantics = {};
  if (semantics.properties && Object.keys(semantics.properties).length > 0) {
    compacted.properties = Object.fromEntries(
      Object.entries(semantics.properties).sort(([left], [right]) => left.localeCompare(right)),
    );
  }
  if (semantics.relations && semantics.relations.length > 0) {
    compacted.relations = semantics.relations;
  }
  if (semantics.permissions && semantics.permissions.length > 0) {
    compacted.permissions = semantics.permissions;
  }
  if (semantics.comments && semantics.comments.length > 0) {
    compacted.comments = semantics.comments;
  }
  return compacted;
}

function sortStrings(values: Set<string>): string[] {
  return [...values]
    .filter((value) => value.trim().length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJsonValue(nested)]),
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
