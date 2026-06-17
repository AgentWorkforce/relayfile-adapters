import type { ConnectionProvider } from '@relayfile/sdk';
import {
  cleanupStaleAliases,
  readAliasKeyFromContent,
  upsertIndexAtomic,
  type AtomicUpsertOptions,
  type VfsLike,
} from '@relayfile/adapter-core';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeLinearPath,
  LINEAR_PATH_ROOT,
  linearAgentWebhookEventPath,
  linearByIdAliasPath,
  linearByNameAliasPath,
  linearByTitleAliasPath,
  linearCyclePath,
  linearIssueByStatePath,
  linearIssuePath,
  linearLabelByTeamPath,
  linearLabelPath,
  linearMilestonePath,
  linearProjectByStatePath,
  linearProjectByTeamPath,
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
  linearCycleIndexRow,
  linearIssueIndexRow,
  linearLabelIndexRow,
  linearMilestoneIndexRow,
  linearProjectIndexRow,
  linearRoadmapIndexRow,
  linearStateIndexRow,
  linearTeamIndexRow,
  linearUserIndexRow,
} from './queries.js';
import { LINEAR_AGENT_WEBHOOK_EVENTS, LINEAR_WEBHOOK_OBJECT_TYPES } from './types.js';
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
import { normalizeLinearWebhook } from './webhook-normalizer.js';

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
  /**
   * Optional optimistic-concurrency token forwarded to revision-aware
   * backends (e.g. relayfile-client). Backends that ignore the field
   * fall through to plain last-write-wins semantics.
   */
  baseRevision?: string;
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
    const recordEvents = SUPPORTED_EVENTS.flatMap((objectType) => [
      `${objectType}.create`,
      `${objectType}.update`,
      `${objectType}.remove`,
    ]);
    return [...recordEvents, ...LINEAR_AGENT_WEBHOOK_EVENTS];
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | LinearWebhookPayload
  ): Promise<IngestResult> {
    try {
      const agentWebhook = this.normalizeAgentWebhookEvent(event);
      if (agentWebhook) {
        return await this.ingestAgentWebhook(workspaceId, agentWebhook);
      }

      const normalized = this.normalizeEvent(event);
      const payload = normalizeIssuePayloadForWrite(normalized.objectType, normalized.payload);
      const eventForWrite: NormalizedWebhook =
        payload === normalized.payload ? normalized : { ...normalized, payload };
      const path = computeLinearPath(
        eventForWrite.objectType,
        eventForWrite.objectId,
        readPathHumanReadable(eventForWrite.objectType, eventForWrite.payload),
      );
      const content = this.renderContent(workspaceId, eventForWrite, false);
      const semantics = this.computeSemantics(eventForWrite.objectType, eventForWrite.objectId, eventForWrite.payload);
      const aliasErrorPath = inferIssueStateAliasErrorPath(eventForWrite);

      if (this.isRemoveEvent(eventForWrite)) {
        const deletePaths = [path];
        let filesDeleted = 0;
        let filesWritten = 0;
        let filesUpdated = 0;
        const aliasPaths = await resolveRemoveAliasPaths(this.client, workspaceId, eventForWrite);

        if (this.client.deleteFile) {
          await this.client.deleteFile({ workspaceId, path });
          filesDeleted += 1;

          for (const candidatePath of aliasPaths) {
            await this.client.deleteFile({ workspaceId, path: candidatePath });
            deletePaths.push(candidatePath);
            filesDeleted += 1;
          }

          const auxiliary = await this.writeAuxiliaryFiles(workspaceId, eventForWrite, true);
          return {
            filesWritten: filesWritten + auxiliary.filesWritten,
            filesUpdated: filesUpdated + auxiliary.filesUpdated,
            filesDeleted,
            paths: [...deletePaths, ...auxiliary.paths],
            errors: auxiliary.errors,
          };
        }

        const deleteResult = await this.client.writeFile({
          workspaceId,
          path,
          content: this.renderContent(workspaceId, eventForWrite, true),
          contentType: JSON_CONTENT_TYPE,
          semantics,
        });

        const counts = inferWriteCounts(eventForWrite, deleteResult, true);
        filesDeleted += counts.filesDeleted;
        filesWritten += counts.filesWritten;
        filesUpdated += counts.filesUpdated;

        for (const candidatePath of aliasPaths) {
          const aliasDeleteResult = await this.client.writeFile({
            workspaceId,
            path: candidatePath,
            content: this.renderContent(workspaceId, eventForWrite, true),
            contentType: JSON_CONTENT_TYPE,
            semantics,
          });
          const aliasCounts = inferWriteCounts(eventForWrite, aliasDeleteResult, true);
          deletePaths.push(candidatePath);
          filesDeleted += aliasCounts.filesDeleted;
          filesWritten += aliasCounts.filesWritten;
          filesUpdated += aliasCounts.filesUpdated;
        }

        const auxiliary = await this.writeAuxiliaryFiles(workspaceId, eventForWrite, true);
        return {
          filesWritten: filesWritten + auxiliary.filesWritten,
          filesUpdated: filesUpdated + auxiliary.filesUpdated,
          filesDeleted,
          paths: [...deletePaths, ...auxiliary.paths],
          errors: auxiliary.errors,
        };
      }

      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content,
        contentType: JSON_CONTENT_TYPE,
        semantics,
      });
      await writeLinearAliases(this.client, workspaceId, eventForWrite, path, content, semantics);

      const counts = inferWriteCounts(eventForWrite, writeResult, false);
      const auxiliary = await this.writeAuxiliaryFiles(workspaceId, eventForWrite, false);
      const result: IngestResult = {
        filesWritten: counts.filesWritten + auxiliary.filesWritten,
        filesUpdated: counts.filesUpdated + auxiliary.filesUpdated,
        filesDeleted: 0,
        paths: [path, ...auxiliary.paths],
        errors: auxiliary.errors,
      };

      if (eventForWrite.objectType !== 'issue') {
        return result;
      }

      const previousAliasPath = resolvePreviousIssueStateAliasPath(eventForWrite.payload);
      const aliasPath = resolveIssueStateAliasPath(eventForWrite.payload);
      if (previousAliasPath && previousAliasPath !== aliasPath) {
        if (this.client.deleteFile) {
          await this.client.deleteFile({ workspaceId, path: previousAliasPath });
          result.filesDeleted += 1;
        } else {
          const previousDeleteResult = await this.client.writeFile({
            workspaceId,
            path: previousAliasPath,
            content: this.renderContent(workspaceId, eventForWrite, true),
            contentType: JSON_CONTENT_TYPE,
            semantics,
          });
          const previousCounts = inferWriteCounts(eventForWrite, previousDeleteResult, true);
          result.filesWritten += previousCounts.filesWritten;
          result.filesUpdated += previousCounts.filesUpdated;
          result.filesDeleted += previousCounts.filesDeleted;
        }
        result.paths.push(previousAliasPath);
      }

      if (!aliasPath) {
        result.errors.push({
          path: aliasErrorPath,
          error: 'Linear issue is missing state_name or identifier for by-state alias emission.',
        });
        return result;
      }

      const aliasWriteResult = await this.client.writeFile({
        workspaceId,
        path: aliasPath,
        content,
        contentType: JSON_CONTENT_TYPE,
        semantics,
      });
      const aliasCounts = inferWriteCounts(eventForWrite, aliasWriteResult, false);
      result.filesWritten += aliasCounts.filesWritten;
      result.filesUpdated += aliasCounts.filesUpdated;
      result.paths.push(aliasPath);

      return result;
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

  private async ingestAgentWebhook(
    workspaceId: string,
    normalized: NormalizedWebhook,
  ): Promise<IngestResult> {
    const path = linearAgentWebhookEventPath(normalized.eventType, normalized.objectId);
    if (!path) {
      throw new Error(`Unsupported Linear agent webhook event: ${normalized.eventType}`);
    }
    const content = `${JSON.stringify(normalized.payload, null, 2)}\n`;
    const writeResult = await this.client.writeFile({
      workspaceId,
      path,
      content,
      contentType: JSON_CONTENT_TYPE,
      semantics: {
        properties: {
          provider: LINEAR_PROVIDER_NAME,
          'provider.object_id': normalized.objectId,
          'provider.object_type': normalized.objectType,
          'linear.webhook.event_type': normalized.eventType,
        },
      },
    });
    const counts = inferWriteCounts(normalized, writeResult, false);
    return {
      filesWritten: counts.filesWritten,
      filesUpdated: counts.filesUpdated,
      filesDeleted: 0,
      paths: [path],
      errors: [],
    };
  }

  private normalizeAgentWebhookEvent(
    event: NormalizedWebhook | LinearWebhookPayload,
  ): NormalizedWebhook | null {
    try {
      const normalized = isNormalizedWebhook(event)
        ? {
            provider: event.provider || this.config.provider || LINEAR_PROVIDER_NAME,
            eventType: event.eventType,
            objectType: event.objectType,
            objectId: event.objectId.trim(),
            payload: event.payload,
            ...(event.connectionId || this.config.connectionId
              ? { connectionId: event.connectionId || this.config.connectionId }
              : {}),
          }
        : normalizeLinearWebhook(event);
      return linearAgentWebhookEventPath(normalized.eventType, normalized.objectId)
        ? normalized
        : null;
    } catch {
      return null;
    }
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
      case 'label':
        applyLabelSemantics(properties, relations, payload as LinearRecord);
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
    for (const label of labels) {
      if (label.id) {
        relations.add(linearLabelPath(label.id));
      }
    }
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
    addFirstStringProperty(properties, 'linear.project_slug', issue.project.slug, issue.project.slugId);
    addStringProperty(properties, 'linear.project_state', issue.project.state);
    addFirstStringProperty(properties, 'linear.project_lead_id', issue.project.lead?.id, issue.project.leadId);
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
    case 'label':
      return asString(payload.name);
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
  addFirstStringProperty(properties, 'linear.slug', project.slug, project.slugId);
  addFirstStringProperty(properties, 'linear.description', project.description);
  addFirstStringProperty(properties, 'linear.start_date', project.startDate, project.start_date);
  addFirstStringProperty(properties, 'linear.target_date', project.targetDate, project.target_date);
  addFirstStringProperty(properties, 'linear.started_at', project.startedAt, project.started_at);
  addFirstStringProperty(properties, 'linear.completed_at', project.completedAt, project.completed_at);
  addFirstStringProperty(properties, 'linear.created_at', project.createdAt, project.created_at);
  addFirstStringProperty(properties, 'linear.updated_at', project.updatedAt, project.updated_at);
  addFirstStringProperty(properties, 'linear.lead_id', project.lead?.id, project.leadId, project.lead_id);
  addFirstStringProperty(properties, 'linear.color', project.color);
  addFirstStringProperty(properties, 'linear.icon', project.icon);

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

function applyLabelSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: LinearRecord
): void {
  const label = payload as Partial<LinearLabel> & LinearRecord;

  addStringProperty(properties, 'linear.name', label.name);
  addFirstStringProperty(properties, 'linear.description', label.description);
  addStringProperty(properties, 'linear.color', label.color);
  addFirstStringProperty(properties, 'linear.created_at', label.createdAt, label.created_at);
  addFirstStringProperty(properties, 'linear.updated_at', label.updatedAt, label.updated_at);

  const teamId = asString(label.team?.id) ?? asString(label.team_id);
  if (teamId) {
    relations.add(linearTeamPath(teamId));
    addStringProperty(properties, 'linear.team_id', teamId);
  }
  addFirstStringProperty(properties, 'linear.team_name', label.team?.name, label.team_name);

  const parentId = asString(label.parent?.id) ?? asString(label.parentId) ?? asString(label.parent_id);
  if (parentId) {
    relations.add(linearLabelPath(parentId));
    addStringProperty(properties, 'linear.parent_id', parentId);
  }
  addFirstStringProperty(properties, 'linear.parent_name', label.parent?.name);
}

function readProjectTeamIdsFromPayload(payload: LinearRecord): string[] {
  return uniqueStrings([
    ...asStringArray(payload.team_ids),
    ...asLinearReferenceIds(payload.teams),
  ]);
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

function asLabels(labels: LinearIssue['labels'] | unknown): LinearLabel[] {
  const entries = Array.isArray(labels)
    ? labels
    : isRecord(labels) && Array.isArray(labels.nodes)
      ? labels.nodes
      : [];
  const normalized: LinearLabel[] = [];
  for (const entry of entries) {
    const label = getRecord(entry);
    const id = asString(label?.id);
    const name = asString(label?.name);
    if (!label || (!id && !name)) {
      continue;
    }
    normalized.push({
      ...(label as Partial<LinearLabel>),
      id: id ?? '',
      name: name ?? '',
    });
  }
  return normalized;
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

function normalizeIssuePayloadForWrite(objectType: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (normalizeLinearObjectType(objectType) !== 'issue') {
    return payload;
  }

  const state = getRecord(payload.state);
  const stateId = asString(state?.id) ?? asString(payload.stateId) ?? asString(payload.state_id);
  const stateName = asString(state?.name) ?? asString(payload.state_name);
  const stateType = asString(state?.type) ?? asString(payload.state_type);
  const stateColor = asString(state?.color) ?? asString(payload.state_color);
  const labels = normalizeIssueLabelsForWrite(payload);
  if (!stateId && !stateName && !stateType && !stateColor && labels === null) {
    return payload;
  }

  return {
    ...payload,
    ...(stateId || stateName || stateType || stateColor
      ? {
          state: {
            ...state,
            ...(stateId ? { id: stateId } : {}),
            ...(stateName ? { name: stateName } : {}),
            ...(stateType ? { type: stateType } : {}),
            ...(stateColor ? { color: stateColor } : {}),
          },
        }
      : {}),
    ...(labels !== null ? { labels } : {}),
  };
}

function normalizeIssueLabelsForWrite(payload: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const labelsValue = payload.labels;
  const labelEntries = Array.isArray(labelsValue)
    ? labelsValue
    : isRecord(labelsValue) && Array.isArray(labelsValue.nodes)
      ? labelsValue.nodes
      : undefined;

  if (labelEntries) {
    return labelEntries
      .map((entry) => normalizeIssueLabelForWrite(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  const labelNames = asStringArray(payload.labelNames ?? payload.label_names);
  if (labelNames.length > 0) {
    return labelNames.map((name) => ({ name }));
  }

  const labelIds = asStringArray(payload.labelIds ?? payload.label_ids);
  if (labelIds.length > 0) {
    return labelIds.map((id) => ({ id }));
  }

  return null;
}

function normalizeIssueLabelForWrite(value: unknown): Record<string, unknown> | null {
  const label = getRecord(value);
  if (!label) return null;
  const id = asString(label.id);
  const name = asString(label.name);
  const color = asString(label.color);
  if (!id && !name && !color) return null;
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(color ? { color } : {}),
  };
}

function bucketForObjectType(objectType: string): LinearIndexBucket | undefined {
  switch (normalizeLinearObjectType(objectType)) {
    case 'issue':
      return 'issues';
    case 'label':
      return 'labels';
    case 'comment':
      return 'comments';
    case 'cycle':
      return 'cycles';
    case 'milestone':
      return 'milestones';
    case 'project':
      return 'projects';
    case 'roadmap':
      return 'roadmaps';
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
    case 'cycles':
      return linearCycleIndexRow(payload as unknown as Parameters<typeof linearCycleIndexRow>[0]);
    case 'milestones':
      return linearMilestoneIndexRow(payload as unknown as Parameters<typeof linearMilestoneIndexRow>[0]);
    case 'projects':
      return linearProjectIndexRow(payload as unknown as Parameters<typeof linearProjectIndexRow>[0]);
    case 'labels':
      return linearLabelIndexRow(payload as unknown as Parameters<typeof linearLabelIndexRow>[0]);
    case 'roadmaps':
      return linearRoadmapIndexRow(payload as unknown as Parameters<typeof linearRoadmapIndexRow>[0]);
    case 'states':
      return linearStateIndexRow(payload as unknown as Parameters<typeof linearStateIndexRow>[0]);
    case 'teams':
      return linearTeamIndexRow(payload as unknown as Parameters<typeof linearTeamIndexRow>[0]);
    case 'users':
      return linearUserIndexRow(payload as unknown as Parameters<typeof linearUserIndexRow>[0]);
    default:
      throw new Error(`Unsupported Linear index bucket: ${bucket satisfies never}`);
  }
}

function buildIndexFileForBucket(
  bucket: LinearIndexBucket,
  rows: Array<LinearBaseIndexRow | LinearIssueIndexRow>,
): ReturnType<typeof buildLinearIndexFile> {
  switch (bucket) {
    case 'issues':
      return buildLinearIndexFile('issues', rows as LinearIssueIndexRow[]);
    case 'comments':
      return buildLinearIndexFile('comments', rows as LinearBaseIndexRow[]);
    case 'cycles':
      return buildLinearIndexFile('cycles', rows as LinearBaseIndexRow[]);
    case 'milestones':
      return buildLinearIndexFile('milestones', rows as LinearBaseIndexRow[]);
    case 'projects':
      return buildLinearIndexFile('projects', rows as LinearBaseIndexRow[]);
    case 'labels':
      return buildLinearIndexFile('labels', rows as LinearBaseIndexRow[]);
    case 'roadmaps':
      return buildLinearIndexFile('roadmaps', rows as LinearBaseIndexRow[]);
    case 'states':
      return buildLinearIndexFile('states', rows as LinearBaseIndexRow[]);
    case 'teams':
      return buildLinearIndexFile('teams', rows as LinearBaseIndexRow[]);
    case 'users':
      return buildLinearIndexFile('users', rows as LinearBaseIndexRow[]);
    default:
      throw new Error(`Unsupported Linear index bucket: ${bucket satisfies never}`);
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
    void writeResult;
    return { filesWritten: 0, filesUpdated: 0, filesDeleted: 1 };
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

function resolveIssueStateAliasPath(payload: Record<string, unknown>): string | undefined {
  const stateName = asString(payload.state_name);
  const identifier = asString(payload.identifier);
  if (!stateName || !identifier) {
    return undefined;
  }
  return linearIssueByStatePath(stateName, identifier);
}

function resolvePreviousIssueStateAliasPath(payload: Record<string, unknown>): string | undefined {
  const previousData = getRecord(getRecord(payload._webhook)?.previousData);
  if (!previousData) {
    return undefined;
  }

  const stateName = asString(previousData.state_name);
  const identifier = asString(previousData.identifier) ?? asString(payload.identifier);
  if (!stateName || !identifier) {
    return undefined;
  }

  return linearIssueByStatePath(stateName, identifier);
}

function inferIssueStateAliasErrorPath(event: NormalizedWebhook): string {
  const identifier = asString(event.payload.identifier);
  if (identifier) {
    return `/linear/issues/by-state/<missing-state>/${encodeURIComponent(identifier)}.json`;
  }
  return '/linear/issues/by-state/<missing-state>/<missing-identifier>.json';
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

interface LinearIndexRow {
  file: string;
  title: string;
}

async function writeLinearAliases(
  client: RelayFileClientLike,
  workspaceId: string,
  event: NormalizedWebhook,
  canonicalPath: string,
  content: string,
  semantics: FileSemantics,
): Promise<void> {
  // duplicate write — the adapter only has a file-write interface, so aliases store the canonical bytes verbatim.
  const normalizedType = normalizeLinearObjectType(event.objectType);
  if (normalizedType !== 'issue' && normalizedType !== 'project' && normalizedType !== 'label') {
    return;
  }

  const scope = scopeForAliasObjectType(normalizedType);
  const title = normalizedType === 'issue' ? asString(event.payload.title) : asString(event.payload.name);
  const byId = normalizedType === 'issue'
    ? asString(event.payload.identifier) ?? event.objectId
    : event.objectId;

  const byIdAliasPath = linearByIdAliasPath(scope, byId);
  // Snapshot the previous record version before the by-id alias is
  // overwritten — it carries the prior title/name for stale alias cleanup.
  const previousContent = await readLinearFile(client, byIdAliasPath, workspaceId);
  await writeLinearIndex(client, workspaceId, scope, { objectType: normalizedType });
  await writeLinearFile(client, workspaceId, byIdAliasPath, content, semantics);

  let writtenAliasPath: string | undefined;
  if (title) {
    const baseAliasPath = normalizedType === 'issue'
      ? linearByTitleAliasPath(scope, title, event.objectId)
      : linearByNameAliasPath(scope, title, event.objectId);
    const existingBaseContent = await readLinearFile(client, baseAliasPath, workspaceId);
    // A base alias holding this record's previous bytes is ours — overwrite
    // it in place instead of forking to the collision variant.
    const ownsBaseAlias =
      existingBaseContent !== undefined && existingBaseContent === previousContent;
    const aliasPath =
      existingBaseContent !== undefined && existingBaseContent !== content && !ownsBaseAlias
        ? normalizedType === 'issue'
          ? linearByTitleAliasPath(scope, title, event.objectId, true)
          : linearByNameAliasPath(scope, title, event.objectId, true)
        : baseAliasPath;

    await writeLinearFile(client, workspaceId, aliasPath, content, semantics);
    writtenAliasPath = aliasPath;
  }

  if (normalizedType === 'project') {
    const state = asString(event.payload.state);
    if (state) {
      await writeLinearFile(client, workspaceId, linearProjectByStatePath(state, event.objectId), content, semantics);
    }
    for (const teamId of readProjectTeamIdsFromPayload(event.payload)) {
      await writeLinearFile(client, workspaceId, linearProjectByTeamPath(teamId, event.objectId), content, semantics);
    }
  }
  if (normalizedType === 'label') {
    const teamId = asString((event.payload.team as LinearTeam | undefined)?.id) ?? asString(event.payload.team_id);
    if (teamId) {
      await writeLinearFile(client, workspaceId, linearLabelByTeamPath(teamId, event.objectId), content, semantics);
    }
  }

  // Stale alias lifecycle (issue #106): delete the previous by-title alias
  // when the record's title/name changed. Only the stale alias file is
  // removed — the canonical record file is never touched.
  await cleanupStaleLinearTitleAliases(client, workspaceId, {
    scope,
    objectType: normalizedType,
    objectId: event.objectId,
    previousContent,
    keepPaths: writtenAliasPath ? [writtenAliasPath] : [],
  });
}

function scopeForAliasObjectType(objectType: 'issue' | 'project' | 'label'): string {
  switch (objectType) {
    case 'issue':
      return `${LINEAR_PATH_ROOT}/issues`;
    case 'project':
      return `${LINEAR_PATH_ROOT}/projects`;
    case 'label':
      return `${LINEAR_PATH_ROOT}/labels`;
  }
}

/**
 * Removes the stale human-readable alias left behind when an issue title or
 * project name changes between ingests (issue #106).
 *
 * Prior state comes from the mirror itself: the title-independent `by-id`
 * alias stores the canonical bytes of the previous record version, read
 * before being overwritten. The previous title/name is extracted from that
 * snapshot, the alias paths the previous version may occupy (base +
 * collision variants) are derived, and a candidate is deleted only when its
 * bytes still match the snapshot — proving it belonged to this record and
 * not to a different record sharing the slug.
 *
 * No-ops when the client exposes no `deleteFile` or when prior state is
 * unavailable. Never deletes canonical record files — a title change is an
 * alias cleanup, not a record deletion.
 */
async function cleanupStaleLinearTitleAliases(
  client: RelayFileClientLike,
  workspaceId: string,
  options: {
    scope: string;
    objectType: 'issue' | 'project' | 'label';
    objectId: string;
    previousContent: string | undefined;
    keepPaths: readonly string[];
  },
): Promise<void> {
  const { scope, objectType, objectId, previousContent, keepPaths } = options;
  const deleteFile = client.deleteFile;
  if (previousContent === undefined || !deleteFile) {
    return;
  }

  // Ownership guard: the by-id alias is last-write-wins, so when two records
  // claim the same identifier the snapshot may belong to a different record.
  // Never clean up aliases on behalf of another record.
  const previousObjectId = readAliasKeyFromContent(previousContent, 'objectId');
  if (previousObjectId !== undefined && previousObjectId !== objectId) {
    return;
  }

  const previousTitle = readAliasKeyFromContent(
    previousContent,
    'payload',
      objectType === 'issue' ? 'title' : 'name',
  );
  if (!previousTitle) {
    return;
  }

  const candidatePaths: string[] = [];
  try {
    candidatePaths.push(
      objectType === 'issue'
        ? linearByTitleAliasPath(scope, previousTitle, objectId)
        : linearByNameAliasPath(scope, previousTitle, objectId),
      objectType === 'issue'
        ? linearByTitleAliasPath(scope, previousTitle, objectId, true)
        : linearByNameAliasPath(scope, previousTitle, objectId, true),
    );
  } catch {
    // Previous title slugs to an empty string — no alias was emitted for it.
    return;
  }

  await cleanupStaleAliases(
    {
      readFile: (path) => readLinearFile(client, path, workspaceId),
      deleteFile: (path) => deleteFile.call(client, { workspaceId, path }),
    },
    {
      previousContent,
      candidatePaths,
      keepPaths,
    },
  );
}

async function resolveRemoveAliasPaths(
  client: RelayFileClientLike,
  workspaceId: string,
  event: NormalizedWebhook,
): Promise<string[]> {
  const normalizedType = normalizeLinearObjectType(event.objectType);
  if (normalizedType === 'issue') {
    return uniqueStrings([
      resolveIssueStateAliasPath(event.payload),
      resolvePreviousIssueStateAliasPath(event.payload),
    ]);
  }
  if (normalizedType !== 'label') {
    return [];
  }

  const scope = `${LINEAR_PATH_ROOT}/labels`;
  const byIdPath = linearByIdAliasPath(scope, event.objectId);
  const previousContent =
    await readLinearFile(client, byIdPath, workspaceId)
    ?? await readLinearFile(client, linearLabelPath(event.objectId), workspaceId);
  const labelName = asString(event.payload.name)
    ?? (previousContent ? readAliasKeyFromContent(previousContent, 'payload', 'name') : undefined);
  const teamId = readLabelTeamId(event.payload)
    ?? readLabelTeamIdFromContent(previousContent);
  const paths: string[] = [byIdPath];

  if (teamId) {
    paths.push(linearLabelByTeamPath(teamId, event.objectId));
  }
  if (labelName) {
    paths.push(linearByNameAliasPath(scope, labelName, event.objectId, true));
    const baseNamePath = linearByNameAliasPath(scope, labelName, event.objectId);
    const baseNameContent = await readLinearFile(client, baseNamePath, workspaceId);
    if (baseNameContent && readAliasKeyFromContent(baseNameContent, 'objectId') === event.objectId) {
      paths.push(baseNamePath);
    }
  }

  return uniqueStrings(paths);
}

function readLabelTeamId(payload: Record<string, unknown>): string | undefined {
  return asString((payload.team as LinearTeam | undefined)?.id) ?? asString(payload.team_id);
}

function readLabelTeamIdFromContent(content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(content) as { payload?: { team?: { id?: unknown }; team_id?: unknown } };
    return asString(parsed.payload?.team?.id) ?? asString(parsed.payload?.team_id);
  } catch {
    return undefined;
  }
}

async function writeLinearIndex(
  client: RelayFileClientLike,
  workspaceId: string,
  scope: string,
  options?: AtomicUpsertOptions & { objectType?: 'issue' | 'project' | 'label' },
): Promise<void> {
  const indexPath = `${scope}/_index.json`;
  const vfs = linearClientToVfs(client, workspaceId);

  await upsertIndexAtomic<LinearIndexRow>(
    vfs,
    indexPath,
    parseLinearIndexRows,
    (rows) => mergeLinearIndexRowsList(rows, indexAliasRows(options?.objectType)),
    (rows) => stableJson({ rows }),
    options,
  );
}

function indexAliasRows(objectType: 'issue' | 'project' | 'label' | undefined): LinearIndexRow[] {
  if (objectType === 'project') {
    return [
      { title: 'by-id', file: 'by-id/' },
      { title: 'by-name', file: 'by-name/' },
      { title: 'by-state', file: 'by-state/' },
      { title: 'by-team', file: 'by-team/' },
    ];
  }
  if (objectType === 'label') {
    return [
      { title: 'by-id', file: 'by-id/' },
      { title: 'by-name', file: 'by-name/' },
      { title: 'by-team', file: 'by-team/' },
    ];
  }
  return [
    { title: 'by-id', file: 'by-id/' },
    { title: 'by-title', file: 'by-title/' },
  ];
}

/**
 * Wrap the linear `RelayFileClientLike` (single-input WriteFileInput shape)
 * in the duck-typed `VfsLike` contract the atomic-index helper consumes.
 *
 * The helper invokes `writeFile(path, content, { baseRevision })`; we
 * translate that into the linear-style `writeFile({ workspaceId, path,
 * content, baseRevision, ... })`. Reading a missing file currently surfaces
 * as `undefined` from the underlying `readLinearFile`; we represent that
 * to the helper as a fresh-revision read.
 */
function linearClientToVfs(client: RelayFileClientLike, workspaceId: string): VfsLike {
  return {
    async readFile(path: string): Promise<{ content: string; revision: string } | undefined> {
      const reader = (client as unknown as Record<string, unknown>).readFile;
      if (typeof reader !== 'function') {
        return undefined;
      }
      try {
        const value = await readLinearFileWithFallbacks(client, path, workspaceId);
        if (typeof value === 'string') {
          return { content: value, revision: '0' };
        }
        if (value && typeof value === 'object') {
          const record = value as { content?: unknown; revision?: unknown };
          if (typeof record.content !== 'string') {
            return undefined;
          }
          const revision = typeof record.revision === 'string' ? record.revision : '0';
          return { content: record.content, revision };
        }
        return undefined;
      } catch {
        return undefined;
      }
    },
    async writeFile(
      path: string,
      content: string,
      writeOptions?: { baseRevision?: string },
    ): Promise<unknown> {
      const input: WriteFileInput = {
        workspaceId,
        path,
        content,
        contentType: JSON_CONTENT_TYPE,
      };
      if (writeOptions?.baseRevision !== undefined) {
        input.baseRevision = writeOptions.baseRevision;
      }
      return client.writeFile(input);
    },
  };
}

function mergeLinearIndexRowsList(existingRows: LinearIndexRow[], requiredRows: LinearIndexRow[]): LinearIndexRow[] {
  const rows = new Map<string, LinearIndexRow>();

  for (const row of existingRows) {
    rows.set(row.file, row);
  }

  for (const row of requiredRows) {
    rows.set(row.file, row);
  }

  return [...rows.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function parseLinearIndexRows(existingContent: string | undefined): LinearIndexRow[] {
  if (!existingContent) {
    return [];
  }

  try {
    const parsed = JSON.parse(existingContent) as { rows?: Array<Partial<LinearIndexRow>> };
    return Array.isArray(parsed.rows)
      ? parsed.rows.filter((row): row is LinearIndexRow => typeof row?.file === 'string' && typeof row?.title === 'string')
      : [];
  } catch {
    return [];
  }
}

async function writeLinearFile(
  client: RelayFileClientLike,
  workspaceId: string,
  path: string,
  content: string,
  semantics?: FileSemantics,
): Promise<void> {
  await client.writeFile({
    workspaceId,
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
    ...(semantics ? { semantics } : {}),
  });
}

async function readLinearFile(
  client: RelayFileClientLike,
  path: string,
  workspaceId?: string,
): Promise<string | undefined> {
  const value = await readLinearFileWithFallbacks(client, path, workspaceId);
  return typeof value === 'string'
    ? value
    : value && typeof value === 'object' && 'content' in value && typeof value.content === 'string'
      ? value.content
      : undefined;
}

async function readLinearFileWithFallbacks(
  client: RelayFileClientLike,
  path: string,
  workspaceId?: string,
): Promise<ReadFileResult | string | undefined> {
  const reader = (client as unknown as Record<string, unknown>).readFile;
  if (typeof reader !== 'function') {
    return undefined;
  }

  const attempts: Array<() => Promise<ReadFileResult | string | undefined>> = [];
  if (workspaceId !== undefined) {
    attempts.push(
      () => reader.call(client, { workspaceId, path }),
      () => reader.call(client, workspaceId, path),
    );
  }
  attempts.push(() => reader.call(client, path));

  for (const attempt of attempts) {
    try {
      const value = await attempt();
      if (isReadableFileResult(value)) {
        return value;
      }
    } catch {
      // Try the next supported readFile call shape.
    }
  }
  return undefined;
}

function isReadableFileResult(value: unknown): value is ReadFileResult | string {
  return typeof value === 'string'
    || Boolean(value && typeof value === 'object' && 'content' in value && typeof value.content === 'string');
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

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
    .sort((left, right) => left.localeCompare(right));
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
