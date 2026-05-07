import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  asanaProjectPath,
  asanaSectionPath,
  asanaTaskPath,
  asanaWorkspacePath,
  computeAsanaPath,
  normalizeAsanaObjectType,
} from './path-mapper.js';
import { ASANA_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  AsanaAdapterConfig,
  AsanaCustomField,
  AsanaGidReference,
  AsanaProject,
  AsanaSection,
  AsanaTask,
  AsanaTaskMembership,
  AsanaWebhookEvent,
  AsanaWebhookPayload,
  AsanaWorkspace,
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | AsanaWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  supportedEvents?(): string[];
}

type AsanaRecord = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const ASANA_PROVIDER_NAME = 'asana';
const SUPPORTED_EVENTS = ASANA_WEBHOOK_OBJECT_TYPES;

export class AsanaAdapter extends IntegrationAdapter {
  override readonly name = ASANA_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: AsanaAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: AsanaAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => [
      `${objectType}.added`,
      `${objectType}.changed`,
      `${objectType}.deleted`,
      `${objectType}.removed`,
    ]);
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | AsanaWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const name = readObjectName(normalized.payload);
      const path = computeAsanaPath(normalized.objectType, normalized.objectId, name);
      const semantics = this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload);

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
        const counts = inferWriteCounts(deleteResult, true);
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
      const counts = inferWriteCounts(writeResult, false);
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

  override computePath(objectType: string, objectId: string, name?: string): string {
    return computeAsanaPath(objectType, objectId, name);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeAsanaObjectType(objectType);
    const properties: Record<string, string> = {
      provider: ASANA_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'asana.gid': objectId,
      'asana.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    addFirstStringProperty(properties, 'asana.url', payload.permalink_url, payload.html_url);

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'asana.webhook.action', webhook.action);
      addStringProperty(properties, 'asana.webhook.created_at', webhook.createdAt);
      addStringProperty(properties, 'asana.webhook.delivery_id', webhook.deliveryId);
      addStringProperty(properties, 'asana.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'asana.webhook.parent_gid', getRecord(webhook.parent)?.gid);
      addStringProperty(properties, 'asana.webhook.resource_name', webhook.resourceName);
      addStringProperty(properties, 'asana.webhook.user_gid', getRecord(webhook.user)?.gid);
    }

    switch (normalizedType) {
      case 'task':
        applyTaskSemantics(properties, relations, comments, payload as AsanaRecord);
        break;
      case 'project':
        applyProjectSemantics(properties, relations, comments, payload as AsanaRecord);
        break;
      case 'section':
        applySectionSemantics(properties, relations, payload as AsanaRecord);
        break;
      case 'workspace':
        applyWorkspaceSemantics(properties, payload as AsanaRecord);
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

  private normalizeEvent(event: NormalizedWebhook | AsanaWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || ASANA_PROVIDER_NAME,
        eventType: event.eventType,
        objectType: normalizeAsanaObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const firstEvent = event.events.find(isRecord);
    if (!firstEvent) {
      throw new Error('Asana webhook payload is missing events[0]');
    }

    const resource = getRecord(firstEvent.resource);
    const objectType = normalizeAsanaObjectType(
      asString(resource?.resource_type) ?? asString(firstEvent.type) ?? 'task',
    );
    const objectId = asString(resource?.gid) ?? asString(firstEvent.gid);
    if (!objectId) {
      throw new Error(`Asana ${objectType} webhook is missing resource.gid`);
    }

    const action = normalizeAction(
      asString(firstEvent.action) ?? asString(getRecord(firstEvent.change)?.action) ?? 'changed',
    );
    const payload = mergeAsanaPayload(event, firstEvent, objectType, objectId, action);
    const normalized: NormalizedWebhook = {
      provider: this.config.provider || ASANA_PROVIDER_NAME,
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
    return action === 'deleted' || action === 'removed';
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeAsanaObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function applyTaskSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: AsanaRecord,
): void {
  const task = payload as Partial<AsanaTask> & AsanaRecord;

  addStringProperty(properties, 'asana.name', task.name);
  addStringProperty(properties, 'asana.resource_subtype', task.resource_subtype);
  addFirstStringProperty(properties, 'asana.created_at', task.created_at, task.createdAt);
  addFirstStringProperty(properties, 'asana.modified_at', task.modified_at, task.modifiedAt);
  addStringProperty(properties, 'asana.completed_at', task.completed_at);
  addStringProperty(properties, 'asana.due_at', task.due_at);
  addStringProperty(properties, 'asana.due_on', task.due_on);
  addStringProperty(properties, 'asana.start_at', task.start_at);
  addStringProperty(properties, 'asana.start_on', task.start_on);
  addStringProperty(properties, 'asana.assignee_status', task.assignee_status);
  addBooleanProperty(properties, 'asana.completed', task.completed);
  addBooleanProperty(properties, 'asana.liked', task.liked);
  addNumberProperty(properties, 'asana.actual_time_minutes', task.actual_time_minutes);

  const assignee = task.assignee as AsanaGidReference | null | undefined;
  if (assignee?.gid) {
    addStringProperty(properties, 'asana.assignee_gid', assignee.gid);
    addStringProperty(properties, 'asana.assignee_name', assignee.name);
  }
  addFirstStringProperty(properties, 'asana.assignee_gid', properties['asana.assignee_gid'], task.assignee_gid);
  addFirstStringProperty(properties, 'asana.assignee_name', properties['asana.assignee_name'], task.assignee_name);

  const parent = task.parent as AsanaGidReference | null | undefined;
  if (parent?.gid) {
    relations.add(asanaTaskPath(parent.gid, parent.name));
    addStringProperty(properties, 'asana.parent_gid', parent.gid);
    addStringProperty(properties, 'asana.parent_name', parent.name);
  }
  const parentGid = asString(task.parent_gid);
  if (parentGid) {
    relations.add(asanaTaskPath(parentGid));
    addStringProperty(properties, 'asana.parent_gid', parentGid);
  }

  const workspace = task.workspace as AsanaWorkspace | AsanaGidReference | null | undefined;
  if (workspace?.gid) {
    relations.add(asanaWorkspacePath(workspace.gid, workspace.name));
    addStringProperty(properties, 'asana.workspace_gid', workspace.gid);
    addStringProperty(properties, 'asana.workspace_name', workspace.name);
  }
  const workspaceGid = asString(task.workspace_gid);
  if (workspaceGid) {
    relations.add(asanaWorkspacePath(workspaceGid));
    addStringProperty(properties, 'asana.workspace_gid', workspaceGid);
  }

  const projects = asReferenceArray(task.projects);
  addReferenceList(properties, relations, 'asana.project', projects, asanaProjectPath);

  const memberships = asMemberships(task.memberships);
  const membershipProjects: AsanaGidReference[] = [];
  const membershipSections: AsanaGidReference[] = [];
  for (const membership of memberships) {
    if (membership.project?.gid) {
      membershipProjects.push(membership.project);
    }
    if (membership.section?.gid) {
      membershipSections.push(membership.section);
    }
  }
  addReferenceList(properties, relations, 'asana.membership_project', membershipProjects, asanaProjectPath);
  addReferenceList(properties, relations, 'asana.section', membershipSections, asanaSectionPath);

  const projectIds = asStringArray(task.project_ids);
  if (projectIds.length > 0) {
    addStringListProperty(properties, 'asana.project_gids', projectIds);
    for (const projectId of projectIds) {
      relations.add(asanaProjectPath(projectId));
    }
  }

  const sectionIds = asStringArray(task.section_ids);
  if (sectionIds.length > 0) {
    addStringListProperty(properties, 'asana.section_gids', sectionIds);
    for (const sectionId of sectionIds) {
      relations.add(asanaSectionPath(sectionId));
    }
  }

  const followers = asReferenceArray(task.followers);
  if (followers.length > 0) {
    addStringListProperty(properties, 'asana.follower_gids', followers.map((follower) => follower.gid));
    addStringListProperty(properties, 'asana.followers', followers.map((follower) => follower.name).filter(isString));
  }

  const tags = asReferenceArray(task.tags);
  if (tags.length > 0) {
    addStringListProperty(properties, 'asana.tag_gids', tags.map((tag) => tag.gid));
    addStringListProperty(properties, 'asana.tags', tags.map((tag) => tag.name).filter(isString));
  }

  const customFields = asCustomFields(task.custom_fields);
  if (customFields.length > 0) {
    properties['asana.custom_field_count'] = String(customFields.length);
    for (const customField of customFields) {
      const key = customField.name ? slugPropertyKey(customField.name) : undefined;
      const value = readCustomFieldDisplayValue(customField);
      if (key && value) {
        properties[`asana.custom_field.${key}`] = value;
      }
    }
  }

  const notes = asString(task.notes);
  if (notes) {
    comments.push(notes);
    properties['asana.notes_length'] = String(notes.length);
  }
}

function applyProjectSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: AsanaRecord,
): void {
  const project = payload as Partial<AsanaProject> & AsanaRecord;

  addStringProperty(properties, 'asana.name', project.name);
  addStringProperty(properties, 'asana.color', project.color);
  addStringProperty(properties, 'asana.default_view', project.default_view);
  addFirstStringProperty(properties, 'asana.created_at', project.created_at, project.createdAt);
  addFirstStringProperty(properties, 'asana.modified_at', project.modified_at, project.modifiedAt);
  addStringProperty(properties, 'asana.completed_at', project.completed_at);
  addFirstStringProperty(properties, 'asana.due_on', project.due_on, project.due_date);
  addStringProperty(properties, 'asana.start_on', project.start_on);
  addBooleanProperty(properties, 'asana.archived', project.archived);
  addBooleanProperty(properties, 'asana.completed', project.completed);
  addBooleanProperty(properties, 'asana.public', project.public);

  const owner = project.owner as AsanaGidReference | null | undefined;
  if (owner?.gid) {
    addStringProperty(properties, 'asana.owner_gid', owner.gid);
    addStringProperty(properties, 'asana.owner_name', owner.name);
  }
  addFirstStringProperty(properties, 'asana.owner_gid', properties['asana.owner_gid'], project.owner_gid);
  addFirstStringProperty(properties, 'asana.owner_name', properties['asana.owner_name'], project.owner_name);

  const team = project.team as AsanaGidReference | null | undefined;
  if (team?.gid) {
    addStringProperty(properties, 'asana.team_gid', team.gid);
    addStringProperty(properties, 'asana.team_name', team.name);
  }
  addFirstStringProperty(properties, 'asana.team_gid', properties['asana.team_gid'], project.team_gid);
  addFirstStringProperty(properties, 'asana.team_name', properties['asana.team_name'], project.team_name);

  const workspace = project.workspace as AsanaWorkspace | AsanaGidReference | null | undefined;
  if (workspace?.gid) {
    relations.add(asanaWorkspacePath(workspace.gid, workspace.name));
    addStringProperty(properties, 'asana.workspace_gid', workspace.gid);
    addStringProperty(properties, 'asana.workspace_name', workspace.name);
  }
  const workspaceGid = asString(project.workspace_gid);
  if (workspaceGid) {
    relations.add(asanaWorkspacePath(workspaceGid));
    addStringProperty(properties, 'asana.workspace_gid', workspaceGid);
  }

  const currentStatus = getRecord(project.current_status);
  if (currentStatus) {
    addStringProperty(properties, 'asana.status_gid', currentStatus.gid);
    addStringProperty(properties, 'asana.status_color', currentStatus.color);
    addStringProperty(properties, 'asana.status_title', currentStatus.title);
    addStringProperty(properties, 'asana.status_text', currentStatus.text);
  }

  const notes = asString(project.notes);
  if (notes) {
    comments.push(notes);
    properties['asana.notes_length'] = String(notes.length);
  }
}

function applySectionSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: AsanaRecord,
): void {
  const section = payload as Partial<AsanaSection> & AsanaRecord;

  addStringProperty(properties, 'asana.name', section.name);
  addFirstStringProperty(properties, 'asana.created_at', section.created_at, section.createdAt);

  const project = section.project as AsanaProject | AsanaGidReference | null | undefined;
  if (project?.gid) {
    relations.add(asanaProjectPath(project.gid, project.name));
    addStringProperty(properties, 'asana.project_gid', project.gid);
    addStringProperty(properties, 'asana.project_name', project.name);
  }

  const projects = asReferenceArray(section.projects);
  addReferenceList(properties, relations, 'asana.project', projects, asanaProjectPath);

  const projectId = asString(section.project_gid) ?? asString(section.project_id);
  if (projectId) {
    relations.add(asanaProjectPath(projectId));
    addStringProperty(properties, 'asana.project_gid', projectId);
  }
}

function applyWorkspaceSemantics(
  properties: Record<string, string>,
  payload: AsanaRecord,
): void {
  const workspace = payload as Partial<AsanaWorkspace> & AsanaRecord;

  addStringProperty(properties, 'asana.name', workspace.name);
  addBooleanProperty(properties, 'asana.is_organization', workspace.is_organization);
  const emailDomains = asStringArray(workspace.email_domains);
  if (emailDomains.length > 0) {
    addStringListProperty(properties, 'asana.email_domains', emailDomains);
    properties['asana.email_domain_count'] = String(emailDomains.length);
  }
}

function addReferenceList(
  properties: Record<string, string>,
  relations: Set<string>,
  prefix: string,
  references: AsanaGidReference[],
  pathBuilder: (id: string, name?: string) => string,
): void {
  if (references.length === 0) {
    return;
  }

  const ids: string[] = [];
  const names: string[] = [];
  for (const reference of references) {
    ids.push(reference.gid);
    if (reference.name) {
      names.push(reference.name);
    }
    relations.add(pathBuilder(reference.gid, reference.name));
  }

  addStringListProperty(properties, `${prefix}_gids`, ids);
  addStringListProperty(properties, `${prefix}_names`, names);
  properties[`${prefix}_count`] = String(references.length);
}

function mergeAsanaPayload(
  payload: AsanaWebhookPayload,
  event: AsanaWebhookEvent,
  objectType: string,
  objectId: string,
  action: string,
): Record<string, unknown> {
  const resource = isRecord(event.resource) ? event.resource : {};
  const data = isRecord(payload.data) ? payload.data : {};
  const merged: Record<string, unknown> = {
    ...resource,
    ...data,
    gid: objectId,
    resource_type: objectType,
    events: payload.events as unknown,
  };

  if (payload.sync) {
    merged.sync = payload.sync;
  }
  if (payload.metadata) {
    merged.metadata = payload.metadata;
  }

  const connectionPayload: Record<string, unknown> = {
    provider: payload.provider ?? ASANA_PROVIDER_NAME,
  };
  if (payload.connectionId) {
    connectionPayload.connectionId = payload.connectionId;
  }

  merged._connection = connectionPayload;
  merged._webhook = {
    action,
    createdAt: event.created_at,
    eventType: `${objectType}.${action}`,
    objectId,
    objectType,
    parent: event.parent,
    resourceName: event.resource?.name,
    user: event.user,
  };
  return merged;
}

function isNormalizedWebhook(event: NormalizedWebhook | AsanaWebhookPayload): event is NormalizedWebhook {
  return (
    isRecord(event) &&
    typeof event.eventType === 'string' &&
    typeof event.objectType === 'string' &&
    typeof event.objectId === 'string' &&
    isRecord(event.payload)
  );
}

function inferFallbackPath(event: NormalizedWebhook | AsanaWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeAsanaPath(event.objectType, event.objectId, readObjectName(event.payload));
    }
    const firstEvent = event.events.find(isRecord);
    const resource = getRecord(firstEvent?.resource);
    const objectType = asString(resource?.resource_type) ?? asString(firstEvent?.type) ?? 'task';
    const objectId = asString(resource?.gid);
    if (objectId) {
      return computeAsanaPath(objectType, objectId, asString(resource?.name));
    }
  } catch {
    return '';
  }
  return '';
}

function readObjectName(payload: Record<string, unknown>): string | undefined {
  const directName = asString(payload.name);
  if (directName) {
    return directName;
  }
  const resource = getRecord(payload.resource);
  const resourceName = asString(resource?.name);
  if (resourceName) {
    return resourceName;
  }
  return asString(getRecord(payload._webhook)?.resourceName);
}

function getWebhookAction(payload: Record<string, unknown>): string | undefined {
  const webhook = getRecord(payload._webhook);
  return normalizeOptionalAction(webhook?.action);
}

function getEventAction(eventType: string): string | undefined {
  const [, action] = eventType.split('.', 2);
  return normalizeOptionalAction(action);
}

function normalizeOptionalAction(action: unknown): string | undefined {
  if (typeof action !== 'string') {
    return undefined;
  }
  return normalizeAction(action);
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'add':
    case 'added':
    case 'create':
    case 'created':
      return 'added';
    case 'delete':
    case 'deleted':
      return 'deleted';
    case 'remove':
    case 'removed':
      return 'removed';
    case 'change':
    case 'changed':
    case 'update':
    case 'updated':
      return 'changed';
    default:
      return normalized || 'changed';
  }
}

function inferWriteCounts(
  writeResult: WriteFileResult | void,
  deleted: boolean,
): { filesDeleted: number; filesUpdated: number; filesWritten: number } {
  if (deleted) {
    return {
      filesDeleted: 1,
      filesUpdated: 0,
      filesWritten: 0,
    };
  }
  if (writeResult?.updated || writeResult?.status === 'updated') {
    return {
      filesDeleted: 0,
      filesUpdated: 1,
      filesWritten: 0,
    };
  }
  return {
    filesDeleted: 0,
    filesUpdated: 0,
    filesWritten: 1,
  };
}

function addStringProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
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

function addBooleanProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  if (typeof value === 'boolean') {
    properties[key] = String(value);
  }
}

function addNumberProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    properties[key] = String(value);
  }
}

function addStringListProperty(
  properties: Record<string, string>,
  key: string,
  values: string[],
): void {
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
  if (normalized.length > 0) {
    properties[key] = normalized.join(', ');
  }
}

function asReferenceArray(value: unknown): AsanaGidReference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => getRecord(entry))
    .filter((entry): entry is AsanaRecord => entry !== undefined)
    .map((entry) => {
      const gid = asString(entry.gid);
      if (!gid) {
        return undefined;
      }
      const reference: AsanaGidReference = { gid };
      const name = asString(entry.name);
      if (name) {
        reference.name = name;
      }
      const resourceType = asString(entry.resource_type);
      if (resourceType) {
        reference.resource_type = resourceType;
      }
      return reference;
    })
    .filter((entry): entry is AsanaGidReference => entry !== undefined);
}

function asMemberships(value: unknown): AsanaTaskMembership[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const memberships: AsanaTaskMembership[] = [];
  for (const entry of value) {
    const record = getRecord(entry);
    if (!record) {
      continue;
    }
    const membership: AsanaTaskMembership = {};
    const project = getRecord(record.project);
    if (project) {
      const projectRef = referenceFromRecord(project);
      if (projectRef) {
        membership.project = projectRef;
      }
    }
    const section = getRecord(record.section);
    if (section) {
      const sectionRef = referenceFromRecord(section);
      if (sectionRef) {
        membership.section = sectionRef;
      }
    }
    if (membership.project || membership.section) {
      memberships.push(membership);
    }
  }
  return memberships;
}

function referenceFromRecord(record: AsanaRecord): AsanaGidReference | undefined {
  const gid = asString(record.gid);
  if (!gid) {
    return undefined;
  }
  const reference: AsanaGidReference = { gid };
  const name = asString(record.name);
  if (name) {
    reference.name = name;
  }
  const resourceType = asString(record.resource_type);
  if (resourceType) {
    reference.resource_type = resourceType;
  }
  return reference;
}

function asCustomFields(value: unknown): AsanaCustomField[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => getRecord(entry))
    .filter((entry): entry is AsanaRecord => entry !== undefined)
    .map((entry) => {
      const field: AsanaCustomField = {};
      const gid = asString(entry.gid);
      if (gid) field.gid = gid;
      const name = asString(entry.name);
      if (name) field.name = name;
      const displayValue = asString(entry.display_value);
      if (displayValue) field.display_value = displayValue;
      const textValue = asString(entry.text_value);
      if (textValue) field.text_value = textValue;
      const type = asString(entry.type);
      if (type) field.type = type;
      if (typeof entry.number_value === 'number') field.number_value = entry.number_value;
      const enumValue = getRecord(entry.enum_value);
      if (enumValue) {
        const enumGid = asString(enumValue.gid);
        const enumName = asString(enumValue.name);
        field.enum_value = {
          ...(enumGid ? { gid: enumGid } : {}),
          ...(enumName ? { name: enumName } : {}),
        };
      }
      return field;
    });
}

function readCustomFieldDisplayValue(field: AsanaCustomField): string | undefined {
  return (
    asString(field.display_value) ??
    asString(field.text_value) ??
    asString(field.enum_value?.name) ??
    (typeof field.number_value === 'number' ? String(field.number_value) : undefined)
  );
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== undefined);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is AsanaRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getRecord(value: unknown): AsanaRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function slugPropertyKey(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function sortStrings(values: Set<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
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

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
