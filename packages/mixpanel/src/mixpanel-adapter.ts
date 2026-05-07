import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeMixpanelPath,
  mixpanelCohortPath,
  mixpanelEventPath,
  mixpanelProfilePath,
  normalizeMixpanelObjectType,
} from './path-mapper.js';
import { MIXPANEL_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  MixpanelAdapterConfig,
  MixpanelCohort,
  MixpanelEvent,
  MixpanelProfile,
  MixpanelWebhookPayload,
} from './types.js';

export interface FileSemantics {
  comments?: string[];
  permissions?: string[];
  properties?: Record<string, string>;
  relations?: string[];
}

export interface IngestError {
  error: string;
  path: string;
}

export interface IngestResult {
  errors: IngestError[];
  filesDeleted: number;
  filesUpdated: number;
  filesWritten: number;
  paths: string[];
}

export interface NormalizedWebhook {
  connectionId?: string;
  eventType: string;
  objectId: string;
  objectType: string;
  payload: Record<string, unknown>;
  provider: string;
}

export interface WriteFileInput {
  content: string;
  contentType?: string;
  path: string;
  semantics?: FileSemantics;
  workspaceId: string;
}

export interface WriteFileResult {
  created?: boolean;
  status?: 'created' | 'pending' | 'queued' | 'updated';
  updated?: boolean;
}

export interface DeleteFileInput {
  path: string;
  workspaceId: string;
}

export interface RelayFileClientLike {
  deleteFile?(input: DeleteFileInput): Promise<void> | void;
  writeFile(input: WriteFileInput): Promise<WriteFileResult | void>;
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

  abstract ingestWebhook(
    workspaceId: string,
    event: MixpanelWebhookPayload | NormalizedWebhook
  ): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string, label?: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  supportedEvents?(): string[];
}

type MixpanelRecord = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const MIXPANEL_PROVIDER_NAME = 'mixpanel';
const SUPPORTED_EVENTS = MIXPANEL_WEBHOOK_OBJECT_TYPES;

export class MixpanelAdapter extends IntegrationAdapter {
  override readonly name = MIXPANEL_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: MixpanelAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: MixpanelAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => [
      `${objectType}.create`,
      `${objectType}.update`,
      `${objectType}.delete`,
      `${objectType}.merge`,
    ]);
  }

  override async ingestWebhook(
    workspaceId: string,
    event: MixpanelWebhookPayload | NormalizedWebhook,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = this.pathForNormalizedEvent(normalized);
      const semantics = this.computeSemantics(
        normalized.objectType,
        normalized.objectId,
        normalized.payload,
      );

      if (this.isDeleteEvent(normalized)) {
        return await this.deleteOrTombstone(workspaceId, normalized, path, semantics);
      }

      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content: this.renderContent(workspaceId, normalized, false),
        contentType: JSON_CONTENT_TYPE,
        semantics,
      });

      const counts = inferWriteCounts(normalized, writeResult, false);
      return {
        errors: [],
        filesDeleted: 0,
        filesUpdated: counts.filesUpdated,
        filesWritten: counts.filesWritten,
        paths: [path],
      };
    } catch (error) {
      const fallbackPath = inferFallbackPath(event);
      return {
        errors: [
          {
            path: fallbackPath,
            error: toErrorMessage(error),
          },
        ],
        filesDeleted: 0,
        filesUpdated: 0,
        filesWritten: 0,
        paths: fallbackPath ? [fallbackPath] : [],
      };
    }
  }

  override computePath(objectType: string, objectId: string, label?: string): string {
    return computeMixpanelPath(objectType, objectId, label);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeMixpanelObjectType(objectType);
    const properties: Record<string, string> = {
      provider: MIXPANEL_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'mixpanel.id': objectId,
      'mixpanel.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'mixpanel.webhook.action', webhook.action);
      addStringProperty(properties, 'mixpanel.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'mixpanel.webhook.project_id', webhook.projectId);
      addStringProperty(properties, 'mixpanel.webhook.request_id', webhook.requestId);
      addNumberProperty(properties, 'mixpanel.webhook.timestamp', webhook.timestamp);
    }

    switch (normalizedType) {
      case 'event':
        this.applyEventSemantics(properties, relations, payload as MixpanelRecord);
        break;
      case 'profile':
        this.applyProfileSemantics(properties, relations, comments, payload as MixpanelRecord);
        break;
      case 'cohort':
        this.applyCohortSemantics(properties, relations, payload as MixpanelRecord);
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

  private normalizeEvent(event: MixpanelWebhookPayload | NormalizedWebhook): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const objectType = normalizeMixpanelObjectType(event.objectType);
      const objectId = event.objectId.trim();
      if (!objectId) {
        throw new Error(`Mixpanel ${objectType} webhook is missing object id`);
      }

      const normalized: NormalizedWebhook = {
        eventType: event.eventType,
        objectId,
        objectType,
        payload: event.payload,
        provider: event.provider || this.config.provider || MIXPANEL_PROVIDER_NAME,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const objectType = normalizeMixpanelObjectType(event.type);
    const objectId = extractPayloadId(event.data, objectType);
    if (!objectId) {
      throw new Error(`Mixpanel ${objectType} webhook is missing data.id`);
    }

    const payload = mergeMixpanelPayload(event);
    const normalized: NormalizedWebhook = {
      eventType: readEventType(event, objectType),
      objectId,
      objectType,
      payload,
      provider: this.config.provider || MIXPANEL_PROVIDER_NAME,
    };
    if (this.config.connectionId) {
      normalized.connectionId = this.config.connectionId;
    }
    return normalized;
  }

  private pathForNormalizedEvent(event: NormalizedWebhook): string {
    const objectType = normalizeMixpanelObjectType(event.objectType);
    switch (objectType) {
      case 'event':
        return mixpanelEventPath(event.objectId, readEventLabel(event.payload));
      case 'profile':
        return mixpanelProfilePath(event.objectId);
      case 'cohort':
        return mixpanelCohortPath(event.objectId);
    }
  }

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
    return action === 'delete' || action === 'remove';
  }

  private async deleteOrTombstone(
    workspaceId: string,
    event: NormalizedWebhook,
    path: string,
    semantics: FileSemantics,
  ): Promise<IngestResult> {
    if (this.client.deleteFile) {
      await this.client.deleteFile({ workspaceId, path });
      return {
        errors: [],
        filesDeleted: 1,
        filesUpdated: 0,
        filesWritten: 0,
        paths: [path],
      };
    }

    const deleteResult = await this.client.writeFile({
      workspaceId,
      path,
      content: this.renderContent(workspaceId, event, true),
      contentType: JSON_CONTENT_TYPE,
      semantics,
    });

    const counts = inferWriteCounts(event, deleteResult, true);
    return {
      errors: [],
      filesDeleted: counts.filesDeleted,
      filesUpdated: counts.filesUpdated,
      filesWritten: counts.filesWritten,
      paths: [path],
    };
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      connectionId: event.connectionId ?? null,
      deleted,
      eventType: event.eventType,
      objectId: event.objectId,
      objectType: normalizeMixpanelObjectType(event.objectType),
      payload: event.payload,
      provider: event.provider,
      workspaceId,
    });
  }

  private applyEventSemantics(
    properties: Record<string, string>,
    relations: Set<string>,
    payload: MixpanelRecord,
  ): void {
    const event = payload as Partial<MixpanelEvent> & MixpanelRecord;
    const eventName = readEventLabel(payload);
    addStringProperty(properties, 'mixpanel.event', eventName);
    addFirstStringProperty(properties, 'mixpanel.insert_id', event.insertId, event.insert_id);
    addFirstStringProperty(properties, 'mixpanel.project_id', event.project_id, payload.projectId);
    addFirstStringProperty(properties, 'mixpanel.timestamp', event.timestamp, payload.timestamp);

    const eventProperties = getRecord(event.properties);
    if (eventProperties) {
      addStringProperty(properties, 'mixpanel.distinct_id', eventProperties.distinct_id);
      addStringProperty(properties, 'mixpanel.token', eventProperties.token);
      addStringProperty(properties, 'mixpanel.library', eventProperties.mp_lib);
      addStringProperty(properties, 'mixpanel.country_code', eventProperties.mp_country_code);
      addFirstStringProperty(properties, 'mixpanel.time', eventProperties.time);
      addFirstStringProperty(properties, 'mixpanel.insert_id', properties['mixpanel.insert_id'], eventProperties.$insert_id);

      const distinctId = asString(eventProperties.distinct_id);
      if (distinctId) {
        relations.add(mixpanelProfilePath(distinctId));
      }

      const campaign = asString(eventProperties.utm_campaign);
      if (campaign) {
        properties['mixpanel.utm_campaign'] = campaign;
      }
      const source = asString(eventProperties.utm_source);
      if (source) {
        properties['mixpanel.utm_source'] = source;
      }
      const medium = asString(eventProperties.utm_medium);
      if (medium) {
        properties['mixpanel.utm_medium'] = medium;
      }
      const revenue = asNumber(eventProperties.$revenue ?? eventProperties.revenue);
      if (revenue !== undefined) {
        properties['mixpanel.revenue'] = String(revenue);
      }
      const propertyCount = Object.keys(eventProperties).length;
      properties['mixpanel.property_count'] = String(propertyCount);
    }

    const distinctId = asString(event.distinct_id) ?? asString(payload.distinctId);
    if (distinctId) {
      addStringProperty(properties, 'mixpanel.distinct_id', distinctId);
      relations.add(mixpanelProfilePath(distinctId));
    }
  }

  private applyProfileSemantics(
    properties: Record<string, string>,
    relations: Set<string>,
    comments: string[],
    payload: MixpanelRecord,
  ): void {
    const profile = payload as Partial<MixpanelProfile> & MixpanelRecord;
    const distinctId =
      asString(profile.$distinct_id) ??
      asString(profile.distinct_id) ??
      asString(profile.id);
    if (distinctId) {
      addStringProperty(properties, 'mixpanel.distinct_id', distinctId);
    }

    const profileProperties =
      getRecord(profile.$set) ??
      getRecord(profile.$properties) ??
      getRecord(profile.properties);

    if (profileProperties) {
      addFirstStringProperty(properties, 'mixpanel.email', profileProperties.$email, profileProperties.email);
      addFirstStringProperty(properties, 'mixpanel.name', profileProperties.$name, profileProperties.name);
      addFirstStringProperty(properties, 'mixpanel.first_name', profileProperties.$first_name, profileProperties.first_name);
      addFirstStringProperty(properties, 'mixpanel.last_name', profileProperties.$last_name, profileProperties.last_name);
      addFirstStringProperty(properties, 'mixpanel.phone', profileProperties.$phone, profileProperties.phone);
      addFirstStringProperty(properties, 'mixpanel.city', profileProperties.$city, profileProperties.city);
      addFirstStringProperty(properties, 'mixpanel.region', profileProperties.$region, profileProperties.region);
      addFirstStringProperty(properties, 'mixpanel.country_code', profileProperties.$country_code, profileProperties.country);
      addFirstStringProperty(properties, 'mixpanel.created', profileProperties.$created, profileProperties.created);
      properties['mixpanel.property_count'] = String(Object.keys(profileProperties).length);

      const note = asString(profileProperties.note) ?? asString(profileProperties.notes);
      if (note) {
        comments.push(note);
      }

      for (const cohortId of readProfileCohortIds(profileProperties)) {
        relations.add(mixpanelCohortPath(cohortId));
      }
    }

    const labels = asStringArray(profile.labels);
    if (labels.length > 0) {
      properties['mixpanel.labels'] = labels.join(', ');
      properties['mixpanel.label_count'] = String(labels.length);
    }
  }

  private applyCohortSemantics(
    properties: Record<string, string>,
    relations: Set<string>,
    payload: MixpanelRecord,
  ): void {
    const cohort = payload as Partial<MixpanelCohort> & MixpanelRecord;
    addStringProperty(properties, 'mixpanel.name', cohort.name);
    addFirstStringProperty(properties, 'mixpanel.description', cohort.description);
    addFirstStringProperty(properties, 'mixpanel.project_id', cohort.project_id, payload.projectId);
    addFirstStringProperty(properties, 'mixpanel.created', cohort.created, cohort.created_at);
    addFirstStringProperty(properties, 'mixpanel.updated', cohort.updated, cohort.updated_at);
    addNumberProperty(properties, 'mixpanel.count', cohort.count);
    addBooleanProperty(properties, 'mixpanel.is_visible', cohort.is_visible);

    const memberIds = asStringArray(payload.member_ids);
    if (memberIds.length > 0) {
      properties['mixpanel.member_count'] = String(memberIds.length);
      for (const memberId of memberIds) {
        relations.add(mixpanelProfilePath(memberId));
      }
    }
  }
}

function mergeMixpanelPayload(event: MixpanelWebhookPayload): MixpanelRecord {
  const data = isRecord(event.data) ? event.data : {};
  const payload: MixpanelRecord = { ...data };
  payload._webhook = compactObject({
    action: event.action,
    eventType: readEventType(event, normalizeMixpanelObjectType(event.type)),
    objectId: extractPayloadId(event.data, normalizeMixpanelObjectType(event.type)),
    objectType: normalizeMixpanelObjectType(event.type),
    projectId: asString(event.projectId) ?? asString(event.project_id),
    timestamp: readOptionalTimestamp(event.timestamp),
  });
  return payload;
}

function readEventType(event: MixpanelWebhookPayload, objectType: string): string {
  const explicit = asString(event.eventType) ?? asString(event.event_type) ?? asString(event.event);
  if (explicit) {
    const normalized = explicit.trim().toLowerCase();
    if (normalized.includes('.')) {
      return normalized;
    }
  }
  const action = asString(event.action)?.toLowerCase() ?? 'update';
  return `${objectType}.${action}`;
}

function extractPayloadId(payload: unknown, objectType: string): string | undefined {
  const record = getRecord(payload);
  if (!record) {
    return undefined;
  }
  if (objectType === 'event') {
    return (
      asString(record.id) ??
      asString(record.insertId) ??
      asString(record.insert_id) ??
      asString(getRecord(record.properties)?.$insert_id) ??
      deriveEventId(record)
    );
  }
  if (objectType === 'profile') {
    return (
      asString(record.$distinct_id) ??
      asString(record.distinct_id) ??
      asString(record.id)
    );
  }
  return asString(record.id);
}

function deriveEventId(record: MixpanelRecord): string | undefined {
  const event = asString(record.event) ?? asString(record.name);
  const properties = getRecord(record.properties);
  const distinctId = asString(properties?.distinct_id) ?? asString(record.distinct_id);
  const time = asString(properties?.time) ?? asString(record.timestamp);
  if (event && distinctId && time) {
    return `${event}:${distinctId}:${time}`;
  }
  if (event && distinctId) {
    return `${event}:${distinctId}`;
  }
  return undefined;
}

function readEventLabel(payload: Record<string, unknown>): string | undefined {
  return (
    asString(payload.event) ??
    asString(payload.name) ??
    asString(getRecord(payload.properties)?.event)
  );
}

function getWebhookAction(payload: Record<string, unknown>): string | undefined {
  const webhook = getRecord(payload._webhook);
  return asString(webhook?.action)?.toLowerCase();
}

function getEventAction(eventType: string): string | undefined {
  const parts = eventType.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) : undefined;
}

function inferWriteCounts(
  event: NormalizedWebhook,
  result: WriteFileResult | void,
  deleted: boolean,
): Pick<IngestResult, 'filesDeleted' | 'filesUpdated' | 'filesWritten'> {
  if (deleted) {
    return {
      filesDeleted: 1,
      filesUpdated: 0,
      filesWritten: result?.created ? 1 : 0,
    };
  }

  const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
  if (result?.created || result?.status === 'created' || action === 'create') {
    return { filesDeleted: 0, filesUpdated: 0, filesWritten: 1 };
  }
  return { filesDeleted: 0, filesUpdated: 1, filesWritten: 0 };
}

function inferFallbackPath(event: MixpanelWebhookPayload | NormalizedWebhook): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeMixpanelPath(event.objectType, event.objectId, readEventLabel(event.payload));
    }
    const objectType = normalizeMixpanelObjectType(event.type);
    const objectId = extractPayloadId(event.data, objectType);
    if (!objectId) {
      return '';
    }
    const label = objectType === 'event' && isRecord(event.data) ? readEventLabel(event.data) : undefined;
    return computeMixpanelPath(objectType, objectId, label);
  } catch {
    return '';
  }
}

function isNormalizedWebhook(value: unknown): value is NormalizedWebhook {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.provider === 'string' &&
    typeof value.eventType === 'string' &&
    typeof value.objectType === 'string' &&
    typeof value.objectId === 'string' &&
    isRecord(value.payload)
  );
}

function addStringProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  const text = asString(value);
  if (text) {
    properties[key] = text;
  }
}

function addFirstStringProperty(
  properties: Record<string, string>,
  key: string,
  ...values: unknown[]
): void {
  if (properties[key]) {
    return;
  }
  for (const value of values) {
    const text = asString(value);
    if (text) {
      properties[key] = text;
      return;
    }
  }
}

function addNumberProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  const number = asNumber(value);
  if (number !== undefined) {
    properties[key] = String(number);
  }
}

function addBooleanProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  if (typeof value === 'boolean') {
    properties[key] = String(value);
  }
}

function readProfileCohortIds(properties: MixpanelRecord): string[] {
  const ids = [
    ...asStringArray(properties.cohort_ids),
    ...asStringArray(properties.cohorts),
  ];
  const single = asString(properties.cohort_id);
  if (single) {
    ids.push(single);
  }
  return uniqueStrings(ids);
}

function compactSemantics(semantics: FileSemantics): FileSemantics {
  const result: FileSemantics = {};
  if (semantics.properties && Object.keys(semantics.properties).length > 0) {
    result.properties = semantics.properties;
  }
  if (semantics.relations && semantics.relations.length > 0) {
    result.relations = semantics.relations;
  }
  if (semantics.permissions && semantics.permissions.length > 0) {
    result.permissions = semantics.permissions;
  }
  if (semantics.comments && semantics.comments.length > 0) {
    result.comments = semantics.comments;
  }
  return result;
}

function compactObject(record: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== null && value !== '') {
      compacted[key] = value;
    }
  }
  return compacted;
}

function sortStrings(values: Set<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asString(item))
    .filter((item): item is string => item !== undefined);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readOptionalTimestamp(value: unknown): number | undefined {
  const number = asNumber(value);
  if (number === undefined) {
    return undefined;
  }
  return number < 10_000_000_000 ? number * 1000 : number;
}

function getRecord(value: unknown): MixpanelRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is MixpanelRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
