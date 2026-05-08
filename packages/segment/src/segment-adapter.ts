import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeSegmentPath,
  normalizeSegmentObjectType,
  segmentGroupPath,
  segmentIdentifyPath,
  segmentPagePath,
  segmentTrackPath,
} from './path-mapper.js';
import { SEGMENT_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  SegmentAdapterConfig,
  SegmentContext,
  SegmentGroupPayload,
  SegmentIdentifyPayload,
  SegmentPagePayload,
  SegmentTrackPayload,
  SegmentWebhookPayload,
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | SegmentWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;

  supportedEvents?(): string[];
}

type SegmentRecord = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SEGMENT_PROVIDER_NAME = 'segment';
const SUPPORTED_EVENTS = SEGMENT_WEBHOOK_OBJECT_TYPES;

export class SegmentAdapter extends IntegrationAdapter {
  override readonly name = SEGMENT_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: SegmentAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: SegmentAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => [
      `${objectType}.create`,
      `${objectType}.update`,
      `${objectType}.upsert`,
    ]);
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | SegmentWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = this.computePathWithPayload(normalized.objectType, normalized.objectId, normalized.payload);
      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content: this.renderContent(workspaceId, normalized),
        contentType: JSON_CONTENT_TYPE,
        semantics: this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload),
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
      const fallbackPath = inferFallbackPath(event);
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

  override computePath(objectType: string, objectId: string, displayName?: string): string {
    return computeSegmentPath(objectType, objectId, displayName);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeSegmentObjectType(objectType);
    const properties: Record<string, string> = {
      provider: SEGMENT_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'segment.id': objectId,
      'segment.object_type': normalizedType,
    };
    const relations = new Set<string>();

    addFirstStringProperty(properties, 'segment.message_id', payload.messageId, payload.message_id);
    addFirstStringProperty(properties, 'segment.user_id', payload.userId, payload.user_id);
    addFirstStringProperty(properties, 'segment.anonymous_id', payload.anonymousId, payload.anonymous_id);
    addFirstStringProperty(properties, 'segment.group_id', payload.groupId, payload.group_id);
    addFirstStringProperty(properties, 'segment.write_key', payload.writeKey, payload.write_key);
    addFirstStringProperty(properties, 'segment.sent_at', payload.sentAt, payload.sent_at);
    addFirstStringProperty(properties, 'segment.received_at', payload.receivedAt, payload.received_at);
    addFirstStringProperty(properties, 'segment.timestamp', payload.timestamp);
    addFirstStringProperty(properties, 'segment.original_timestamp', payload.originalTimestamp, payload.original_timestamp);

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'segment.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'segment.webhook.object_id', webhook.objectId);
      addStringProperty(properties, 'segment.webhook.object_type', webhook.objectType);
      addStringProperty(properties, 'segment.webhook.delivery_id', webhook.deliveryId);
      addStringProperty(properties, 'segment.webhook.source_id', webhook.sourceId);
      addNumberProperty(properties, 'segment.webhook.timestamp_ms', webhook.timestamp);
    }

    const connection = getRecord(payload._connection);
    if (connection) {
      addStringProperty(properties, 'segment.connection_id', connection.connectionId);
      addStringProperty(properties, 'segment.provider_config_key', connection.providerConfigKey);
      addStringProperty(properties, 'segment.request_id', connection.requestId);
      addStringProperty(properties, 'segment.source_id', connection.sourceId);
    }

    applyContextSemantics(properties, payload.context);

    switch (normalizedType) {
      case 'identify':
        this.applyIdentifySemantics(properties, relations, payload as SegmentRecord);
        break;
      case 'track':
        this.applyTrackSemantics(properties, relations, payload as SegmentRecord);
        break;
      case 'page':
        this.applyPageSemantics(properties, relations, payload as SegmentRecord);
        break;
      case 'group':
        this.applyGroupSemantics(properties, relations, payload as SegmentRecord);
        break;
    }

    const semantics: FileSemantics = {
      properties,
      relations: sortStrings(relations),
    };
    return compactSemantics(semantics);
  }

  identifyPath(payload: SegmentIdentifyPayload | Record<string, unknown>): string {
    const record = payload as unknown as Record<string, unknown>;
    const objectId = readSegmentIdentity(record);
    return segmentIdentifyPath(objectId);
  }

  trackPath(payload: SegmentTrackPayload | Record<string, unknown>): string {
    const record = payload as unknown as Record<string, unknown>;
    const objectId = readSegmentMessageId(record);
    return segmentTrackPath(objectId, asString(record.event));
  }

  pagePath(payload: SegmentPagePayload | Record<string, unknown>): string {
    const record = payload as unknown as Record<string, unknown>;
    const objectId = readSegmentMessageId(record);
    return segmentPagePath(objectId, asString(record.name) ?? readPageTitle(record));
  }

  groupPath(payload: SegmentGroupPayload | Record<string, unknown>): string {
    const record = payload as unknown as Record<string, unknown>;
    const objectId = readSegmentGroupId(record);
    return segmentGroupPath(objectId);
  }

  private normalizeEvent(event: NormalizedWebhook | SegmentWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalizedType = normalizeSegmentObjectType(event.objectType);
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || SEGMENT_PROVIDER_NAME,
        eventType: event.eventType,
        objectType: normalizedType,
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const objectType = normalizeSegmentObjectType(event.type);
    const objectId = extractSegmentPayloadObjectId(objectType, event as unknown as SegmentRecord);
    const eventType = `${objectType}.upsert`;
    const payload = mergeSegmentPayload(event as unknown as SegmentRecord, {
      eventType,
      objectId,
      objectType,
    });

    const normalized: NormalizedWebhook = {
      provider: this.config.provider || SEGMENT_PROVIDER_NAME,
      eventType,
      objectType,
      objectId,
      payload,
    };
    if (this.config.connectionId) {
      normalized.connectionId = this.config.connectionId;
    }
    return normalized;
  }

  private computePathWithPayload(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): string {
    const normalizedType = normalizeSegmentObjectType(objectType);
    switch (normalizedType) {
      case 'identify':
        return segmentIdentifyPath(objectId);
      case 'track':
        return segmentTrackPath(objectId, asString(payload.event));
      case 'page':
        return segmentPagePath(objectId, asString(payload.name) ?? readPageTitle(payload));
      case 'group':
        return segmentGroupPath(objectId);
    }
  }

  private applyIdentifySemantics(
    properties: Record<string, string>,
    relations: Set<string>,
    payload: SegmentRecord,
  ): void {
    const identify = payload as Partial<SegmentIdentifyPayload> & SegmentRecord;
    const userId = asString(identify.userId) ?? asString(identify.user_id);
    const anonymousId = asString(identify.anonymousId) ?? asString(identify.anonymous_id);

    addStringProperty(properties, 'segment.identify.user_id', userId);
    addStringProperty(properties, 'segment.identify.anonymous_id', anonymousId);
    if (userId) {
      relations.add(segmentIdentifyPath(userId));
    }

    const traits = getRecord(identify.traits);
    if (traits) {
      addRecordProperties(properties, 'segment.trait', traits, [
        'email',
        'name',
        'username',
        'company',
        'plan',
        'title',
      ]);
      properties['segment.trait_count'] = String(Object.keys(traits).length);
      const email = asString(traits.email);
      if (email) {
        properties['segment.identity.email'] = email;
      }
    }

    const contextTraits = getRecord(getRecord(identify.context)?.traits);
    if (contextTraits) {
      addRecordProperties(properties, 'segment.context.trait', contextTraits, ['email', 'name', 'company']);
    }
  }

  private applyTrackSemantics(
    properties: Record<string, string>,
    relations: Set<string>,
    payload: SegmentRecord,
  ): void {
    const track = payload as Partial<SegmentTrackPayload> & SegmentRecord;
    addStringProperty(properties, 'segment.track.event', track.event);

    const userId = asString(track.userId) ?? asString(track.user_id);
    if (userId) {
      relations.add(segmentIdentifyPath(userId));
      properties['segment.track.user_id'] = userId;
    }

    const groupId = asString(track.groupId) ?? asString(track.group_id) ?? asString(getRecord(track.properties)?.groupId);
    if (groupId) {
      relations.add(segmentGroupPath(groupId));
      properties['segment.track.group_id'] = groupId;
    }

    const propertiesRecord = getRecord(track.properties);
    if (propertiesRecord) {
      addRecordProperties(properties, 'segment.property', propertiesRecord, [
        'category',
        'label',
        'revenue',
        'currency',
        'orderId',
        'productId',
        'plan',
      ]);
      properties['segment.property_count'] = String(Object.keys(propertiesRecord).length);
      addRevenueProperties(properties, propertiesRecord);
    }
  }

  private applyPageSemantics(
    properties: Record<string, string>,
    relations: Set<string>,
    payload: SegmentRecord,
  ): void {
    const page = payload as Partial<SegmentPagePayload> & SegmentRecord;
    addStringProperty(properties, 'segment.page.name', page.name);
    addStringProperty(properties, 'segment.page.category', page.category);

    const userId = asString(page.userId) ?? asString(page.user_id);
    if (userId) {
      relations.add(segmentIdentifyPath(userId));
      properties['segment.page.user_id'] = userId;
    }

    const propertiesRecord = getRecord(page.properties);
    if (propertiesRecord) {
      addRecordProperties(properties, 'segment.page.property', propertiesRecord, [
        'path',
        'referrer',
        'search',
        'title',
        'url',
      ]);
    }

    const contextPage = getRecord(getRecord(page.context)?.page);
    if (contextPage) {
      addRecordProperties(properties, 'segment.context.page', contextPage, [
        'path',
        'referrer',
        'search',
        'title',
        'url',
      ]);
    }
  }

  private applyGroupSemantics(
    properties: Record<string, string>,
    relations: Set<string>,
    payload: SegmentRecord,
  ): void {
    const group = payload as Partial<SegmentGroupPayload> & SegmentRecord;
    const groupId = asString(group.groupId) ?? asString(group.group_id);
    addStringProperty(properties, 'segment.group.group_id', groupId);
    if (groupId) {
      relations.add(segmentGroupPath(groupId));
    }

    const userId = asString(group.userId) ?? asString(group.user_id);
    if (userId) {
      relations.add(segmentIdentifyPath(userId));
      properties['segment.group.user_id'] = userId;
    }

    const traits = getRecord(group.traits);
    if (traits) {
      addRecordProperties(properties, 'segment.group.trait', traits, [
        'name',
        'industry',
        'employees',
        'plan',
        'website',
      ]);
      properties['segment.group.trait_count'] = String(Object.keys(traits).length);
    }
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeSegmentObjectType(event.objectType),
      objectId: event.objectId,
      payload: event.payload,
    });
  }
}

function applyContextSemantics(properties: Record<string, string>, contextValue: unknown): void {
  const context = getRecord(contextValue) as (SegmentContext & SegmentRecord) | undefined;
  if (!context) {
    return;
  }

  addStringProperty(properties, 'segment.context.ip', context.ip);
  addStringProperty(properties, 'segment.context.locale', context.locale);
  addStringProperty(properties, 'segment.context.timezone', context.timezone);
  addFirstStringProperty(properties, 'segment.context.user_agent', context.userAgent, context.user_agent);

  const library = getRecord(context.library);
  if (library) {
    addStringProperty(properties, 'segment.context.library_name', library.name);
    addStringProperty(properties, 'segment.context.library_version', library.version);
  }

  const campaign = getRecord(context.campaign);
  if (campaign) {
    addStringProperty(properties, 'segment.context.campaign_name', campaign.name);
    addStringProperty(properties, 'segment.context.campaign_source', campaign.source);
    addStringProperty(properties, 'segment.context.campaign_medium', campaign.medium);
    addStringProperty(properties, 'segment.context.campaign_term', campaign.term);
    addStringProperty(properties, 'segment.context.campaign_content', campaign.content);
  }

  const page = getRecord(context.page);
  if (page) {
    addStringProperty(properties, 'segment.context.page_path', page.path);
    addStringProperty(properties, 'segment.context.page_title', page.title);
    addStringProperty(properties, 'segment.context.page_url', page.url);
    addStringProperty(properties, 'segment.context.page_referrer', page.referrer);
  }

  const device = getRecord(context.device);
  if (device) {
    addStringProperty(properties, 'segment.context.device_id', device.id);
    addStringProperty(properties, 'segment.context.device_manufacturer', device.manufacturer);
    addStringProperty(properties, 'segment.context.device_model', device.model);
    addStringProperty(properties, 'segment.context.device_type', device.type);
  }

  const os = getRecord(context.os);
  if (os) {
    addStringProperty(properties, 'segment.context.os_name', os.name);
    addStringProperty(properties, 'segment.context.os_version', os.version);
  }
}

function mergeSegmentPayload(
  payload: SegmentRecord,
  webhook: { eventType: string; objectId: string; objectType: string },
): SegmentRecord {
  return {
    ...payload,
    _webhook: {
      eventType: webhook.eventType,
      objectId: webhook.objectId,
      objectType: webhook.objectType,
    },
  };
}

function extractSegmentPayloadObjectId(objectType: string, payload: SegmentRecord): string {
  const normalizedType = normalizeSegmentObjectType(objectType);
  switch (normalizedType) {
    case 'identify':
      return readSegmentIdentity(payload);
    case 'track':
      return readSegmentMessageId(payload);
    case 'page':
      return readSegmentMessageId(payload);
    case 'group':
      return readSegmentGroupId(payload);
  }
}

function readSegmentIdentity(payload: Record<string, unknown>): string {
  const userId = asString(payload.userId) ?? asString(payload.user_id);
  const anonymousId = asString(payload.anonymousId) ?? asString(payload.anonymous_id);
  const messageId = asString(payload.messageId) ?? asString(payload.message_id);
  const objectId = userId ?? anonymousId ?? messageId;
  if (!objectId) {
    throw new Error('Segment identify payload is missing userId, anonymousId, and messageId');
  }
  return objectId;
}

function readSegmentMessageId(payload: Record<string, unknown>): string {
  const messageId = asString(payload.messageId) ?? asString(payload.message_id);
  if (!messageId) {
    throw new Error('Segment event payload is missing messageId');
  }
  return messageId;
}

function readSegmentGroupId(payload: Record<string, unknown>): string {
  const groupId = asString(payload.groupId) ?? asString(payload.group_id);
  const messageId = asString(payload.messageId) ?? asString(payload.message_id);
  const objectId = groupId ?? messageId;
  if (!objectId) {
    throw new Error('Segment group payload is missing groupId and messageId');
  }
  return objectId;
}

function readPageTitle(payload: Record<string, unknown>): string | undefined {
  const properties = getRecord(payload.properties);
  const context = getRecord(payload.context);
  const contextPage = getRecord(context?.page);
  return (
    asString(properties?.title) ??
    asString(contextPage?.title) ??
    asString(properties?.url) ??
    asString(contextPage?.url)
  );
}

function inferFallbackPath(event: NormalizedWebhook | SegmentWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      const objectType = normalizeSegmentObjectType(event.objectType);
      const displayName = objectType === 'track'
        ? asString(event.payload.event)
        : objectType === 'page'
          ? asString(event.payload.name) ?? readPageTitle(event.payload)
          : undefined;
      return computeSegmentPath(objectType, event.objectId, displayName);
    }
    const payload = event as unknown as SegmentRecord;
    const objectType = normalizeSegmentObjectType(event.type);
    const objectId = extractSegmentPayloadObjectId(objectType, payload);
    const displayName = objectType === 'track'
      ? asString(payload.event)
      : objectType === 'page'
        ? asString(payload.name) ?? readPageTitle(payload)
        : undefined;
    return computeSegmentPath(objectType, objectId, displayName);
  } catch {
    return '/segment/errors/unmapped-webhook.json';
  }
}

function inferWriteCounts(writeResult: WriteFileResult | void): { filesWritten: number; filesUpdated: number } {
  if (!writeResult) {
    return { filesWritten: 0, filesUpdated: 1 };
  }
  if (writeResult.created || writeResult.status === 'created') {
    return { filesWritten: 1, filesUpdated: 0 };
  }
  if (writeResult.updated || writeResult.status === 'updated') {
    return { filesWritten: 0, filesUpdated: 1 };
  }
  if (writeResult.status === 'queued' || writeResult.status === 'pending') {
    return { filesWritten: 0, filesUpdated: 1 };
  }
  return { filesWritten: 0, filesUpdated: 1 };
}

function isNormalizedWebhook(event: NormalizedWebhook | SegmentWebhookPayload): event is NormalizedWebhook {
  const candidate = event as Partial<NormalizedWebhook>;
  return (
    typeof candidate.provider === 'string' &&
    typeof candidate.eventType === 'string' &&
    typeof candidate.objectType === 'string' &&
    typeof candidate.objectId === 'string' &&
    isRecord(candidate.payload)
  );
}

function addRevenueProperties(properties: Record<string, string>, payload: SegmentRecord): void {
  const revenue = asNumber(payload.revenue) ?? asNumber(payload.value) ?? asNumber(payload.total);
  if (revenue !== undefined) {
    properties['segment.revenue'] = String(revenue);
  }
  const currency = asString(payload.currency);
  if (currency) {
    properties['segment.currency'] = currency.toUpperCase();
  }
}

function addRecordProperties(
  properties: Record<string, string>,
  prefix: string,
  payload: SegmentRecord,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      properties[`${prefix}.${toSnakeCase(key)}`] = String(value);
    }
  }
}

function addStringProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const stringValue = asString(value);
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
    const stringValue = asString(value);
    if (stringValue) {
      properties[key] = stringValue;
      return;
    }
  }
}

function addNumberProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const numberValue = asNumber(value);
  if (numberValue !== undefined) {
    properties[key] = String(numberValue);
  }
}

function compactSemantics(semantics: FileSemantics): FileSemantics {
  const compacted: FileSemantics = {};
  if (semantics.properties && Object.keys(semantics.properties).length > 0) {
    compacted.properties = sortRecord(semantics.properties);
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
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortRecord(input: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const key of Object.keys(input).sort((left, right) => left.localeCompare(right))) {
    output[key] = input[key] ?? '';
  }
  return output;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }
  if (isRecord(value)) {
    const result: SegmentRecord = {};
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      result[key] = sortJson(value[key]);
    }
    return result;
  }
  return value;
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, '');
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getRecord(value: unknown): SegmentRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is SegmentRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
