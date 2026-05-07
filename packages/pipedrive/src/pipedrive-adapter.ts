import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computePipedrivePath,
  normalizePipedriveObjectType,
  pipedriveActivityPath,
  pipedriveDealPath,
  pipedriveOrganizationPath,
  pipedrivePersonPath,
} from './path-mapper.js';
import { PIPEDRIVE_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  PipedriveActivity,
  PipedriveAdapterConfig,
  PipedriveDeal,
  PipedriveOrganization,
  PipedrivePerson,
  PipedriveReference,
  PipedriveWebhookPayload,
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | PipedriveWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string, displayName?: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;

  supportedEvents?(): string[];
}

type PipedriveRecord = Record<string, unknown>;
type PipedriveWebhookEnvelope = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const PIPEDRIVE_PROVIDER_NAME = 'pipedrive';
const SUPPORTED_EVENTS = PIPEDRIVE_WEBHOOK_OBJECT_TYPES;

export class PipedriveAdapter extends IntegrationAdapter {
  override readonly name = PIPEDRIVE_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: PipedriveAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: PipedriveAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => [
      `${objectType}.created`,
      `${objectType}.updated`,
      `${objectType}.deleted`,
    ]);
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | PipedriveWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = this.pathForEvent(normalized);

      if (this.isDeleteEvent(normalized)) {
        if (this.client.deleteFile) {
          await this.client.deleteFile({ workspaceId, path });
          return {
            filesWritten: 0,
            filesUpdated: 0,
            filesDeleted: 1,
            paths: [path],
            errors: [],
          };
        }

        const deleteResult = await this.client.writeFile({
          workspaceId,
          path,
          content: this.renderContent(workspaceId, normalized, true),
          contentType: JSON_CONTENT_TYPE,
          semantics: this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload),
        });

        const counts = inferWriteCounts(normalized, deleteResult, true);
        return {
          filesWritten: counts.filesWritten,
          filesUpdated: counts.filesUpdated,
          filesDeleted: counts.filesDeleted,
          paths: [path],
          errors: [],
        };
      }

      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content: this.renderContent(workspaceId, normalized, false),
        contentType: JSON_CONTENT_TYPE,
        semantics: this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload),
      });

      const counts = inferWriteCounts(normalized, writeResult, false);
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
    return computePipedrivePath(objectType, objectId, displayName);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizePipedriveObjectType(objectType);
    const properties: Record<string, string> = {
      provider: PIPEDRIVE_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'pipedrive.id': objectId,
      'pipedrive.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'pipedrive.webhook.action', webhook.action);
      addStringProperty(properties, 'pipedrive.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'pipedrive.webhook.delivery_id', webhook.deliveryId);
      addNumberProperty(properties, 'pipedrive.webhook.timestamp', webhook.webhookTimestamp);
    }

    switch (normalizedType) {
      case 'deal':
        applyDealSemantics(properties, relations, payload);
        break;
      case 'person':
        applyPersonSemantics(properties, relations, payload);
        break;
      case 'organization':
        applyOrganizationSemantics(properties, payload);
        break;
      case 'activity':
        applyActivitySemantics(properties, relations, comments, payload);
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

  private normalizeEvent(event: NormalizedWebhook | PipedriveWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const objectType = normalizePipedriveObjectType(event.objectType);
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || PIPEDRIVE_PROVIDER_NAME,
        eventType: canonicalEventType(event.eventType, objectType),
        objectType,
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const objectType = normalizePipedriveObjectType(readObjectTypeFromWebhook(event));
    const data = getWebhookData(event);
    const objectId = extractPayloadId(data) ?? extractPayloadId(event);
    if (!objectId) {
      throw new Error(`Pipedrive ${objectType} webhook is missing current.id or data.id`);
    }

    const action = canonicalAction(readActionFromWebhook(event));
    const payload = mergePipedrivePayload(event, data, objectType, action, objectId);
    const normalized: NormalizedWebhook = {
      provider: this.config.provider || PIPEDRIVE_PROVIDER_NAME,
      eventType: `${objectType}.${action}`,
      objectType,
      objectId,
      payload,
    };
    if (this.config.connectionId) {
      normalized.connectionId = this.config.connectionId;
    }
    return normalized;
  }

  private pathForEvent(event: NormalizedWebhook): string {
    return computePipedrivePath(
      event.objectType,
      event.objectId,
      readDisplayName(event.objectType, event.payload),
    );
  }

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
    return action === 'deleted';
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizePipedriveObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function applyDealSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: PipedriveRecord,
): void {
  const deal = payload as Partial<PipedriveDeal> & PipedriveRecord;

  addStringProperty(properties, 'pipedrive.title', deal.title);
  addStringProperty(properties, 'pipedrive.status', deal.status);
  addStringProperty(properties, 'pipedrive.currency', deal.currency);
  addFirstStringProperty(properties, 'pipedrive.add_time', deal.add_time, deal.addTime);
  addFirstStringProperty(properties, 'pipedrive.update_time', deal.update_time, deal.updateTime);
  addFirstStringProperty(properties, 'pipedrive.expected_close_date', deal.expected_close_date, deal.expectedCloseDate);
  addFirstStringProperty(properties, 'pipedrive.close_time', deal.close_time, deal.closeTime);
  addFirstStringProperty(properties, 'pipedrive.won_time', deal.won_time, deal.wonTime);
  addFirstStringProperty(properties, 'pipedrive.lost_time', deal.lost_time, deal.lostTime);
  addNumberProperty(properties, 'pipedrive.value', deal.value);
  addNumberProperty(properties, 'pipedrive.probability', deal.probability);
  addStringProperty(properties, 'pipedrive.label', deal.label);

  const stageId = referenceId(deal.stage_id);
  if (stageId) {
    addStringProperty(properties, 'pipedrive.stage_id', stageId);
  }

  const pipelineId = referenceId(deal.pipeline_id);
  if (pipelineId) {
    addStringProperty(properties, 'pipedrive.pipeline_id', pipelineId);
  }

  const personId = referenceId(deal.person_id);
  if (personId) {
    relations.add(pipedrivePersonPath(personId));
    addStringProperty(properties, 'pipedrive.person_id', personId);
  }
  addFirstStringProperty(properties, 'pipedrive.person_name', referenceName(deal.person_id), deal.person_name);

  const organizationId = referenceId(deal.org_id);
  if (organizationId) {
    relations.add(pipedriveOrganizationPath(organizationId));
    addStringProperty(properties, 'pipedrive.organization_id', organizationId);
  }
  addFirstStringProperty(properties, 'pipedrive.organization_name', referenceName(deal.org_id), deal.org_name, deal.organization_name);

  const ownerId = referenceId(deal.user_id);
  if (ownerId) {
    addStringProperty(properties, 'pipedrive.owner_id', ownerId);
  }
  addFirstStringProperty(properties, 'pipedrive.owner_name', referenceName(deal.user_id), deal.owner_name);
}

function applyPersonSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: PipedriveRecord,
): void {
  const person = payload as Partial<PipedrivePerson> & PipedriveRecord;

  addStringProperty(properties, 'pipedrive.name', person.name);
  addStringProperty(properties, 'pipedrive.first_name', person.first_name);
  addStringProperty(properties, 'pipedrive.last_name', person.last_name);
  addFirstStringProperty(properties, 'pipedrive.add_time', person.add_time, person.addTime);
  addFirstStringProperty(properties, 'pipedrive.update_time', person.update_time, person.updateTime);
  addStringProperty(properties, 'pipedrive.visible_to', person.visible_to);

  const emails = normalizeContactValues(person.email);
  if (emails.length > 0) {
    properties['pipedrive.email'] = emails.join(', ');
    properties['pipedrive.email_count'] = String(emails.length);
  }

  const phones = normalizeContactValues(person.phone);
  if (phones.length > 0) {
    properties['pipedrive.phone'] = phones.join(', ');
    properties['pipedrive.phone_count'] = String(phones.length);
  }

  const organizationId = referenceId(person.org_id);
  if (organizationId) {
    relations.add(pipedriveOrganizationPath(organizationId));
    addStringProperty(properties, 'pipedrive.organization_id', organizationId);
  }
  addFirstStringProperty(properties, 'pipedrive.organization_name', referenceName(person.org_id), person.org_name);

  const ownerId = referenceId(person.owner_id);
  if (ownerId) {
    addStringProperty(properties, 'pipedrive.owner_id', ownerId);
  }
  addFirstStringProperty(properties, 'pipedrive.owner_name', referenceName(person.owner_id), person.owner_name);
}

function applyOrganizationSemantics(
  properties: Record<string, string>,
  payload: PipedriveRecord,
): void {
  const organization = payload as Partial<PipedriveOrganization> & PipedriveRecord;

  addStringProperty(properties, 'pipedrive.name', organization.name);
  addStringProperty(properties, 'pipedrive.address', organization.address);
  addStringProperty(properties, 'pipedrive.cc_email', organization.cc_email);
  addStringProperty(properties, 'pipedrive.visible_to', organization.visible_to);
  addBooleanProperty(properties, 'pipedrive.active', organization.active_flag);
  addFirstStringProperty(properties, 'pipedrive.add_time', organization.add_time, organization.addTime);
  addFirstStringProperty(properties, 'pipedrive.update_time', organization.update_time, organization.updateTime);

  const ownerId = referenceId(organization.owner_id);
  if (ownerId) {
    addStringProperty(properties, 'pipedrive.owner_id', ownerId);
  }
  addFirstStringProperty(properties, 'pipedrive.owner_name', referenceName(organization.owner_id), organization.owner_name);
}

function applyActivitySemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: PipedriveRecord,
): void {
  const activity = payload as Partial<PipedriveActivity> & PipedriveRecord;

  addStringProperty(properties, 'pipedrive.subject', activity.subject);
  addStringProperty(properties, 'pipedrive.type', activity.type);
  addStringProperty(properties, 'pipedrive.due_date', activity.due_date);
  addStringProperty(properties, 'pipedrive.due_time', activity.due_time);
  addStringProperty(properties, 'pipedrive.duration', activity.duration);
  addFirstStringProperty(properties, 'pipedrive.add_time', activity.add_time, activity.addTime);
  addFirstStringProperty(properties, 'pipedrive.update_time', activity.update_time, activity.updateTime);
  addDoneProperty(properties, activity.done);

  const note = asString(activity.note);
  if (note) {
    comments.push(note);
    properties['pipedrive.note_length'] = String(note.length);
  }

  const dealId = referenceId(activity.deal_id);
  if (dealId) {
    relations.add(pipedriveDealPath(dealId));
    addStringProperty(properties, 'pipedrive.deal_id', dealId);
  }
  addFirstStringProperty(properties, 'pipedrive.deal_title', referenceName(activity.deal_id), activity.deal_title);

  const personId = referenceId(activity.person_id);
  if (personId) {
    relations.add(pipedrivePersonPath(personId));
    addStringProperty(properties, 'pipedrive.person_id', personId);
  }
  addFirstStringProperty(properties, 'pipedrive.person_name', referenceName(activity.person_id), activity.person_name);

  const organizationId = referenceId(activity.org_id);
  if (organizationId) {
    relations.add(pipedriveOrganizationPath(organizationId));
    addStringProperty(properties, 'pipedrive.organization_id', organizationId);
  }
  addFirstStringProperty(properties, 'pipedrive.organization_name', referenceName(activity.org_id), activity.org_name);

  const ownerId = referenceId(activity.user_id);
  if (ownerId) {
    addStringProperty(properties, 'pipedrive.owner_id', ownerId);
  }
  addFirstStringProperty(properties, 'pipedrive.owner_name', referenceName(activity.user_id), activity.owner_name);
}

function readDisplayName(objectType: string, payload: Record<string, unknown>): string | undefined {
  switch (normalizePipedriveObjectType(objectType)) {
    case 'deal':
      return asString(payload.title);
    case 'person':
      return asString(payload.name);
    case 'organization':
      return asString(payload.name);
    case 'activity':
      return asString(payload.subject);
  }
}

function mergePipedrivePayload(
  event: PipedriveWebhookPayload,
  data: Record<string, unknown>,
  objectType: string,
  action: string,
  objectId: string,
): Record<string, unknown> {
  return {
    ...data,
    _webhook: compactObject<PipedriveWebhookEnvelope>({
      action,
      event: asString(event.event),
      objectId,
      objectType,
      previousData: event.previous ?? undefined,
      timestamp: readOptionalNumber(event.timestamp) ?? readOptionalNumber(getRecord(event.meta)?.timestamp),
    }),
  };
}

function getWebhookData(event: PipedriveWebhookPayload): Record<string, unknown> {
  const current = getRecord(event.current);
  if (current) {
    return current;
  }
  const data = getRecord(event.data);
  if (data) {
    return data;
  }
  return {};
}

function readObjectTypeFromWebhook(event: PipedriveWebhookPayload): string {
  const meta = getRecord(event.meta);
  const objectType =
    asString(event.object) ??
    asString(meta?.object) ??
    asString(meta?.entity) ??
    objectTypeFromEvent(asString(event.event) ?? asString(meta?.event));
  if (!objectType) {
    throw new Error('Pipedrive webhook payload is missing object metadata');
  }
  return objectType;
}

function readActionFromWebhook(event: PipedriveWebhookPayload): string {
  const meta = getRecord(event.meta);
  const action =
    asString(event.action) ??
    asString(meta?.action) ??
    actionFromEvent(asString(event.event) ?? asString(meta?.event));
  if (!action) {
    throw new Error('Pipedrive webhook payload is missing action metadata');
  }
  return action;
}

function objectTypeFromEvent(event: string | undefined): string | undefined {
  if (!event) return undefined;
  for (const token of event.split(/[.:_\s-]+/u)) {
    const normalized = token.toLowerCase();
    if (['deal', 'deals'].includes(normalized)) return 'deal';
    if (['person', 'persons', 'people'].includes(normalized)) return 'person';
    if (['organization', 'organizations', 'organisation', 'organisations', 'org'].includes(normalized)) return 'organization';
    if (['activity', 'activities'].includes(normalized)) return 'activity';
  }
  return undefined;
}

function actionFromEvent(event: string | undefined): string | undefined {
  if (!event) return undefined;
  for (const token of event.split(/[.:_\s-]+/u)) {
    const normalized = canonicalAction(token);
    if (normalized === 'created' || normalized === 'updated' || normalized === 'deleted') {
      return normalized;
    }
  }
  return undefined;
}

function canonicalAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'add':
    case 'added':
    case 'create':
    case 'created':
      return 'created';
    case 'delete':
    case 'deleted':
    case 'remove':
    case 'removed':
      return 'deleted';
    case 'change':
    case 'update':
    case 'updated':
      return 'updated';
    default:
      return normalized;
  }
}

function canonicalEventType(eventType: string, objectType: string): string {
  const action = getEventAction(eventType);
  if (action) {
    return `${objectType}.${canonicalAction(action)}`;
  }
  return eventType.trim().toLowerCase();
}

function inferWriteCounts(
  event: NormalizedWebhook,
  writeResult: WriteFileResult | void,
  deleted: boolean,
): Pick<IngestResult, 'filesDeleted' | 'filesUpdated' | 'filesWritten'> {
  if (deleted) {
    if (writeResult?.status === 'created' || writeResult?.created) {
      return { filesWritten: 1, filesUpdated: 0, filesDeleted: 0 };
    }
    return { filesWritten: 0, filesUpdated: 1, filesDeleted: 0 };
  }

  if (writeResult?.created || writeResult?.status === 'created') {
    return { filesWritten: 1, filesUpdated: 0, filesDeleted: 0 };
  }

  if (writeResult?.updated || writeResult?.status === 'updated') {
    return { filesWritten: 0, filesUpdated: 1, filesDeleted: 0 };
  }

  const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
  if (action === 'created') {
    return { filesWritten: 1, filesUpdated: 0, filesDeleted: 0 };
  }

  return { filesWritten: 0, filesUpdated: 1, filesDeleted: 0 };
}

function getWebhookAction(payload: Record<string, unknown>): string | undefined {
  return asString(getRecord(payload._webhook)?.action)?.toLowerCase();
}

function getEventAction(eventType: string): string | undefined {
  const separatorIndex = eventType.lastIndexOf('.');
  if (separatorIndex === -1 || separatorIndex === eventType.length - 1) {
    return undefined;
  }
  return eventType.slice(separatorIndex + 1).toLowerCase();
}

function inferFallbackPath(event: NormalizedWebhook | PipedriveWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computePipedrivePath(event.objectType, event.objectId);
    }

    const objectType = readObjectTypeFromWebhook(event);
    const objectId = extractPayloadId(getWebhookData(event)) ?? extractPayloadId(event);
    if (!objectId) {
      return '';
    }
    return computePipedrivePath(objectType, objectId);
  } catch {
    return '';
  }
}

function extractPayloadId(value: unknown): string | undefined {
  const record = getRecord(value);
  return asString(record?.id);
}

function isNormalizedWebhook(event: NormalizedWebhook | PipedriveWebhookPayload): event is NormalizedWebhook {
  return (
    isRecord(event) &&
    typeof event.eventType === 'string' &&
    typeof event.objectType === 'string' &&
    typeof event.objectId === 'string' &&
    isRecord(event.payload)
  );
}

function addStringProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const normalized = asString(value);
  if (normalized) {
    properties[key] = normalized;
  }
}

function addFirstStringProperty(
  properties: Record<string, string>,
  key: string,
  ...values: unknown[]
): void {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      properties[key] = normalized;
      return;
    }
  }
}

function addNumberProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const normalized = readOptionalNumber(value);
  if (normalized !== undefined) {
    properties[key] = String(normalized);
  }
}

function addBooleanProperty(properties: Record<string, string>, key: string, value: unknown): void {
  if (typeof value === 'boolean') {
    properties[key] = String(value);
  }
}

function addDoneProperty(properties: Record<string, string>, value: unknown): void {
  if (typeof value === 'boolean') {
    properties['pipedrive.done'] = String(value);
    return;
  }
  if (typeof value === 'number') {
    properties['pipedrive.done'] = String(value === 1);
  }
}

function compactSemantics(semantics: FileSemantics): FileSemantics {
  const compacted: FileSemantics = {};

  if (semantics.properties && Object.keys(semantics.properties).length > 0) {
    compacted.properties = semantics.properties;
  }
  if (semantics.relations && semantics.relations.length > 0) {
    compacted.relations = semantics.relations;
  }
  if (semantics.comments && semantics.comments.length > 0) {
    compacted.comments = semantics.comments;
  }

  return compacted;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as T;
}

function sortStrings(values: Set<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (isRecord(value)) {
    const sortedEntries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)] as const);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}

function normalizeContactValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = asString(value);
    return normalized ? [normalized] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => getRecord(entry))
    .map((entry) => asString(entry?.value))
    .filter((entry): entry is string => entry !== undefined)
    .sort((left, right) => left.localeCompare(right));
}

function referenceId(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    return asString(value);
  }
  const record = getRecord(value);
  return asString(record?.id) ?? asString(record?.value);
}

function referenceName(value: unknown): string | undefined {
  const record = getRecord(value) as (Partial<PipedriveReference> & Record<string, unknown>) | undefined;
  return asString(record?.name);
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
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

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
