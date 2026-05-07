import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeIntercomPath,
  intercomCompanyPath,
  intercomContactPath,
  normalizeIntercomObjectType,
} from './path-mapper.js';
import { normalizeIntercomWebhook } from './webhook-normalizer.js';
import { INTERCOM_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  IntercomAdapterConfig,
  IntercomCompany,
  IntercomCompanyReference,
  IntercomContact,
  IntercomConversation,
  IntercomConversationPart,
  IntercomReference,
  IntercomTag,
  IntercomWebhookPayload,
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | IntercomWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  supportedEvents?(): string[];
}

type IntercomRecord = Record<string, unknown>;
type IntercomWebhookEnvelope = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const INTERCOM_PROVIDER_NAME = 'intercom';
const SUPPORTED_EVENTS = INTERCOM_WEBHOOK_OBJECT_TYPES;

export class IntercomAdapter extends IntegrationAdapter {
  override readonly name = INTERCOM_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: IntercomAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: IntercomAdapterConfig = {}
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
    event: NormalizedWebhook | IntercomWebhookPayload
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = computeIntercomPath(normalized.objectType, normalized.objectId);
      const semantics = this.computeSemantics(
        normalized.objectType,
        normalized.objectId,
        normalized.payload,
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
          semantics,
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
        semantics,
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

  override computePath(objectType: string, objectId: string): string {
    return computeIntercomPath(objectType, objectId);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics {
    const normalizedType = normalizeIntercomObjectType(objectType);
    const properties: Record<string, string> = {
      provider: INTERCOM_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'intercom.id': objectId,
      'intercom.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'intercom.webhook.action', webhook.action);
      addStringProperty(properties, 'intercom.webhook.app_id', webhook.appId);
      addStringProperty(properties, 'intercom.webhook.created_at', webhook.createdAt);
      addStringProperty(properties, 'intercom.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'intercom.webhook.topic', webhook.topic);
    }

    switch (normalizedType) {
      case 'conversation':
        applyConversationSemantics(properties, relations, comments, payload as IntercomRecord);
        break;
      case 'contact':
        applyContactSemantics(properties, relations, payload as IntercomRecord);
        break;
      case 'company':
        applyCompanySemantics(properties, payload as IntercomRecord);
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

  private normalizeEvent(event: NormalizedWebhook | IntercomWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || INTERCOM_PROVIDER_NAME,
        eventType: event.eventType,
        objectType: normalizeIntercomObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const normalized = normalizeIntercomWebhook(event);
    const rewritten: NormalizedWebhook = {
      provider: this.config.provider || normalized.provider || INTERCOM_PROVIDER_NAME,
      eventType: normalized.eventType,
      objectType: normalizeIntercomObjectType(normalized.objectType),
      objectId: normalized.objectId,
      payload: normalized.payload,
    };
    const connectionId = normalized.connectionId || this.config.connectionId;
    if (connectionId) {
      rewritten.connectionId = connectionId;
    }
    return rewritten;
  }

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
    return action === 'deleted' || action === 'delete' || action === 'removed' || action === 'archived';
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeIntercomObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function applyConversationSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: IntercomRecord
): void {
  const conversation = payload as Partial<IntercomConversation> & IntercomRecord;

  addStringProperty(properties, 'intercom.title', conversation.title);
  addStringProperty(properties, 'intercom.state', conversation.state);
  addStringProperty(properties, 'intercom.priority', conversation.priority);
  addBooleanProperty(properties, 'intercom.open', conversation.open);
  addBooleanProperty(properties, 'intercom.read', conversation.read);
  addTimestampProperty(properties, 'intercom.created_at', conversation.created_at);
  addTimestampProperty(properties, 'intercom.updated_at', conversation.updated_at);
  addTimestampProperty(properties, 'intercom.waiting_since', conversation.waiting_since);
  addTimestampProperty(properties, 'intercom.snoozed_until', conversation.snoozed_until);

  const source = getRecord(conversation.source);
  if (source) {
    addStringProperty(properties, 'intercom.source.id', source.id);
    addStringProperty(properties, 'intercom.source.type', source.type);
    addStringProperty(properties, 'intercom.source.delivered_as', source.delivered_as);
    addStringProperty(properties, 'intercom.source.subject', source.subject);
    addStringProperty(properties, 'intercom.source.url', source.url);
    const sourceBody = asString(source.body);
    if (sourceBody) {
      comments.push(sourceBody);
      properties['intercom.source.body_length'] = String(sourceBody.length);
    }
    const sourceAuthor = getRecord(source.author);
    if (sourceAuthor) {
      addStringProperty(properties, 'intercom.source.author_id', sourceAuthor.id);
      addStringProperty(properties, 'intercom.source.author_type', sourceAuthor.type);
      addStringProperty(properties, 'intercom.source.author_email', sourceAuthor.email);
      const sourceAuthorId = asString(sourceAuthor.id);
      if (sourceAuthorId && isContactLikeType(sourceAuthor.type)) {
        relations.add(intercomContactPath(sourceAuthorId));
      }
    }
  }

  for (const contact of collectConversationContacts(conversation)) {
    const contactId = asString(contact.id);
    if (!contactId) continue;
    relations.add(intercomContactPath(contactId));
    addStringProperty(properties, 'intercom.contact_id', contactId);
    addStringProperty(properties, 'intercom.contact_email', contact.email);
    addStringProperty(properties, 'intercom.contact_name', contact.name);
  }

  const assignee = getRecord(conversation.assignee);
  if (assignee) {
    addStringProperty(properties, 'intercom.assignee_id', assignee.id);
    addStringProperty(properties, 'intercom.assignee_type', assignee.type);
    addStringProperty(properties, 'intercom.assignee_name', assignee.name);
    addStringProperty(properties, 'intercom.assignee_email', assignee.email);
  }

  const teamAssignee = getRecord(conversation.team_assignee);
  if (teamAssignee) {
    addStringProperty(properties, 'intercom.team_assignee_id', teamAssignee.id);
    addStringProperty(properties, 'intercom.team_assignee_name', teamAssignee.name);
  }

  const tagNames = collectTags(conversation.tags);
  if (tagNames.length > 0) {
    properties['intercom.tags'] = tagNames.join(', ');
    properties['intercom.tag_count'] = String(tagNames.length);
  }

  const parts = collectConversationParts(conversation.conversation_parts);
  if (parts.length > 0) {
    properties['intercom.conversation_part_count'] = String(parts.length);
  }
  for (const part of parts) {
    applyConversationPartSemantics(properties, relations, comments, part);
  }

  const customAttributes = getRecord(conversation.custom_attributes);
  if (customAttributes) {
    applyCustomAttributeProperties(properties, 'intercom.custom', customAttributes);
  }
}

function applyConversationPartSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  part: IntercomConversationPart
): void {
  const partType = asString(part.part_type) ?? asString(part.type);
  if (partType) {
    properties[`intercom.part_type.${partType}`] = 'true';
  }

  const body = asString(part.body);
  if (body) {
    comments.push(body);
  }

  const author = getRecord(part.author);
  if (author) {
    addStringProperty(properties, 'intercom.last_part_author_id', author.id);
    addStringProperty(properties, 'intercom.last_part_author_type', author.type);
    addStringProperty(properties, 'intercom.last_part_author_name', author.name);
    addStringProperty(properties, 'intercom.last_part_author_email', author.email);

    const authorId = asString(author.id);
    if (authorId && isContactLikeType(author.type)) {
      relations.add(intercomContactPath(authorId));
    }
  }

  const assignedTo = getRecord(part.assigned_to);
  if (assignedTo) {
    addStringProperty(properties, 'intercom.last_part_assigned_to_id', assignedTo.id);
    addStringProperty(properties, 'intercom.last_part_assigned_to_type', assignedTo.type);
  }
}

function applyContactSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: IntercomRecord
): void {
  const contact = payload as Partial<IntercomContact> & IntercomRecord;

  addStringProperty(properties, 'intercom.type', contact.type);
  addStringProperty(properties, 'intercom.external_id', contact.external_id);
  addStringProperty(properties, 'intercom.role', contact.role);
  addStringProperty(properties, 'intercom.email', contact.email);
  addStringProperty(properties, 'intercom.phone', contact.phone);
  addStringProperty(properties, 'intercom.name', contact.name);
  addStringProperty(properties, 'intercom.owner_id', contact.owner_id);
  addBooleanProperty(properties, 'intercom.has_hard_bounced', contact.has_hard_bounced);
  addBooleanProperty(properties, 'intercom.marked_email_as_spam', contact.marked_email_as_spam);
  addBooleanProperty(properties, 'intercom.unsubscribed_from_emails', contact.unsubscribed_from_emails);
  addTimestampProperty(properties, 'intercom.created_at', contact.created_at);
  addTimestampProperty(properties, 'intercom.updated_at', contact.updated_at);
  addTimestampProperty(properties, 'intercom.signed_up_at', contact.signed_up_at);
  addTimestampProperty(properties, 'intercom.last_seen_at', contact.last_seen_at);
  addTimestampProperty(properties, 'intercom.last_replied_at', contact.last_replied_at);
  addTimestampProperty(properties, 'intercom.last_contacted_at', contact.last_contacted_at);
  addStringProperty(properties, 'intercom.browser', contact.browser);
  addStringProperty(properties, 'intercom.browser_version', contact.browser_version);
  addStringProperty(properties, 'intercom.browser_language', contact.browser_language);
  addStringProperty(properties, 'intercom.os', contact.os);

  const location = getRecord(contact.location);
  if (location) {
    addStringProperty(properties, 'intercom.location.city', location.city);
    addStringProperty(properties, 'intercom.location.region', location.region);
    addStringProperty(properties, 'intercom.location.country', location.country);
    addStringProperty(properties, 'intercom.location.country_code', location.country_code);
  }

  const tagNames = collectTags(contact.tags);
  if (tagNames.length > 0) {
    properties['intercom.tags'] = tagNames.join(', ');
    properties['intercom.tag_count'] = String(tagNames.length);
  }

  const companyIds = collectCompanyIds(contact.companies);
  if (companyIds.length > 0) {
    properties['intercom.company_ids'] = companyIds.join(', ');
    properties['intercom.company_count'] = String(companyIds.length);
    for (const companyId of companyIds) {
      relations.add(intercomCompanyPath(companyId));
    }
  }

  const customAttributes = getRecord(contact.custom_attributes);
  if (customAttributes) {
    applyCustomAttributeProperties(properties, 'intercom.custom', customAttributes);
  }
}

function applyCompanySemantics(
  properties: Record<string, string>,
  payload: IntercomRecord
): void {
  const company = payload as Partial<IntercomCompany> & IntercomRecord;

  addStringProperty(properties, 'intercom.type', company.type);
  addStringProperty(properties, 'intercom.company_id', company.company_id);
  addStringProperty(properties, 'intercom.name', company.name);
  addStringProperty(properties, 'intercom.app_id', company.app_id);
  addTimestampProperty(properties, 'intercom.remote_created_at', company.remote_created_at);
  addTimestampProperty(properties, 'intercom.created_at', company.created_at);
  addTimestampProperty(properties, 'intercom.updated_at', company.updated_at);
  addTimestampProperty(properties, 'intercom.last_request_at', company.last_request_at);
  addNumberProperty(properties, 'intercom.monthly_spend', company.monthly_spend);
  addNumberProperty(properties, 'intercom.session_count', company.session_count);
  addNumberProperty(properties, 'intercom.user_count', company.user_count);
  addNumberProperty(properties, 'intercom.size', company.size);
  addStringProperty(properties, 'intercom.industry', company.industry);
  addStringProperty(properties, 'intercom.website', company.website);
  addStringProperty(properties, 'intercom.plan', company.plan);

  const tagNames = collectTags(company.tags);
  if (tagNames.length > 0) {
    properties['intercom.tags'] = tagNames.join(', ');
    properties['intercom.tag_count'] = String(tagNames.length);
  }

  const customAttributes = getRecord(company.custom_attributes);
  if (customAttributes) {
    applyCustomAttributeProperties(properties, 'intercom.custom', customAttributes);
  }
}

function collectConversationContacts(
  conversation: Partial<IntercomConversation> & IntercomRecord
): Array<IntercomContact | IntercomReference> {
  const contacts: Array<IntercomContact | IntercomReference> = [];

  if (isRecord(conversation.contact)) {
    contacts.push(conversation.contact as IntercomContact | IntercomReference);
  }

  if (isRecord(conversation.user)) {
    contacts.push(conversation.user as IntercomContact | IntercomReference);
  }

  const collection = unwrapDataArray(conversation.contacts);
  for (const entry of collection) {
    if (isRecord(entry)) {
      contacts.push(entry as IntercomContact | IntercomReference);
    }
  }

  return dedupeById(contacts);
}

function collectConversationParts(value: unknown): IntercomConversationPart[] {
  return unwrapDataArray(value)
    .filter((entry): entry is IntercomRecord => isRecord(entry))
    .map((entry) => entry as IntercomConversationPart);
}

function collectTags(value: unknown): string[] {
  return uniqueStrings(
    unwrapDataArray(value)
      .filter((entry): entry is IntercomTag => isRecord(entry))
      .map((tag) => asString(tag.name))
      .filter((name): name is string => name !== undefined),
  );
}

function collectCompanyIds(value: unknown): string[] {
  return uniqueStrings(
    unwrapDataArray(value)
      .filter((entry): entry is IntercomCompanyReference => isRecord(entry))
      .map((company) => asString(company.id) ?? asString(company.company_id))
      .filter((id): id is string => id !== undefined),
  );
}

function applyCustomAttributeProperties(
  properties: Record<string, string>,
  prefix: string,
  attributes: Record<string, unknown>
): void {
  const keys = Object.keys(attributes).sort((left, right) => left.localeCompare(right));
  for (const key of keys) {
    const value = attributes[key];
    const normalized = primitiveToString(value);
    if (normalized !== undefined) {
      properties[`${prefix}.${key}`] = normalized;
    }
  }
}

function mergeIntercomPayload(event: IntercomWebhookPayload): Record<string, unknown> {
  const item = extractItemRecord(event);
  return {
    ...item,
    _webhook: compactObject<IntercomWebhookEnvelope>({
      action: extractActionFromTopic(event.topic ?? event.action ?? event.event_type ?? event.eventType),
      appId: asString(event.app_id),
      createdAt: stringifyTimestamp(event.created_at),
      eventType: buildEventType(
        inferObjectType(event, item),
        extractActionFromTopic(event.topic ?? event.action ?? event.event_type ?? event.eventType),
      ),
      id: asString(event.id),
      objectId: asString(item.id),
      objectType: inferObjectType(event, item),
      topic: asString(event.topic),
      type: asString(event.type),
    }),
  };
}

function extractItemRecord(event: IntercomWebhookPayload): Record<string, unknown> {
  if (isRecord(event.item)) {
    return event.item;
  }

  const data = getRecord(event.data);
  if (data) {
    const nestedItem = getRecord(data.item);
    if (nestedItem) {
      return nestedItem;
    }
    if (asString(data.id)) {
      return data;
    }
  }

  if (isRecord(event) && asString(event.id)) {
    return event as Record<string, unknown>;
  }

  return {};
}

function inferObjectType(event: IntercomWebhookPayload, item: Record<string, unknown>): string {
  const explicit =
    asString(event.object_type) ??
    asString(event.objectType) ??
    asString(item.type) ??
    firstTopicToken(event.topic);
  if (!explicit) {
    throw new Error('Intercom webhook payload is missing object type metadata');
  }
  return normalizeIntercomObjectType(explicit);
}

function buildEventType(objectType: string, action: string | undefined): string {
  return `${normalizeIntercomObjectType(objectType)}.${action ?? 'updated'}`;
}

function inferWriteCounts(
  event: NormalizedWebhook,
  writeResult: WriteFileResult | void,
  deleted: boolean
): Pick<IngestResult, 'filesDeleted' | 'filesUpdated' | 'filesWritten'> {
  if (deleted) {
    if (writeResult?.created || writeResult?.status === 'created') {
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
  if (action === 'created' || action === 'create') {
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

function inferFallbackPath(event: NormalizedWebhook | IntercomWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeIntercomPath(event.objectType, event.objectId);
    }

    const payload = mergeIntercomPayload(event);
    const objectId = asString(payload.id);
    const objectType = asString(getRecord(payload._webhook)?.objectType) ?? asString(payload.type);
    if (!objectId || !objectType) {
      return '';
    }
    return computeIntercomPath(objectType, objectId);
  } catch {
    return '';
  }
}

function isNormalizedWebhook(event: NormalizedWebhook | IntercomWebhookPayload): event is NormalizedWebhook {
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

function addNumberProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const normalized = asNumber(value);
  if (normalized !== undefined) {
    properties[key] = String(normalized);
  }
}

function addBooleanProperty(properties: Record<string, string>, key: string, value: unknown): void {
  if (typeof value === 'boolean') {
    properties[key] = String(value);
  }
}

function addTimestampProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const normalized = stringifyTimestamp(value);
  if (normalized) {
    properties[key] = normalized;
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

function unwrapDataArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  const record = getRecord(value);
  const data = record?.data;
  if (Array.isArray(data)) {
    return data;
  }

  return [];
}

function dedupeById<T extends { id?: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const value of values) {
    const id = asString(value.id);
    if (!id) {
      output.push(value);
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      output.push(value);
    }
  }
  return output;
}

function isContactLikeType(value: unknown): boolean {
  const type = asString(value)?.toLowerCase();
  return type === 'contact' || type === 'user' || type === 'lead' || type === 'visitor';
}

function firstTopicToken(topic: unknown): string | undefined {
  const normalized = asString(topic);
  if (!normalized) {
    return undefined;
  }
  return normalized.split('.')[0];
}

function extractActionFromTopic(value: unknown): string | undefined {
  const normalized = asString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const parts = normalized.split('.').filter(Boolean);
  return parts.at(-1);
}

function primitiveToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value.trim() : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return undefined;
}

function stringifyTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 10_000_000_000) {
      return new Date(value).toISOString();
    }
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return stringifyTimestamp(numeric);
    }
    return trimmed;
  }

  return undefined;
}

function sortStrings(values: Set<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
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

function asNumber(value: unknown): number | undefined {
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
