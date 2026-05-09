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
import { buildLinearIndexFile, type LinearIndexBucket } from './index-emitter.js';
import { linearLayoutPromptFile } from './layout-prompt.js';
import {
  getLinearCommentHumanReadable,
  getLinearIssueHumanReadable,
  type LinearBaseIndexRow,
  type LinearIssueIndexRow,
  linearCommentIndexRow,
  linearIssueIndexRow,
  linearTeamIndexRow,
  linearUserIndexRow,
} from './queries.js';
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

export interface ReadFileInput {
  workspaceId: string;
  path: string;
}

export interface ReadFileResult {
  content?: string;
}

export interface RelayFileClientLike {
  writeFile(input: WriteFileInput): Promise<WriteFileResult | void>;
  deleteFile?(input: DeleteFileInput): Promise<void> | void;
  readFile?(
    inputOrWorkspaceId: ReadFileInput | string,
    path?: string,
  ): Promise<ReadFileResult | string | undefined> | ReadFileResult | string | undefined;
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
      const path = computeLinearPath(
        normalized.objectType,
        normalized.objectId,
        readPathHumanReadable(normalized.objectType, normalized.payload),
      );

      if (this.isRemoveEvent(normalized)) {
        if (this.client.deleteFile) {
          await this.client.deleteFile({ workspaceId, path });
          const auxiliary = await this.writeAuxiliaryFiles(workspaceId, normalized, true);
          return {
            filesWritten: auxiliary.filesWritten,
            filesUpdated: auxiliary.filesUpdated,
            filesDeleted: 1,
            paths: [path, ...auxiliary.paths],
            errors: auxiliary.errors,
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
        const auxiliary = await this.writeAuxiliaryFiles(workspaceId, normalized, true);
        return {
          filesWritten: counts.filesWritten + auxiliary.filesWritten,
          filesUpdated: counts.filesUpdated + auxiliary.filesUpdated,
          filesDeleted: counts.filesDeleted,
          paths: [path, ...auxiliary.paths],
          errors: auxiliary.errors,
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
      const auxiliary = await this.writeAuxiliaryFiles(workspaceId, normalized, false);
      return {
        filesWritten: counts.filesWritten + auxiliary.filesWritten,
        filesUpdated: counts.filesUpdated + auxiliary.filesUpdated,
        filesDeleted: 0,
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
    return computeLinearPath(objectType, objectId, title);
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

  private async writeAuxiliaryFiles(
    workspaceId: string,
    event: NormalizedWebhook,
    deleted: boolean,
  ): Promise<Pick<IngestResult, 'filesWritten' | 'filesUpdated' | 'paths' | 'errors'>> {
    const result: Pick<IngestResult, 'filesWritten' | 'filesUpdated' | 'paths' | 'errors'> = {
      filesWritten: 0,
      filesUpdated: 0,
      paths: [],
      errors: [],
    };

    const layoutFile = linearLayoutPromptFile();
    await this.recordAuxiliaryWrite(result, workspaceId, layoutFile.path, layoutFile.content, layoutFile.contentType);

    const bucket = bucketForObjectType(event.objectType);
    if (!bucket) {
      return result;
    }

    const existingRows = await this.readIndexRows(workspaceId, buildIndexPathForBucket(bucket));
    if (!existingRows) {
      return result;
    }

    const nextRows = deleted
      ? existingRows.filter((row) => row.id !== event.objectId)
      : upsertLinearIndexRow(existingRows, buildIndexRow(bucket, event));
    const indexFile = buildIndexFileForBucket(bucket, nextRows);
    await this.recordAuxiliaryWrite(
      result,
      workspaceId,
      indexFile.path,
      indexFile.content,
      indexFile.contentType,
    );
    return result;
  }

  private async readIndexRows(
    workspaceId: string,
    path: string,
  ): Promise<Array<LinearBaseIndexRow | LinearIssueIndexRow> | undefined> {
    const content = await readClientFile(this.client, workspaceId, path);
    if (content === READ_NOT_AVAILABLE) {
      // No reader on the client — we can't reconcile, so skip the auxiliary write entirely.
      return undefined;
    }
    if (content === undefined) {
      // Reader ran but the index is missing/empty/malformed. Bootstrap with an empty
      // array so the first ingest writes the index instead of getting stuck.
      return [];
    }

    try {
      const parsed = JSON.parse(content) as unknown;
      return Array.isArray(parsed) ? parsed as Array<LinearBaseIndexRow | LinearIssueIndexRow> : [];
    } catch {
      return [];
    }
  }

  private async recordAuxiliaryWrite(
    result: Pick<IngestResult, 'filesWritten' | 'filesUpdated' | 'paths' | 'errors'>,
    workspaceId: string,
    path: string,
    content: string,
    contentType: string,
  ): Promise<void> {
    try {
      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content,
        contentType,
      });
      const counts = inferAuxiliaryWriteCounts(writeResult);
      result.filesWritten += counts.filesWritten;
      result.filesUpdated += counts.filesUpdated;
      result.paths.push(path);
    } catch (error) {
      result.errors.push({
        path,
        error: toErrorMessage(error),
      });
    }
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
    relations.add(buildLinearIssueReferencePath(issue.parent));
    addStringProperty(properties, 'linear.parent_id', issue.parent.id);
  }

  for (const child of issue.children ?? []) {
    if (child.id) {
      relations.add(buildLinearIssueReferencePath(child));
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

function readPathHumanReadable(objectType: string, payload: Record<string, unknown>): string | undefined {
  switch (normalizeLinearObjectType(objectType)) {
    case 'issue':
      return getLinearIssueHumanReadable(buildLinearIssueHumanReadableInput(payload));
    case 'comment':
      return getLinearCommentHumanReadable(buildLinearCommentHumanReadableInput(payload));
    default:
      return undefined;
  }
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
    relations.add(buildLinearIssueReferencePath(comment.issue));
    addStringProperty(properties, 'linear.issue_id', comment.issue.id);
    addStringProperty(properties, 'linear.issue_identifier', comment.issue.identifier);
    addStringProperty(properties, 'linear.issue_title', comment.issue.title);
    addStringProperty(properties, 'linear.issue_url', comment.issue.url);
  }
  const issueId = asString(comment.issue_id);
  if (issueId) {
    relations.add(
      linearIssuePath(
        issueId,
        getLinearIssueHumanReadable(
          buildLinearIssueHumanReadableInput({
            identifier: comment.issue_identifier,
            title: comment.issue_title,
          }),
        ),
      ),
    );
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

function buildLinearIssueReferencePath(issue: {
  id: string;
  identifier?: string | null;
  title?: string | null;
}): string {
  return linearIssuePath(issue.id, getLinearIssueHumanReadable(issue));
}

function buildLinearIssueHumanReadableInput(record: Record<string, unknown>): {
  identifier?: string | null;
  title?: string | null;
} {
  const identifier = asString(record.identifier);
  const title = asString(record.title);
  return {
    ...(identifier ? { identifier } : {}),
    ...(title ? { title } : {}),
  };
}

function buildLinearCommentIssueInput(issue: Record<string, unknown> | undefined): { identifier?: string | null } | undefined {
  const identifier = asString(issue?.identifier);
  return identifier ? { identifier } : undefined;
}

function buildLinearCommentHumanReadableInput(record: Record<string, unknown>): {
  body?: string | null;
  issue?: { identifier?: string | null } | null;
} {
  const body = asString(record.body);
  const issue = buildLinearCommentIssueInput(getRecord(record.issue));
  return {
    ...(body ? { body } : {}),
    ...(issue ? { issue } : {}),
  };
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

function bucketForObjectType(objectType: string): LinearIndexBucket | undefined {
  switch (normalizeLinearObjectType(objectType)) {
    case 'issue':
      return 'issues';
    case 'comment':
      return 'comments';
    case 'team':
      return 'teams';
    case 'user':
      return 'users';
    default:
      return undefined;
  }
}

function buildIndexRow(
  bucket: LinearIndexBucket,
  event: NormalizedWebhook,
): LinearBaseIndexRow | LinearIssueIndexRow {
  const payload = {
    ...event.payload,
    id: event.objectId,
  };

  switch (bucket) {
    case 'issues':
      return linearIssueIndexRow(payload as unknown as Parameters<typeof linearIssueIndexRow>[0]);
    case 'comments':
      return linearCommentIndexRow(payload as unknown as Parameters<typeof linearCommentIndexRow>[0]);
    case 'teams':
      return linearTeamIndexRow(payload as unknown as Parameters<typeof linearTeamIndexRow>[0]);
    case 'users':
      return linearUserIndexRow(payload as unknown as Parameters<typeof linearUserIndexRow>[0]);
  }
}

function buildIndexFileForBucket(
  bucket: LinearIndexBucket,
  rows: Array<LinearBaseIndexRow | LinearIssueIndexRow>,
) {
  switch (bucket) {
    case 'issues':
      return buildLinearIndexFile('issues', rows as LinearIssueIndexRow[]);
    case 'comments':
      return buildLinearIndexFile('comments', rows as LinearBaseIndexRow[]);
    case 'teams':
      return buildLinearIndexFile('teams', rows as LinearBaseIndexRow[]);
    case 'users':
      return buildLinearIndexFile('users', rows as LinearBaseIndexRow[]);
  }
}

function buildIndexPathForBucket(bucket: LinearIndexBucket): string {
  return buildIndexFileForBucket(bucket, []).path;
}

function upsertLinearIndexRow<T extends { id: string }>(rows: T[], row: T): T[] {
  return [...rows.filter((existing) => existing.id !== row.id), row];
}

// `READ_NOT_AVAILABLE` is returned when the client cannot read at all (no
// `readFile` method). `undefined` means the call ran but the file is missing
// or the response was malformed. Callers use this distinction to decide
// whether to skip auxiliary writes (no readFile) or bootstrap an empty index
// (file missing on first ingest).
const READ_NOT_AVAILABLE = Symbol('readNotAvailable');

async function readClientFile(
  client: RelayFileClientLike,
  workspaceId: string,
  path: string,
): Promise<string | undefined | typeof READ_NOT_AVAILABLE> {
  if (!client.readFile) {
    return READ_NOT_AVAILABLE;
  }

  try {
    const value =
      client.readFile.length >= 2
        ? await client.readFile(workspaceId, path)
        : await client.readFile({ workspaceId, path });
    if (typeof value === 'string') {
      return value;
    }
    if (value && typeof value === 'object' && typeof value.content === 'string') {
      return value.content;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function inferAuxiliaryWriteCounts(
  writeResult: WriteFileResult | void,
): Pick<IngestResult, 'filesWritten' | 'filesUpdated'> {
  if (writeResult?.created || writeResult?.status === 'created') {
    return { filesWritten: 1, filesUpdated: 0 };
  }
  return { filesWritten: 0, filesUpdated: 1 };
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
