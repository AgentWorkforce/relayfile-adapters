import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeLinearPath,
  linearCyclePath,
  linearIssuePath,
  linearMilestonePath,
  linearProjectPath,
  linearRoadmapPath,
  linearTeamPath,
  linearUserPath,
  normalizeLinearObjectType,
} from './path-mapper.js';
import { LINEAR_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  LinearAdapterConfig,
  LinearComment,
  LinearCycle,
  LinearIssue,
  LinearLabel,
  LinearMilestone,
  LinearProject,
  LinearRelation,
  LinearRoadmap,
  LinearState,
  LinearTeam,
  LinearUser,
  LinearWebhookPayload,
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | LinearWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  supportedEvents?(): string[];
}

type LinearRecord = Record<string, unknown>;
type LinearWebhookEnvelope = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SUPPORTED_EVENTS = LINEAR_WEBHOOK_OBJECT_TYPES;
const LINEAR_PROVIDER_NAME = 'linear';

export class LinearAdapter extends IntegrationAdapter {
  override readonly name = LINEAR_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: LinearAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: LinearAdapterConfig = {}
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => [
      `${objectType}.create`,
      `${objectType}.update`,
      `${objectType}.remove`,
    ]);
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | LinearWebhookPayload
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = this.computePath(normalized.objectType, normalized.objectId);

      if (this.isRemoveEvent(normalized)) {
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

  override computePath(objectType: string, objectId: string): string {
    return computeLinearPath(objectType, objectId);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics {
    const normalizedType = normalizeLinearObjectType(objectType);
    const properties: Record<string, string> = {
      provider: LINEAR_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'linear.id': objectId,
      'linear.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    addStringProperty(properties, 'linear.url', payload.url);

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'linear.webhook.action', webhook.action);
      addStringProperty(properties, 'linear.webhook.created_at', webhook.createdAt);
      addStringProperty(properties, 'linear.webhook.organization_id', webhook.organizationId);
      addStringProperty(properties, 'linear.webhook.url', webhook.url);
    }

    switch (normalizedType) {
      case 'issue':
        applyIssueSemantics(properties, relations, payload as LinearRecord);
        break;
      case 'comment':
        applyCommentSemantics(properties, relations, comments, payload as LinearRecord);
        break;
      case 'project':
        applyProjectSemantics(properties, relations, payload as LinearRecord);
        break;
      case 'cycle':
        applyCycleSemantics(properties, payload as LinearRecord);
        break;
      case 'team':
        applyTeamSemantics(properties, payload as LinearRecord);
        break;
      case 'user':
        applyUserSemantics(properties, payload as LinearRecord);
        break;
      case 'milestone':
        applyMilestoneSemantics(properties, relations, payload as LinearRecord);
        break;
      case 'roadmap':
        applyRoadmapSemantics(properties, relations, payload as LinearRecord);
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

  private normalizeEvent(event: NormalizedWebhook | LinearWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || LINEAR_PROVIDER_NAME,
        eventType: event.eventType,
        objectType: normalizeLinearObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const objectType = normalizeLinearObjectType(event.type);
    const objectId = extractPayloadId(event.data);
    if (!objectId) {
      throw new Error(`Linear ${objectType} webhook is missing data.id`);
    }

    const payload = mergeLinearPayload(event);

    const normalized: NormalizedWebhook = {
      provider: this.config.provider || LINEAR_PROVIDER_NAME,
      eventType: `${objectType}.${String(event.action)}`,
      objectType,
      objectId,
      payload,
    };
    if (this.config.connectionId) {
      normalized.connectionId = this.config.connectionId;
    }
    return normalized;
  }

  private isRemoveEvent(event: NormalizedWebhook): boolean {
    const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
    return action === 'remove';
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeLinearObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function applyIssueSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: LinearRecord
): void {
  const issue = payload as Partial<LinearIssue> & LinearRecord;

  addStringProperty(properties, 'linear.identifier', issue.identifier);
  addStringProperty(properties, 'linear.title', issue.title);
  addFirstStringProperty(properties, 'linear.branch_name', issue.branchName, issue.branch_name);
  addFirstStringProperty(properties, 'linear.due_date', issue.dueDate, issue.due_date);
  addFirstStringProperty(properties, 'linear.created_at', issue.createdAt, issue.created_at);
  addFirstStringProperty(properties, 'linear.updated_at', issue.updatedAt, issue.updated_at);
  addFirstStringProperty(properties, 'linear.completed_at', issue.completedAt, issue.completed_at);
  addFirstStringProperty(properties, 'linear.canceled_at', issue.canceledAt, issue.canceled_at);
  addNumberProperty(properties, 'linear.estimate', issue.estimate);

  const priority = asNumber(issue.priority);
  if (priority !== undefined) {
    properties['linear.priority'] = String(priority);
    properties['linear.priority_label'] = mapPriorityLabel(priority);
  }

  const state = issue.state as LinearState | null | undefined;
  if (state) {
    addStringProperty(properties, 'linear.state_id', state.id);
    addStringProperty(properties, 'linear.state_name', state.name);
    addStringProperty(properties, 'linear.state_type', state.type);
    addStringProperty(properties, 'linear.state_color', state.color);
  }
  addFirstStringProperty(properties, 'linear.state_name', properties['linear.state_name'], issue.state_name);
  addFirstStringProperty(properties, 'linear.state_type', properties['linear.state_type'], issue.state_type);

  const assignee = issue.assignee as LinearUser | null | undefined;
  if (assignee) {
    addStringProperty(properties, 'linear.assignee_id', assignee.id);
    addStringProperty(properties, 'linear.assignee_name', assignee.displayName ?? assignee.name);
    addStringProperty(properties, 'linear.assignee_email', assignee.email);
    addStringProperty(properties, 'linear.assignee_url', assignee.url);
  }
  addFirstStringProperty(properties, 'linear.assignee_id', properties['linear.assignee_id'], issue.assignee_id);
  addFirstStringProperty(properties, 'linear.assignee_name', properties['linear.assignee_name'], issue.assignee_name);
  addFirstStringProperty(properties, 'linear.assignee_email', properties['linear.assignee_email'], issue.assignee_email);

  const creator = issue.creator as LinearUser | null | undefined;
  if (creator) {
    addStringProperty(properties, 'linear.creator_id', creator.id);
    addStringProperty(properties, 'linear.creator_name', creator.displayName ?? creator.name);
  }

  const labels = asLabels(issue.labels);
  if (labels.length > 0) {
    const labelNames = labels
      .map((label) => label.name.trim())
      .filter((name) => name.length > 0)
      .sort((left, right) => left.localeCompare(right));
    if (labelNames.length > 0) {
      properties['linear.labels'] = labelNames.join(', ');
      properties['linear.label_count'] = String(labelNames.length);
    }
  }

  if (issue.project?.id) {
    relations.add(linearProjectPath(issue.project.id));
    addStringProperty(properties, 'linear.project_id', issue.project.id);
    addStringProperty(properties, 'linear.project_name', issue.project.name);
    addStringProperty(properties, 'linear.project_state', issue.project.state);
    addStringProperty(properties, 'linear.project_url', issue.project.url);
  }
  const projectId = asString(issue.project_id);
  if (projectId) {
    relations.add(linearProjectPath(projectId));
    addStringProperty(properties, 'linear.project_id', projectId);
  }
  addFirstStringProperty(properties, 'linear.project_name', properties['linear.project_name'], issue.project_name);

  if (issue.cycle?.id) {
    relations.add(linearCyclePath(issue.cycle.id));
    addStringProperty(properties, 'linear.cycle_id', issue.cycle.id);
    addNumberProperty(properties, 'linear.cycle_number', issue.cycle.number);
    addStringProperty(properties, 'linear.cycle_name', issue.cycle.name);
  }

  if (issue.parent?.id) {
    relations.add(linearIssuePath(issue.parent.id));
    addStringProperty(properties, 'linear.parent_id', issue.parent.id);
  }

  for (const child of issue.children ?? []) {
    if (child.id) {
      relations.add(linearIssuePath(child.id));
    }
  }

  for (const relation of asRelations(issue.relations)) {
    if (relation.relatedIssueId) {
      relations.add(linearIssuePath(relation.relatedIssueId));
    }
  }

  if (issue.team?.id) {
    relations.add(linearTeamPath(issue.team.id));
    addStringProperty(properties, 'linear.team_id', issue.team.id);
    addStringProperty(properties, 'linear.team_key', issue.team.key);
    addStringProperty(properties, 'linear.team_name', issue.team.name);
  }
  const teamId = asString(issue.team_id);
  if (teamId) {
    relations.add(linearTeamPath(teamId));
    addStringProperty(properties, 'linear.team_id', teamId);
  }
  addFirstStringProperty(properties, 'linear.team_key', properties['linear.team_key'], issue.team_key);
  addFirstStringProperty(properties, 'linear.team_name', properties['linear.team_name'], issue.team_name);
}

function applyCommentSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: LinearRecord
): void {
  const comment = payload as Partial<LinearComment> & LinearRecord;

  addFirstStringProperty(properties, 'linear.created_at', comment.createdAt, comment.created_at);
  addFirstStringProperty(properties, 'linear.updated_at', comment.updatedAt, comment.updated_at);

  const author = comment.user as LinearUser | null | undefined;
  if (author) {
    const authorUserId = asString(author.id);
    if (authorUserId) {
      relations.add(linearUserPath(authorUserId));
      addStringProperty(properties, 'linear.author_id', authorUserId);
    }
    addStringProperty(properties, 'linear.author_name', author.displayName ?? author.name);
    addStringProperty(properties, 'linear.author_email', author.email);
    addStringProperty(properties, 'linear.author_url', author.url);
  }
  const authorId = asString(comment.user_id) ?? asString(comment.author_id);
  if (authorId) {
    relations.add(linearUserPath(authorId));
  }
  addFirstStringProperty(properties, 'linear.author_id', properties['linear.author_id'], comment.user_id, comment.author_id);
  addFirstStringProperty(properties, 'linear.author_name', properties['linear.author_name'], comment.user_name, comment.author_name);
  addFirstStringProperty(properties, 'linear.author_email', properties['linear.author_email'], comment.user_email, comment.author_email);

  if (comment.issue?.id) {
    relations.add(linearIssuePath(comment.issue.id));
    addStringProperty(properties, 'linear.issue_id', comment.issue.id);
    addStringProperty(properties, 'linear.issue_identifier', comment.issue.identifier);
    addStringProperty(properties, 'linear.issue_title', comment.issue.title);
    addStringProperty(properties, 'linear.issue_url', comment.issue.url);
  }
  const issueId = asString(comment.issue_id);
  if (issueId) {
    relations.add(linearIssuePath(issueId));
    addStringProperty(properties, 'linear.issue_id', issueId);
  }
  addFirstStringProperty(properties, 'linear.issue_identifier', properties['linear.issue_identifier'], comment.issue_identifier);
  addFirstStringProperty(properties, 'linear.issue_title', properties['linear.issue_title'], comment.issue_title);
  addFirstStringProperty(properties, 'linear.issue_url', properties['linear.issue_url'], comment.issue_url);

  const body = asString(comment.body);
  if (body) {
    comments.push(body);
    properties['linear.comment_length'] = String(body.length);
  }
}

function applyProjectSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: LinearRecord
): void {
  const project = payload as Partial<LinearProject> & LinearRecord;

  addStringProperty(properties, 'linear.name', project.name);
  addStringProperty(properties, 'linear.state', project.state);
  addFirstStringProperty(properties, 'linear.description', project.description);
  addFirstStringProperty(properties, 'linear.target_date', project.targetDate, project.target_date);
  addFirstStringProperty(properties, 'linear.started_at', project.startedAt, project.started_at);
  addFirstStringProperty(properties, 'linear.completed_at', project.completedAt, project.completed_at);
  addFirstStringProperty(properties, 'linear.created_at', project.createdAt, project.created_at);
  addFirstStringProperty(properties, 'linear.updated_at', project.updatedAt, project.updated_at);

  const progress = asNumber(project.progress);
  if (progress !== undefined) {
    properties['linear.progress'] = String(progress);
  }

  const teamIds = uniqueStrings([
    ...asStringArray(project.team_ids),
    ...asLinearReferenceIds(project.teams),
  ]);
  if (teamIds.length > 0) {
    properties['linear.team_ids'] = teamIds.join(', ');
    properties['linear.team_count'] = String(teamIds.length);
    for (const teamId of teamIds) {
      relations.add(linearTeamPath(teamId));
    }
  }
}

function applyCycleSemantics(properties: Record<string, string>, payload: LinearRecord): void {
  const cycle = payload as Partial<LinearCycle> & LinearRecord;

  addNumberProperty(properties, 'linear.number', cycle.number);
  addStringProperty(properties, 'linear.name', cycle.name);
  addStringProperty(properties, 'linear.starts_at', cycle.startsAt);
  addStringProperty(properties, 'linear.ends_at', cycle.endsAt);
  addStringProperty(properties, 'linear.completed_at', cycle.completedAt);
}

function applyTeamSemantics(properties: Record<string, string>, payload: LinearRecord): void {
  const team = payload as Partial<LinearTeam> & LinearRecord;

  addStringProperty(properties, 'linear.name', team.name);
  addStringProperty(properties, 'linear.key', team.key);
  addFirstStringProperty(properties, 'linear.description', team.description);
  addFirstStringProperty(properties, 'linear.created_at', team.createdAt, team.created_at);
  addFirstStringProperty(properties, 'linear.updated_at', team.updatedAt, team.updated_at);
}

function applyUserSemantics(properties: Record<string, string>, payload: LinearRecord): void {
  const user = payload as Partial<LinearUser> & LinearRecord;

  addStringProperty(properties, 'linear.name', user.name);
  addFirstStringProperty(properties, 'linear.display_name', user.displayName, user.display_name);
  addFirstStringProperty(properties, 'linear.first_name', user.firstName, user.first_name);
  addFirstStringProperty(properties, 'linear.last_name', user.lastName, user.last_name);
  addStringProperty(properties, 'linear.email', user.email);
  addBooleanProperty(properties, 'linear.admin', user.admin);
  addFirstStringProperty(properties, 'linear.avatar_url', user.avatarUrl, user.avatar_url);
  addFirstStringProperty(properties, 'linear.updated_at', user.updatedAt, user.updated_at);
}

function applyMilestoneSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: LinearRecord
): void {
  const milestone = payload as Partial<LinearMilestone> & LinearRecord;

  addStringProperty(properties, 'linear.name', milestone.name);
  addStringProperty(properties, 'linear.status', milestone.status);
  addFirstStringProperty(properties, 'linear.description', milestone.description);
  addFirstStringProperty(properties, 'linear.created_at', milestone.createdAt, milestone.created_at);
  addFirstStringProperty(properties, 'linear.updated_at', milestone.updatedAt, milestone.updated_at);

  const progress = asNumber(milestone.progress);
  if (progress !== undefined) {
    properties['linear.progress'] = String(progress);
  }

  const projectId = asString(milestone.project?.id) ?? asString(milestone.project_id);
  if (projectId) {
    relations.add(linearProjectPath(projectId));
    addStringProperty(properties, 'linear.project_id', projectId);
  }
  addFirstStringProperty(properties, 'linear.project_name', milestone.project?.name, milestone.project_name);
}

function applyRoadmapSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: LinearRecord
): void {
  const roadmap = payload as Partial<LinearRoadmap> & LinearRecord;

  addStringProperty(properties, 'linear.name', roadmap.name);
  addFirstStringProperty(properties, 'linear.description', roadmap.description);
  addFirstStringProperty(properties, 'linear.created_at', roadmap.createdAt, roadmap.created_at);
  addFirstStringProperty(properties, 'linear.updated_at', roadmap.updatedAt, roadmap.updated_at);

  const projectIds = uniqueStrings([
    ...asStringArray(roadmap.project_ids),
    ...asLinearReferenceIds(roadmap.projects),
  ]);
  if (projectIds.length > 0) {
    properties['linear.project_ids'] = projectIds.join(', ');
    properties['linear.project_count'] = String(projectIds.length);
    for (const projectId of projectIds) {
      relations.add(linearProjectPath(projectId));
    }
  }

  const teamIds = uniqueStrings([
    ...asStringArray(roadmap.team_ids),
    ...asLinearReferenceIds(roadmap.teams),
  ]);
  if (teamIds.length > 0) {
    properties['linear.team_ids'] = teamIds.join(', ');
    properties['linear.team_count'] = String(teamIds.length);
    for (const teamId of teamIds) {
      relations.add(linearTeamPath(teamId));
    }
  }
}

function asLabels(labels: LinearIssue['labels']): LinearLabel[] {
  return Array.isArray(labels) ? labels.filter((label): label is LinearLabel => Boolean(label?.name)) : [];
}

function asRelations(relations: LinearIssue['relations']): LinearRelation[] {
  return Array.isArray(relations)
    ? relations.filter((relation): relation is LinearRelation => Boolean(relation?.relatedIssueId))
    : [];
}

function mergeLinearPayload(event: LinearWebhookPayload): Record<string, unknown> {
  const data = getRecord(event.data) ?? {};
  return {
    ...data,
    _webhook: compactObject<LinearWebhookEnvelope>({
      action: asString(event.action),
      actionBy: event.actionBy ?? undefined,
      createdAt: asString(event.createdAt),
      organization: event.organization ?? undefined,
      organizationId: asString(event.organizationId),
      previousData: event.previousData ?? undefined,
      type: asString(event.type),
      url: asString(event.url),
    }),
  };
}

function inferWriteCounts(
  event: NormalizedWebhook,
  writeResult: WriteFileResult | void,
  deleted: boolean
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
  if (action === 'create') {
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

function inferFallbackPath(event: NormalizedWebhook | LinearWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeLinearPath(event.objectType, event.objectId);
    }

    const objectId = extractPayloadId(event.data);
    if (!objectId) {
      return '';
    }
    return computeLinearPath(event.type, objectId);
  } catch {
    return '';
  }
}

function extractPayloadId(value: unknown): string | undefined {
  const record = getRecord(value);
  return asString(record?.id);
}

function isNormalizedWebhook(event: NormalizedWebhook | LinearWebhookPayload): event is NormalizedWebhook {
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

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== undefined);
}

function asLinearReferenceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => getRecord(entry))
    .map((entry) => asString(entry?.id))
    .filter((entry): entry is string => entry !== undefined);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function mapPriorityLabel(priority: number): string {
  switch (priority) {
    case 0:
      return 'none';
    case 1:
      return 'urgent';
    case 2:
      return 'high';
    case 3:
      return 'normal';
    case 4:
      return 'low';
    default:
      return 'custom';
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
