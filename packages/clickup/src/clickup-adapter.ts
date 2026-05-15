import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  clickUpTaskByAssigneePath,
  clickUpTaskByCreatorPath,
  clickUpTaskByIdAliasPath,
  clickUpTaskByPriorityPath,
  clickUpTaskByStatePath,
  clickUpFolderPath,
  clickUpListPath,
  clickUpSpacePath,
  clickUpTaskPath,
  computeClickUpPath,
  normalizeClickUpObjectType,
} from './path-mapper.js';
import { emitClickUpAuxiliaryFiles } from './emit-auxiliary-files.js';
import { CLICKUP_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  ClickUpAdapterConfig,
  ClickUpCustomField,
  ClickUpFolder,
  ClickUpList,
  ClickUpPriority,
  ClickUpSpace,
  ClickUpStatus,
  ClickUpTask,
  ClickUpUser,
  ClickUpWebhookPayload,
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

  abstract ingestWebhook(workspaceId: string, event: ClickUpWebhookPayload | NormalizedWebhook): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;

  supportedEvents?(): string[];
}

type ClickUpRecord = Record<string, unknown>;
type ClickUpWebhookEnvelope = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SUPPORTED_EVENTS = CLICKUP_WEBHOOK_OBJECT_TYPES;
const CLICKUP_PROVIDER_NAME = 'clickup';

export class ClickUpAdapter extends IntegrationAdapter {
  override readonly name = CLICKUP_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: ClickUpAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: ClickUpAdapterConfig = {},
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
    event: ClickUpWebhookPayload | NormalizedWebhook,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = computeClickUpPath(normalized.objectType, normalized.objectId);

      if (this.isDeleteEvent(normalized)) {
        if (this.client.deleteFile) {
          await this.client.deleteFile({ workspaceId, path });
          const auxiliary = await this.writeTaskAuxiliaryFiles(workspaceId, normalized, undefined, true);
          return {
            filesWritten: 0,
            filesUpdated: 0,
            filesDeleted: 1 + auxiliary.filesDeleted,
            paths: [path, ...auxiliary.paths],
            errors: auxiliary.errors,
          };
        }

        const content = this.renderContent(workspaceId, normalized, true);
        const deleteResult = await this.client.writeFile({
          workspaceId,
          path,
          content,
          contentType: JSON_CONTENT_TYPE,
          semantics: this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload),
        });

        const auxiliary = await this.writeTaskAuxiliaryFiles(workspaceId, normalized, content, false);
        const counts = inferWriteCounts(normalized, deleteResult, true);
        return {
          filesWritten: counts.filesWritten + auxiliary.filesWritten,
          filesUpdated: counts.filesUpdated,
          filesDeleted: counts.filesDeleted + auxiliary.filesDeleted,
          paths: [path, ...auxiliary.paths],
          errors: auxiliary.errors,
        };
      }

      const content = this.renderContent(workspaceId, normalized, false);
      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content,
        contentType: JSON_CONTENT_TYPE,
        semantics: this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload),
      });

      const auxiliary = await this.writeTaskAuxiliaryFiles(workspaceId, normalized, content, false);
      const counts = inferWriteCounts(normalized, writeResult, false);
      return {
        filesWritten: counts.filesWritten + auxiliary.filesWritten,
        filesUpdated: counts.filesUpdated,
        filesDeleted: auxiliary.filesDeleted,
        paths: [path, ...auxiliary.paths],
        errors: auxiliary.errors,
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

  override computePath(objectType: string, objectId: string, title?: string): string {
    return computeClickUpPath(objectType, objectId, title);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeClickUpObjectType(objectType);
    const properties: Record<string, string> = {
      provider: CLICKUP_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'clickup.id': objectId,
      'clickup.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];
    const permissions = new Set<string>();

    addStringProperty(properties, 'clickup.url', payload.url);
    addStringProperty(properties, 'clickup.team_id', payload.team_id);

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'clickup.webhook.action', webhook.action);
      addStringProperty(properties, 'clickup.webhook.event', webhook.event);
      addStringProperty(properties, 'clickup.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'clickup.webhook.webhook_id', webhook.webhookId);
    }

    switch (normalizedType) {
      case 'folder':
        applyFolderSemantics(properties, relations, permissions, payload as ClickUpRecord);
        break;
      case 'list':
        applyListSemantics(properties, relations, permissions, payload as ClickUpRecord);
        break;
      case 'space':
        applySpaceSemantics(properties, permissions, payload as ClickUpRecord);
        break;
      case 'task':
        applyTaskSemantics(properties, relations, permissions, comments, payload as ClickUpRecord);
        break;
    }

    const semantics: FileSemantics = {
      properties,
      relations: sortStrings(relations),
      permissions: sortStrings(permissions),
    };
    if (comments.length > 0) {
      semantics.comments = comments;
    }
    return compactSemantics(semantics);
  }

  private normalizeEvent(event: ClickUpWebhookPayload | NormalizedWebhook): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || CLICKUP_PROVIDER_NAME,
        eventType: canonicalizeEventType(event.eventType, event.objectType),
        objectType: normalizeClickUpObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: flattenPayload(event.payload),
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const objectType = inferWebhookObjectType(event);
    const objectId = inferWebhookObjectId(event, objectType);
    const eventType = canonicalizeEventType(event.event, objectType);
    let action = getEventAction(eventType) ?? 'updated';
    if (action === 'updated' && objectType === 'task') {
      const data = getRecord(event.data);
      const statusType = asString(getRecord(data?.status)?.type)?.toLowerCase();
      const historyItems = Array.isArray(event.history_items) ? event.history_items as Record<string, unknown>[] : [];
      const statusChanged = historyItems.some((item) => asString(item.field) === 'status');
      if (statusChanged && (statusType === 'closed' || statusType === 'done')) {
        action = 'completed';
      } else if (data?.archived === true && historyItems.some((item) => asString(item.field) === 'archived')) {
        action = 'archived';
      }
    }
    const payload = mergeClickUpPayload(event, objectType, objectId, action);
    const normalized: NormalizedWebhook = {
      provider: this.config.provider || CLICKUP_PROVIDER_NAME,
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
      objectType: normalizeClickUpObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }

  private async writeTaskAuxiliaryFiles(
    workspaceId: string,
    event: NormalizedWebhook,
    content: string | undefined,
    deleted: boolean,
  ): Promise<{ filesWritten: number; filesDeleted: number; paths: string[]; errors: IngestError[] }> {
    if (normalizeClickUpObjectType(event.objectType) !== 'task') {
      return { filesWritten: 0, filesDeleted: 0, paths: [], errors: [] };
    }
    const auxiliary = await emitClickUpAuxiliaryFiles(this.client, {
      workspaceId,
      tasks: [{
        objectId: event.objectId,
        payload: event.payload as unknown as ClickUpTask,
        ...(content ? { content } : {}),
        deleted,
        ...(event.connectionId ? { connectionId: event.connectionId } : {}),
      }],
    });
    return {
      filesWritten: auxiliary.written,
      filesDeleted: auxiliary.deleted,
      paths: auxiliaryPathsForTask(event.payload, event.objectId),
      errors: auxiliary.errors.map((error) => ({
        path: error.path,
        error: error.error,
      })),
    };
  }
}

function auxiliaryPathsForTask(payload: Record<string, unknown>, objectId: string): string[] {
  const paths = [clickUpTaskByIdAliasPath(objectId)];
  const status = clickUpTaskStatus(payload.status);
  if (status) {
    paths.push(clickUpTaskByStatePath(status, objectId));
  }
  for (const assigneeId of clickUpTaskAssigneeIds(payload.assignees)) {
    paths.push(clickUpTaskByAssigneePath(assigneeId, objectId));
  }
  const creator = getRecord(payload.creator);
  const creatorId = creator ? userId(creator as Partial<ClickUpUser>) : asString(payload.creator_id);
  if (creatorId) {
    paths.push(clickUpTaskByCreatorPath(creatorId, objectId));
  }
  const priority = clickUpTaskPriority(payload.priority);
  if (priority) {
    paths.push(clickUpTaskByPriorityPath(priority, objectId));
  }
  return paths;
}

function clickUpTaskStatus(value: unknown): string | undefined {
  const status = getRecord(value);
  return status
    ? asString(status.status) ?? asString(status.name) ?? asString(status.type)
    : asString(value);
}

function clickUpTaskPriority(value: unknown): string | undefined {
  const priority = getRecord(value);
  return priority
    ? asString(priority.priority) ?? asString(priority.name)
    : asString(value);
}

function clickUpTaskAssigneeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const item of value) {
    const assignee = getRecord(item);
    const id = assignee ? userId(assignee as Partial<ClickUpUser>) : undefined;
    if (id) ids.add(id);
  }
  return [...ids];
}

function applyTaskSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  permissions: Set<string>,
  comments: string[],
  payload: ClickUpRecord,
): void {
  const task = payload as Partial<ClickUpTask> & ClickUpRecord;

  addStringProperty(properties, 'clickup.name', task.name);
  addStringProperty(properties, 'clickup.custom_id', task.custom_id);
  addFirstStringProperty(properties, 'clickup.description', task.description, task.text_content);
  addStringProperty(properties, 'clickup.orderindex', task.orderindex);
  addFirstStringProperty(properties, 'clickup.created_at', task.date_created, task.created_at);
  addFirstStringProperty(properties, 'clickup.updated_at', task.date_updated, task.updated_at);
  addStringProperty(properties, 'clickup.closed_at', task.date_closed);
  addStringProperty(properties, 'clickup.done_at', task.date_done);
  addStringProperty(properties, 'clickup.due_date', task.due_date);
  addStringProperty(properties, 'clickup.start_date', task.start_date);
  addBooleanProperty(properties, 'clickup.archived', task.archived);
  addNumberLikeProperty(properties, 'clickup.points', task.points);
  addNumberLikeProperty(properties, 'clickup.time_estimate', task.time_estimate);
  addNumberLikeProperty(properties, 'clickup.time_spent', task.time_spent);

  const status = normalizeStatus(task.status);
  if (status) {
    addStringProperty(properties, 'clickup.status_id', status.id);
    addStringProperty(properties, 'clickup.status', status.status);
    addStringProperty(properties, 'clickup.status_type', status.type);
    addStringProperty(properties, 'clickup.status_color', status.color);
    addNumberLikeProperty(properties, 'clickup.status_orderindex', status.orderindex);
  }

  const priority = normalizePriority(task.priority);
  if (priority) {
    addStringProperty(properties, 'clickup.priority_id', priority.id);
    addStringProperty(properties, 'clickup.priority', priority.priority);
    addStringProperty(properties, 'clickup.priority_color', priority.color);
  }

  const creator = task.creator as ClickUpUser | null | undefined;
  if (creator) {
    addClickUpUserProperties(properties, 'creator', creator);
    const creatorId = userId(creator);
    if (creatorId) {
      relations.add(`clickup:user:${creatorId}`);
    }
  }

  const assigneeIds = collectUserIds(task.assignees);
  if (assigneeIds.length > 0) {
    properties['clickup.assignee_ids'] = assigneeIds.join(', ');
    properties['clickup.assignee_count'] = String(assigneeIds.length);
    for (const assigneeId of assigneeIds) {
      relations.add(`clickup:user:${assigneeId}`);
    }
  }

  const watcherIds = collectUserIds(task.watchers);
  if (watcherIds.length > 0) {
    properties['clickup.watcher_ids'] = watcherIds.join(', ');
    properties['clickup.watcher_count'] = String(watcherIds.length);
    for (const watcherId of watcherIds) {
      relations.add(`clickup:user:${watcherId}`);
    }
  }

  const tagNames = collectTagNames(task.tags);
  if (tagNames.length > 0) {
    properties['clickup.tags'] = tagNames.join(', ');
    properties['clickup.tag_count'] = String(tagNames.length);
    for (const tagName of tagNames) {
      relations.add(`clickup:tag:${tagName}`);
    }
  }

  const listId = asString(task.list?.id) ?? asString(task.list_id);
  if (listId) {
    relations.add(clickUpListPath(listId, task.list?.name));
    addStringProperty(properties, 'clickup.list_id', listId);
  }
  addFirstStringProperty(properties, 'clickup.list_name', task.list?.name, task.list_name);

  const folderId = asString(task.folder?.id) ?? asString(task.folder_id);
  if (folderId) {
    relations.add(clickUpFolderPath(folderId, task.folder?.name));
    addStringProperty(properties, 'clickup.folder_id', folderId);
  }
  addFirstStringProperty(properties, 'clickup.folder_name', task.folder?.name, task.folder_name);

  const spaceId = asString(task.space?.id) ?? asString(task.space_id);
  if (spaceId) {
    relations.add(clickUpSpacePath(spaceId, task.space?.name));
    addStringProperty(properties, 'clickup.space_id', spaceId);
  }
  addFirstStringProperty(properties, 'clickup.space_name', task.space?.name, task.space_name);

  const parentId = asString(task.parent);
  if (parentId) {
    relations.add(clickUpTaskPath(parentId));
    addStringProperty(properties, 'clickup.parent_task_id', parentId);
  }

  for (const dependencyId of collectReferenceIds(task.dependencies)) {
    relations.add(clickUpTaskPath(dependencyId));
    comments.push(`depends_on:${dependencyId}`);
  }

  for (const linkedTaskId of collectReferenceIds(task.linked_tasks)) {
    relations.add(clickUpTaskPath(linkedTaskId));
    comments.push(`linked_task:${linkedTaskId}`);
  }

  const customFieldSummaries = summarizeCustomFields(task.custom_fields);
  if (customFieldSummaries.length > 0) {
    properties['clickup.custom_fields'] = customFieldSummaries.join(', ');
    properties['clickup.custom_field_count'] = String(customFieldSummaries.length);
  }

  if (task.archived === true) {
    permissions.add('state:archived');
  }
}

function applyListSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  permissions: Set<string>,
  payload: ClickUpRecord,
): void {
  const list = payload as Partial<ClickUpList> & ClickUpRecord;

  addStringProperty(properties, 'clickup.name', list.name);
  addStringProperty(properties, 'clickup.content', list.content);
  addNumberLikeProperty(properties, 'clickup.orderindex', list.orderindex);
  addNumberLikeProperty(properties, 'clickup.task_count', list.task_count);
  addStringProperty(properties, 'clickup.due_date', list.due_date);
  addStringProperty(properties, 'clickup.start_date', list.start_date);
  addBooleanProperty(properties, 'clickup.archived', list.archived);
  addBooleanProperty(properties, 'clickup.override_statuses', list.override_statuses);
  addStringProperty(properties, 'clickup.permission_level', list.permission_level);

  const status = normalizeStatus(list.status);
  if (status) {
    addStringProperty(properties, 'clickup.status', status.status);
    addStringProperty(properties, 'clickup.status_color', status.color);
  }

  const priority = normalizePriority(list.priority);
  if (priority) {
    addStringProperty(properties, 'clickup.priority', priority.priority);
    addStringProperty(properties, 'clickup.priority_color', priority.color);
  }

  const assignee = list.assignee as ClickUpUser | null | undefined;
  if (assignee) {
    addClickUpUserProperties(properties, 'assignee', assignee);
    const assigneeId = userId(assignee);
    if (assigneeId) {
      relations.add(`clickup:user:${assigneeId}`);
    }
  }

  const folderId = asString(list.folder?.id) ?? asString(list.folder_id);
  if (folderId) {
    relations.add(clickUpFolderPath(folderId, list.folder?.name));
    addStringProperty(properties, 'clickup.folder_id', folderId);
  }
  addFirstStringProperty(properties, 'clickup.folder_name', list.folder?.name, list.folder_name);

  const spaceId = asString(list.space?.id) ?? asString(list.space_id);
  if (spaceId) {
    relations.add(clickUpSpacePath(spaceId, list.space?.name));
    addStringProperty(properties, 'clickup.space_id', spaceId);
  }
  addFirstStringProperty(properties, 'clickup.space_name', list.space?.name, list.space_name);

  if (list.archived === true) {
    permissions.add('state:archived');
  }
}

function applyFolderSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  permissions: Set<string>,
  payload: ClickUpRecord,
): void {
  const folder = payload as Partial<ClickUpFolder> & ClickUpRecord;

  addStringProperty(properties, 'clickup.name', folder.name);
  addNumberLikeProperty(properties, 'clickup.orderindex', folder.orderindex);
  addNumberLikeProperty(properties, 'clickup.task_count', folder.task_count);
  addBooleanProperty(properties, 'clickup.hidden', folder.hidden);
  addBooleanProperty(properties, 'clickup.archived', folder.archived);
  addBooleanProperty(properties, 'clickup.override_statuses', folder.override_statuses);

  const spaceId = asString(folder.space?.id) ?? asString(folder.space_id);
  if (spaceId) {
    relations.add(clickUpSpacePath(spaceId, folder.space?.name));
    addStringProperty(properties, 'clickup.space_id', spaceId);
  }
  addFirstStringProperty(properties, 'clickup.space_name', folder.space?.name, folder.space_name);

  const listIds = collectReferenceIds(folder.lists);
  if (listIds.length > 0) {
    properties['clickup.list_ids'] = listIds.join(', ');
    properties['clickup.list_count'] = String(listIds.length);
    for (const listId of listIds) {
      relations.add(clickUpListPath(listId));
    }
  }

  if (folder.hidden === true) {
    permissions.add('visibility:hidden');
  }
  if (folder.archived === true) {
    permissions.add('state:archived');
  }
}

function applySpaceSemantics(
  properties: Record<string, string>,
  permissions: Set<string>,
  payload: ClickUpRecord,
): void {
  const space = payload as Partial<ClickUpSpace> & ClickUpRecord;

  addStringProperty(properties, 'clickup.name', space.name);
  addStringProperty(properties, 'clickup.color', space.color);
  addStringProperty(properties, 'clickup.avatar', space.avatar);
  addBooleanProperty(properties, 'clickup.private', space.private);
  addBooleanProperty(properties, 'clickup.admin_can_manage', space.admin_can_manage);
  addBooleanProperty(properties, 'clickup.archived', space.archived);
  addBooleanProperty(properties, 'clickup.multiple_assignees', space.multiple_assignees);

  const statuses = Array.isArray(space.statuses) ? space.statuses.filter(isStatusLike) : [];
  if (statuses.length > 0) {
    properties['clickup.statuses'] = statuses
      .map((status) => status.status)
      .filter((status): status is string => Boolean(status))
      .sort((left, right) => left.localeCompare(right))
      .join(', ');
    properties['clickup.status_count'] = String(statuses.length);
  }

  if (space.private === true) {
    permissions.add('scope:private');
  } else if (space.private === false) {
    permissions.add('scope:workspace');
  }
  if (space.archived === true) {
    permissions.add('state:archived');
  }
}

function mergeClickUpPayload(
  event: ClickUpWebhookPayload,
  objectType: string,
  objectId: string,
  action: string,
): Record<string, unknown> {
  const data = getRecord(event.data) ?? {};
  return {
    ...data,
    id: asString(data.id) ?? objectId,
    _webhook: compactObject<ClickUpWebhookEnvelope>({
      event: asString(event.event),
      action,
      historyItems: event.history_items,
      objectId,
      objectType,
      taskId: asString(event.task_id),
      listId: asString(event.list_id),
      folderId: asString(event.folder_id),
      spaceId: asString(event.space_id),
      webhookId: asString(event.webhook_id),
    }),
  };
}

function flattenPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const data = getRecord(payload.data);
  if (!data) {
    return payload;
  }
  const webhook = getRecord(payload._webhook);
  const connection = getRecord(payload._connection);
  return compactObject({
    ...data,
    _connection: connection,
    _webhook: webhook,
  });
}

function inferWebhookObjectType(event: ClickUpWebhookPayload): string {
  const eventRecord = event as unknown as Record<string, unknown>;
  const explicit = asString(eventRecord.objectType) ?? asString(eventRecord.object_type);
  if (explicit) {
    return normalizeClickUpObjectType(explicit);
  }

  if (event.task_id) return 'task';
  if (event.list_id) return 'list';
  if (event.folder_id) return 'folder';
  if (event.space_id) return 'space';

  const eventName = asString(event.event);
  if (eventName) {
    return normalizeClickUpObjectType(eventName);
  }

  const data = getRecord(event.data);
  if (data?.task_id) return 'task';
  if (data?.list_id) return 'list';
  if (data?.folder_id) return 'folder';
  if (data?.space_id) return 'space';

  throw new Error('ClickUp webhook is missing object type metadata');
}

function inferWebhookObjectId(event: ClickUpWebhookPayload, objectType: string): string {
  const data = getRecord(event.data);
  const value = readTypeSpecificWebhookId(event, data, objectType) ?? asString(data?.id);
  if (!value) {
    throw new Error(`ClickUp ${objectType} webhook is missing an object id`);
  }
  return value;
}

function readTypeSpecificWebhookId(
  event: ClickUpWebhookPayload,
  data: Record<string, unknown> | undefined,
  objectType: string,
): string | undefined {
  switch (objectType) {
    case 'folder':
      return asString(event.folder_id) ?? asString(data?.folder_id);
    case 'list':
      return asString(event.list_id) ?? asString(data?.list_id);
    case 'space':
      return asString(event.space_id) ?? asString(data?.space_id);
    case 'task':
      return asString(event.task_id) ?? asString(data?.task_id);
    default:
      return undefined;
  }
}

function canonicalizeEventType(eventName: string, objectType: string): string {
  const normalizedType = normalizeClickUpObjectType(objectType);
  const normalizedEvent = eventName.trim().toLowerCase();
  if (normalizedEvent.includes('created') || normalizedEvent.includes('create')) {
    return `${normalizedType}.created`;
  }
  if (normalizedEvent.includes('deleted') || normalizedEvent.includes('delete') || normalizedEvent.includes('removed')) {
    return `${normalizedType}.deleted`;
  }
  return `${normalizedType}.updated`;
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

function inferFallbackPath(event: ClickUpWebhookPayload | NormalizedWebhook): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeClickUpPath(event.objectType, event.objectId);
    }

    const objectType = inferWebhookObjectType(event);
    const objectId = inferWebhookObjectId(event, objectType);
    return computeClickUpPath(objectType, objectId);
  } catch {
    return '';
  }
}

function isNormalizedWebhook(event: ClickUpWebhookPayload | NormalizedWebhook): event is NormalizedWebhook {
  return (
    isRecord(event) &&
    typeof event.eventType === 'string' &&
    typeof event.objectType === 'string' &&
    typeof event.objectId === 'string' &&
    isRecord(event.payload)
  );
}

function addClickUpUserProperties(
  properties: Record<string, string>,
  prefix: string,
  user: ClickUpUser,
): void {
  addFirstStringProperty(properties, `clickup.${prefix}_id`, user.id);
  addStringProperty(properties, `clickup.${prefix}_username`, user.username);
  addStringProperty(properties, `clickup.${prefix}_email`, user.email);
  addFirstStringProperty(properties, `clickup.${prefix}_avatar`, user.profilePicture, user.profile_picture);
}

function collectUserIds(users: ClickUpUser[] | undefined): string[] {
  if (!Array.isArray(users)) {
    return [];
  }

  return uniqueStrings(
    users
      .map((user) => userId(user))
      .filter((entry): entry is string => entry !== undefined),
  );
}

function userId(user: ClickUpUser): string | undefined {
  return asString(user.id);
}

function collectTagNames(tags: ClickUpTask['tags']): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return uniqueStrings(
    tags
      .map((tag) => asString(tag.name))
      .filter((entry): entry is string => entry !== undefined),
  );
}

function collectReferenceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value
      .map((entry) => getRecord(entry))
      .map((entry) => asString(entry?.id))
      .filter((entry): entry is string => entry !== undefined),
  );
}

function summarizeCustomFields(fields: ClickUpCustomField[] | undefined): string[] {
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields
    .map((field) => {
      const name = asString(field.name);
      if (!name) {
        return undefined;
      }
      const value = field.value === undefined || field.value === null ? '' : String(field.value);
      return value ? `${name}:${value}` : name;
    })
    .filter((entry): entry is string => entry !== undefined)
    .sort((left, right) => left.localeCompare(right));
}

function normalizeStatus(value: unknown): ClickUpStatus | undefined {
  if (typeof value === 'string') {
    return { status: value };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const status: ClickUpStatus = {};
  addOptional(status, 'id', asString(value.id));
  addOptional(status, 'status', asString(value.status) ?? asString(value.name));
  addOptional(status, 'type', asString(value.type));
  addOptional(status, 'color', asString(value.color));
  addOptional(status, 'orderindex', asString(value.orderindex));
  return Object.keys(status).length > 0 ? status : undefined;
}

function normalizePriority(value: unknown): ClickUpPriority | undefined {
  if (typeof value === 'string') {
    return { priority: value };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const priority: ClickUpPriority = {};
  addOptional(priority, 'id', asString(value.id));
  addOptional(priority, 'priority', asString(value.priority) ?? asString(value.name));
  addOptional(priority, 'color', asString(value.color));
  addOptional(priority, 'orderindex', asString(value.orderindex));
  return Object.keys(priority).length > 0 ? priority : undefined;
}

function isStatusLike(value: unknown): value is ClickUpStatus {
  return isRecord(value) && typeof value.status === 'string';
}

function addOptional<T extends object>(target: T, key: string, value: unknown): void {
  if (value !== undefined) {
    (target as Record<string, unknown>)[key] = value;
  }
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

function addNumberLikeProperty(properties: Record<string, string>, key: string, value: unknown): void {
  const normalized = asString(value);
  if (normalized !== undefined) {
    properties[key] = normalized;
  }
}

function addBooleanProperty(properties: Record<string, string>, key: string, value: unknown): void {
  if (typeof value === 'boolean') {
    properties[key] = String(value);
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
  if (semantics.permissions && semantics.permissions.length > 0) {
    compacted.permissions = semantics.permissions;
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
