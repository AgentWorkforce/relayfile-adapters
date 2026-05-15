import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeZendeskPath,
  normalizeZendeskObjectType,
  zendeskOrganizationPath,
  zendeskTicketPath,
  zendeskUserPath,
} from './path-mapper.js';
import { ZENDESK_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  ZendeskAdapterConfig,
  ZendeskOrganization,
  ZendeskOrganizationReference,
  ZendeskTicket,
  ZendeskTicketComment,
  ZendeskUser,
  ZendeskUserReference,
  ZendeskWebhookPayload,
} from './types.js';

export interface FileSemantics {
  properties?: Record<string, string>;
  relations?: string[];
  permissions?: string[];
  comments?: string[];
}

export interface IngestError {
  path?: string;
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
  status?: 'created' | 'pending' | 'queued' | 'updated';
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | ZendeskWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;

  supportedEvents?(): string[];
}

type ZendeskRecord = Record<string, unknown>;
type ZendeskWebhookEnvelope = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SUPPORTED_EVENTS = ZENDESK_WEBHOOK_OBJECT_TYPES;
const ZENDESK_PROVIDER_NAME = 'zendesk';

export class ZendeskAdapter extends IntegrationAdapter {
  override readonly name = ZENDESK_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: ZendeskAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: ZendeskAdapterConfig = {},
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
    event: NormalizedWebhook | ZendeskWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = computeZendeskPath(
        normalized.objectType,
        normalized.objectId,
        readTicketSubject(normalized.objectType, normalized.payload),
      );

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
      const fallbackPath = inferFallbackPath(event) || undefined;
      const ingestError: IngestError = { error: toErrorMessage(error) };
      if (fallbackPath) {
        ingestError.path = fallbackPath;
      }
      return {
        filesWritten: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        paths: fallbackPath ? [fallbackPath] : [],
        errors: [
          ingestError,
        ],
      };
    }
  }

  override computePath(objectType: string, objectId: string, title?: string): string {
    return computeZendeskPath(objectType, objectId, title);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeZendeskObjectType(objectType);
    const properties: Record<string, string> = {
      provider: ZENDESK_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'zendesk.id': objectId,
      'zendesk.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    addStringProperty(properties, 'zendesk.url', payload.url);

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'zendesk.webhook.action', webhook.action);
      addStringProperty(properties, 'zendesk.webhook.created_at', webhook.created_at ?? webhook.createdAt);
      addStringProperty(properties, 'zendesk.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'zendesk.webhook.account_id', webhook.accountId);
      addStringProperty(properties, 'zendesk.webhook.subdomain', webhook.subdomain);
    }

    switch (normalizedType) {
      case 'ticket':
        applyTicketSemantics(properties, relations, comments, payload as ZendeskRecord);
        break;
      case 'user':
        applyUserSemantics(properties, relations, payload as ZendeskRecord);
        break;
      case 'organization':
        applyOrganizationSemantics(properties, payload as ZendeskRecord);
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

  private normalizeEvent(event: NormalizedWebhook | ZendeskWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const objectType = normalizeZendeskObjectType(event.objectType);
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || ZENDESK_PROVIDER_NAME,
        eventType: canonicalEventType(event.eventType, event.objectType),
        objectType,
        objectId: event.objectId.trim(),
        payload: flattenNormalizedPayload(event.payload, objectType),
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const objectType = inferPayloadObjectType(event);
    const objectData = extractObjectData(event, objectType);
    const objectId = extractPayloadId(objectData);
    if (!objectId) {
      throw new Error(`Zendesk ${objectType} webhook is missing object id`);
    }

    let action = inferWebhookAction(event);
    if (action === 'updated' && objectType === 'ticket') {
      const previous = getRecord(event.previous);
      const currentStatus = asString(objectData.status)?.toLowerCase();
      const previousStatus = asString(previous?.status)?.toLowerCase();
      if (currentStatus && currentStatus !== previousStatus && (currentStatus === 'solved' || currentStatus === 'closed')) {
        action = 'solved';
      }
    }
    const payload = mergeZendeskPayload(event, objectType, objectData, action);
    const normalized: NormalizedWebhook = {
      provider: this.config.provider || ZENDESK_PROVIDER_NAME,
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

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
    return action === 'deleted' || action === 'delete' || action === 'destroyed';
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeZendeskObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function applyTicketSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: ZendeskRecord,
): void {
  const ticket = payload as Partial<ZendeskTicket> & ZendeskRecord;

  addStringProperty(properties, 'zendesk.external_id', ticket.external_id);
  addStringProperty(properties, 'zendesk.type', ticket.type);
  addStringProperty(properties, 'zendesk.subject', ticket.subject);
  addStringProperty(properties, 'zendesk.raw_subject', ticket.raw_subject);
  addStringProperty(properties, 'zendesk.description', ticket.description);
  addStringProperty(properties, 'zendesk.priority', ticket.priority);
  addStringProperty(properties, 'zendesk.status', ticket.status);
  addStringProperty(properties, 'zendesk.recipient', ticket.recipient);
  addStringProperty(properties, 'zendesk.created_at', ticket.created_at);
  addStringProperty(properties, 'zendesk.updated_at', ticket.updated_at);
  addStringProperty(properties, 'zendesk.due_at', ticket.due_at);
  addBooleanProperty(properties, 'zendesk.has_incidents', ticket.has_incidents);
  addBooleanProperty(properties, 'zendesk.is_public', ticket.is_public);

  const requesterId = asZendeskId(ticket.requester?.id) ?? asZendeskId(ticket.requester_id);
  if (requesterId) {
    relations.add(zendeskUserPath(requesterId));
    addStringProperty(properties, 'zendesk.requester_id', requesterId);
  }
  addFirstStringProperty(properties, 'zendesk.requester_name', ticket.requester?.name, ticket.requester_name);
  addFirstStringProperty(properties, 'zendesk.requester_email', ticket.requester?.email, ticket.requester_email);

  const submitterId = asZendeskId(ticket.submitter?.id) ?? asZendeskId(ticket.submitter_id);
  if (submitterId) {
    relations.add(zendeskUserPath(submitterId));
    addStringProperty(properties, 'zendesk.submitter_id', submitterId);
  }
  addFirstStringProperty(properties, 'zendesk.submitter_name', ticket.submitter?.name, ticket.submitter_name);
  addFirstStringProperty(properties, 'zendesk.submitter_email', ticket.submitter?.email, ticket.submitter_email);

  const assigneeId = asZendeskId(ticket.assignee?.id) ?? asZendeskId(ticket.assignee_id);
  if (assigneeId) {
    relations.add(zendeskUserPath(assigneeId));
    addStringProperty(properties, 'zendesk.assignee_id', assigneeId);
  }
  addFirstStringProperty(properties, 'zendesk.assignee_name', ticket.assignee?.name, ticket.assignee_name);
  addFirstStringProperty(properties, 'zendesk.assignee_email', ticket.assignee?.email, ticket.assignee_email);

  const organizationId = asZendeskId(ticket.organization?.id) ?? asZendeskId(ticket.organization_id);
  if (organizationId) {
    relations.add(zendeskOrganizationPath(organizationId));
    addStringProperty(properties, 'zendesk.organization_id', organizationId);
  }
  addFirstStringProperty(properties, 'zendesk.organization_name', ticket.organization?.name, ticket.organization_name);

  addZendeskIdProperty(properties, 'zendesk.group_id', ticket.group_id);
  addZendeskIdProperty(properties, 'zendesk.brand_id', ticket.brand_id);
  addZendeskIdProperty(properties, 'zendesk.forum_topic_id', ticket.forum_topic_id);

  const problemId = asZendeskId(ticket.problem_id);
  if (problemId) {
    relations.add(zendeskTicketPath(problemId));
    addStringProperty(properties, 'zendesk.problem_id', problemId);
  }

  const tags = uniqueStrings(asStringArray(ticket.tags));
  if (tags.length > 0) {
    properties['zendesk.tags'] = tags.join(', ');
    properties['zendesk.tag_count'] = String(tags.length);
  }

  addStringProperty(properties, 'zendesk.via_channel', ticket.via?.channel);
  addCustomFieldSummary(properties, 'zendesk.custom_fields', ticket.custom_fields);
  addCustomFieldSummary(properties, 'zendesk.fields', ticket.fields);

  for (const comment of ticket.comments ?? []) {
    applyTicketCommentSemantics(properties, relations, comments, comment);
  }
}

function applyTicketCommentSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  comment: ZendeskTicketComment,
): void {
  const authorId = asZendeskId(comment.author_id);
  if (authorId) {
    relations.add(zendeskUserPath(authorId));
  }

  const body = asString(comment.body) ?? asString(comment.html_body);
  if (body) {
    comments.push(body);
  }

  if (comments.length > 0) {
    properties['zendesk.comment_count'] = String(comments.length);
  }
}

function applyUserSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: ZendeskRecord,
): void {
  const user = payload as Partial<ZendeskUser> & ZendeskRecord;

  addStringProperty(properties, 'zendesk.name', user.name);
  addStringProperty(properties, 'zendesk.email', user.email);
  addStringProperty(properties, 'zendesk.external_id', user.external_id);
  addStringProperty(properties, 'zendesk.alias', user.alias);
  addStringProperty(properties, 'zendesk.role', user.role);
  addStringProperty(properties, 'zendesk.locale', user.locale);
  addStringProperty(properties, 'zendesk.time_zone', user.time_zone);
  addStringProperty(properties, 'zendesk.phone', user.phone);
  addStringProperty(properties, 'zendesk.created_at', user.created_at);
  addStringProperty(properties, 'zendesk.updated_at', user.updated_at);
  addStringProperty(properties, 'zendesk.details', user.details);
  addStringProperty(properties, 'zendesk.notes', user.notes);
  addBooleanProperty(properties, 'zendesk.active', user.active);
  addBooleanProperty(properties, 'zendesk.verified', user.verified);
  addBooleanProperty(properties, 'zendesk.suspended', user.suspended);
  addBooleanProperty(properties, 'zendesk.shared_phone_number', user.shared_phone_number);

  const organizationId = asZendeskId(user.organization?.id) ?? asZendeskId(user.organization_id);
  if (organizationId) {
    relations.add(zendeskOrganizationPath(organizationId));
    addStringProperty(properties, 'zendesk.organization_id', organizationId);
  }
  addFirstStringProperty(properties, 'zendesk.organization_name', user.organization?.name, user.organization_name);
  addZendeskIdProperty(properties, 'zendesk.default_group_id', user.default_group_id);

  const tags = uniqueStrings(asStringArray(user.tags));
  if (tags.length > 0) {
    properties['zendesk.tags'] = tags.join(', ');
    properties['zendesk.tag_count'] = String(tags.length);
  }

  addRecordSummary(properties, 'zendesk.user_fields', user.user_fields);
}

function applyOrganizationSemantics(
  properties: Record<string, string>,
  payload: ZendeskRecord,
): void {
  const organization = payload as Partial<ZendeskOrganization> & ZendeskRecord;

  addStringProperty(properties, 'zendesk.name', organization.name);
  addStringProperty(properties, 'zendesk.external_id', organization.external_id);
  addStringProperty(properties, 'zendesk.created_at', organization.created_at);
  addStringProperty(properties, 'zendesk.updated_at', organization.updated_at);
  addStringProperty(properties, 'zendesk.details', organization.details);
  addStringProperty(properties, 'zendesk.notes', organization.notes);
  addBooleanProperty(properties, 'zendesk.shared_tickets', organization.shared_tickets);
  addBooleanProperty(properties, 'zendesk.shared_comments', organization.shared_comments);
  addZendeskIdProperty(properties, 'zendesk.group_id', organization.group_id);

  const domains = uniqueStrings(asStringArray(organization.domain_names));
  if (domains.length > 0) {
    properties['zendesk.domain_names'] = domains.join(', ');
    properties['zendesk.domain_count'] = String(domains.length);
  }

  const tags = uniqueStrings(asStringArray(organization.tags));
  if (tags.length > 0) {
    properties['zendesk.tags'] = tags.join(', ');
    properties['zendesk.tag_count'] = String(tags.length);
  }

  addRecordSummary(properties, 'zendesk.organization_fields', organization.organization_fields);
}

function flattenNormalizedPayload(
  payload: Record<string, unknown>,
  objectType: 'organization' | 'ticket' | 'user',
): Record<string, unknown> {
  const nested = getRecord(payload[objectType]);
  const data = getRecord(payload.data);
  const nestedData = getRecord(data?.[objectType]);
  const objectData = nested ?? nestedData ?? data;
  if (!objectData) {
    return payload;
  }

  return {
    ...objectData,
    _connection: payload._connection,
    _webhook: payload._webhook,
  };
}

function mergeZendeskPayload(
  event: ZendeskWebhookPayload,
  objectType: 'organization' | 'ticket' | 'user',
  objectData: ZendeskRecord,
  action: string,
): Record<string, unknown> {
  return {
    ...objectData,
    _webhook: compactObject<ZendeskWebhookEnvelope>({
      accountId: asString(event.account_id),
      action,
      createdAt: asString(event.created_at),
      eventType: asString(event.event_type),
      metadata: event.metadata,
      objectType,
      previous: event.previous,
      subdomain: asString(event.subdomain),
      type: asString(event.type),
    }),
  };
}

function inferPayloadObjectType(event: ZendeskWebhookPayload): 'organization' | 'ticket' | 'user' {
  const rawType = asString(event.type) ?? asString(event.event_type);
  if (rawType) {
    const token = rawType.split(/[.:/]/u).find((entry) => {
      const normalized = entry.trim().toLowerCase();
      return normalized === 'ticket' || normalized === 'user' || normalized === 'organization';
    });
    return normalizeZendeskObjectType(token ?? rawType);
  }
  if (event.ticket) return 'ticket';
  if (event.user) return 'user';
  if (event.organization) return 'organization';
  const data = getRecord(event.data);
  const objectType = asString(data?.object_type) ?? asString(data?.type);
  if (objectType) {
    return normalizeZendeskObjectType(objectType);
  }
  throw new Error('Zendesk webhook payload is missing object type metadata.');
}

function extractObjectData(
  event: ZendeskWebhookPayload,
  objectType: 'organization' | 'ticket' | 'user',
): ZendeskRecord {
  const direct = getRecord(event[objectType]);
  if (direct) {
    return direct;
  }
  const data = getRecord(event.data);
  if (data) {
    const nested = getRecord(data[objectType]);
    return nested ?? data;
  }
  throw new Error(`Zendesk ${objectType} webhook is missing data.`);
}

function inferWebhookAction(event: ZendeskWebhookPayload): string {
  const explicit = asString(event.action);
  if (explicit) {
    return canonicalAction(explicit);
  }
  const eventType = asString(event.event_type);
  if (eventType) {
    const action = eventType.split(/[.:/]/u).at(-1);
    if (action) {
      return canonicalAction(action);
    }
  }
  return 'updated';
}

function canonicalAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'create':
    case 'created':
      return 'created';
    case 'delete':
    case 'deleted':
    case 'destroy':
    case 'destroyed':
      return 'deleted';
    case 'update':
    case 'updated':
      return 'updated';
    default:
      return normalized;
  }
}

function canonicalEventType(eventType: string, objectType: string): string {
  const action = getEventAction(eventType) ?? 'updated';
  return `${normalizeZendeskObjectType(objectType)}.${canonicalAction(action)}`;
}

function readTicketSubject(objectType: string, payload: Record<string, unknown>): string | undefined {
  if (normalizeZendeskObjectType(objectType) !== 'ticket') {
    return undefined;
  }
  return asString(payload.subject) ?? asString(payload.raw_subject);
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

function inferFallbackPath(event: NormalizedWebhook | ZendeskWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeZendeskPath(event.objectType, event.objectId);
    }
    const objectType = inferPayloadObjectType(event);
    const objectId = extractPayloadId(extractObjectData(event, objectType));
    return objectId ? computeZendeskPath(objectType, objectId) : '';
  } catch {
    return '';
  }
}

function extractPayloadId(value: unknown): string | undefined {
  const record = getRecord(value);
  return asZendeskId(record?.id);
}

function isNormalizedWebhook(event: NormalizedWebhook | ZendeskWebhookPayload): event is NormalizedWebhook {
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

function addBooleanProperty(properties: Record<string, string>, key: string, value: unknown): void {
  if (typeof value === 'boolean') {
    properties[key] = String(value);
  }
}

function addZendeskIdProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const normalized = asZendeskId(value);
  if (normalized) {
    properties[key] = normalized;
  }
}

function addCustomFieldSummary(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  if (!Array.isArray(value)) {
    return;
  }
  const entries = value
    .map((entry) => getRecord(entry))
    .filter((entry): entry is ZendeskRecord => entry !== undefined)
    .map((entry) => {
      const id = asZendeskId(entry.id);
      if (!id) return undefined;
      const fieldValue = entry.value;
      return `${id}:${stringifyFieldValue(fieldValue)}`;
    })
    .filter((entry): entry is string => entry !== undefined);
  if (entries.length > 0) {
    properties[key] = entries.join(', ');
  }
}

function addRecordSummary(properties: Record<string, string>, key: string, value: unknown): void {
  const record = getRecord(value);
  if (!record) {
    return;
  }
  const entries = Object.entries(record)
    .map(([field, fieldValue]) => `${field}:${stringifyFieldValue(fieldValue)}`)
    .sort((left, right) => left.localeCompare(right));
  if (entries.length > 0) {
    properties[key] = entries.join(', ');
  }
}

function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
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

function getRecord(value: unknown): ZendeskRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is ZendeskRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asZendeskId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return asString(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== undefined);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
