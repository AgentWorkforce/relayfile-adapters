import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeJiraPath,
  jiraCommentPath,
  jiraIssuePath,
  jiraProjectPath,
  jiraSprintPath,
  normalizeJiraObjectType,
} from './path-mapper.js';
import { JIRA_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  JiraAdapterConfig,
  JiraComment,
  JiraIssue,
  JiraIssueFields,
  JiraIssueReference,
  JiraProject,
  JiraSprint,
  JiraStatus,
  JiraUser,
  JiraWebhookPayload,
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | JiraWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  supportedEvents?(): string[];
}

type JiraRecord = Record<string, unknown>;
type JiraWebhookEnvelope = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SUPPORTED_EVENTS = JIRA_WEBHOOK_OBJECT_TYPES;
const JIRA_PROVIDER_NAME = 'jira';
const JIRA_DUPLICATE_WEBHOOK_KEYS = new Set(['changelog', 'issue', 'user']);

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function looksLikeJiraUserRecord(value: Record<string, unknown>): boolean {
  return (
    hasOwn(value, 'accountId') ||
    hasOwn(value, 'account_id') ||
    hasOwn(value, 'emailAddress') ||
    hasOwn(value, 'email_address') ||
    (hasOwn(value, 'displayName') &&
      (hasOwn(value, 'avatarUrls') || hasOwn(value, 'timeZone') || hasOwn(value, 'self'))) ||
    (hasOwn(value, 'display_name') &&
      (hasOwn(value, 'avatar_urls') || hasOwn(value, 'timezone') || hasOwn(value, 'self')))
  );
}

function redactJiraPersonalDataValue(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactJiraPersonalDataValue(item, parentKey));
  }

  if (!isRecord(value)) {
    return value;
  }

  if (looksLikeJiraUserRecord(value)) {
    return null;
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'changelog') {
      continue;
    }
    if (parentKey === '_webhook' && JIRA_DUPLICATE_WEBHOOK_KEYS.has(key)) {
      continue;
    }
    output[key] = redactJiraPersonalDataValue(child, key);
  }
  return output;
}

export function sanitizeJiraRecordForStorage(payload: Record<string, unknown>): Record<string, unknown> {
  const result = redactJiraPersonalDataValue(payload);
  return isRecord(result) ? result : {};
}

export class JiraAdapter extends IntegrationAdapter {
  override readonly name = JIRA_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: JiraAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: JiraAdapterConfig = {},
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
    event: NormalizedWebhook | JiraWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = computeJiraPath(
        normalized.objectType,
        normalized.objectId,
        readObjectTitle(normalized.objectType, normalized.payload),
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
    return computeJiraPath(objectType, objectId, title);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const safePayload = sanitizeJiraRecordForStorage(payload);
    const normalizedType = normalizeJiraObjectType(objectType);
    const properties: Record<string, string> = {
      provider: JIRA_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'jira.id': objectId,
      'jira.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    addStringProperty(properties, 'jira.self', safePayload.self);

    const webhook = getRecord(safePayload._webhook);
    if (webhook) {
      addStringProperty(properties, 'jira.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'jira.webhook.webhook_event', webhook.webhookEvent);
      addStringProperty(properties, 'jira.webhook.delivery_id', webhook.deliveryId);
      addStringProperty(properties, 'jira.webhook.request_id', webhook.requestId);
    }

    switch (normalizedType) {
      case 'issue':
        applyIssueSemantics(properties, relations, comments, safePayload as JiraRecord);
        break;
      case 'project':
        applyProjectSemantics(properties, relations, safePayload as JiraRecord);
        break;
      case 'sprint':
        applySprintSemantics(properties, safePayload as JiraRecord);
        break;
      case 'comment':
        applyCommentSemantics(properties, relations, comments, safePayload as JiraRecord);
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

  private normalizeEvent(event: NormalizedWebhook | JiraWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || JIRA_PROVIDER_NAME,
        eventType: normalizeEventType(event.eventType, event.objectType),
        objectType: normalizeJiraObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const objectType = inferObjectTypeFromWebhook(event);
    const payload = mergeJiraPayload(event, objectType);
    const objectId = extractPayloadId(payload, objectType);
    if (!objectId) {
      throw new Error(`Jira ${objectType} webhook is missing object id`);
    }

    const normalized: NormalizedWebhook = {
      provider: this.config.provider || JIRA_PROVIDER_NAME,
      eventType: normalizeEventType(readWebhookEvent(event), objectType),
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
    const payload = sanitizeJiraRecordForStorage(event.payload);
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeJiraObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload,
    });
  }
}

function applyIssueSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: JiraRecord,
): void {
  const issue = payload as Partial<JiraIssue> & JiraRecord;
  const fields = getRecord(issue.fields) as Partial<JiraIssueFields> | undefined;

  addStringProperty(properties, 'jira.issue_key', issue.key);
  addStringProperty(properties, 'jira.issue_id', issue.id);
  addStringProperty(properties, 'jira.summary', fields?.summary);
  addStringProperty(properties, 'jira.created_at', fields?.created);
  addStringProperty(properties, 'jira.updated_at', fields?.updated);
  addStringProperty(properties, 'jira.due_date', fields?.duedate);
  addStringProperty(properties, 'jira.resolution_date', fields?.resolutiondate);

  const issueType = getRecord(fields?.issuetype);
  if (issueType) {
    addStringProperty(properties, 'jira.issue_type_id', issueType.id);
    addStringProperty(properties, 'jira.issue_type_name', issueType.name);
    addBooleanProperty(properties, 'jira.issue_type_subtask', issueType.subtask);
  }

  const status = fields?.status;
  if (status) {
    applyStatusProperties(properties, 'jira.status', status);
  }

  const priority = getRecord(fields?.priority);
  if (priority) {
    addStringProperty(properties, 'jira.priority_id', priority.id);
    addStringProperty(properties, 'jira.priority_name', priority.name);
  }

  const resolution = getRecord(fields?.resolution);
  if (resolution) {
    addStringProperty(properties, 'jira.resolution_id', resolution.id);
    addStringProperty(properties, 'jira.resolution_name', resolution.name);
  }

  const assignee = fields?.assignee;
  if (assignee) {
    applyUserProperties(properties, relations, 'jira.assignee', assignee);
  }

  const reporter = fields?.reporter;
  if (reporter) {
    applyUserProperties(properties, relations, 'jira.reporter', reporter);
  }

  const creator = fields?.creator;
  if (creator) {
    applyUserProperties(properties, relations, 'jira.creator', creator);
  }

  const project = fields?.project;
  if (project?.id) {
    relations.add(jiraProjectPath(project.key ?? project.id, project.name));
    addStringProperty(properties, 'jira.project_id', project.id);
    addStringProperty(properties, 'jira.project_key', project.key);
    addStringProperty(properties, 'jira.project_name', project.name);
    addStringProperty(properties, 'jira.project_type', project.projectTypeKey ?? project.project_type_key);
  }

  const parent = getRecord(fields?.parent) as Partial<JiraIssueReference> | undefined;
  if (parent) {
    const parentId = parent.key ?? parent.id;
    if (parentId) {
      relations.add(jiraIssuePath(parentId, parent.fields?.summary));
      addStringProperty(properties, 'jira.parent_id', parent.id);
      addStringProperty(properties, 'jira.parent_key', parent.key);
      addStringProperty(properties, 'jira.parent_summary', parent.fields?.summary);
    }
  }

  const sprint = getRecord(fields?.sprint) as Partial<JiraSprint> | undefined;
  if (sprint?.id !== undefined) {
    const sprintId = String(sprint.id);
    relations.add(jiraSprintPath(sprintId, sprint.name));
    addStringProperty(properties, 'jira.sprint_id', sprintId);
    addStringProperty(properties, 'jira.sprint_name', sprint.name);
    addStringProperty(properties, 'jira.sprint_state', sprint.state);
  }

  const labels = asStringArray(fields?.labels);
  if (labels.length > 0) {
    properties['jira.labels'] = labels.join(', ');
    properties['jira.label_count'] = String(labels.length);
  }

  const components = asNamedReferences(fields?.components);
  if (components.length > 0) {
    properties['jira.components'] = components.join(', ');
    properties['jira.component_count'] = String(components.length);
  }

  const fixVersions = asNamedReferences(fields?.fixVersions);
  if (fixVersions.length > 0) {
    properties['jira.fix_versions'] = fixVersions.join(', ');
  }

  const affectsVersions = asNamedReferences(fields?.versions);
  if (affectsVersions.length > 0) {
    properties['jira.versions'] = affectsVersions.join(', ');
  }

  const description = textFromDoc(fields?.description);
  if (description) {
    properties['jira.description_length'] = String(description.length);
    comments.push(description);
  }

  const embeddedComments = fields?.comment?.comments ?? [];
  // Prefer the parent issue key (e.g. "ENG-42") for the nested comment path
  // so read/write resolvers can recover it; fall back to the numeric id.
  const parentIssueRef = issue.key ?? issue.id;
  for (const comment of embeddedComments) {
    if (comment.id) {
      relations.add(jiraCommentPath(comment.id, parentIssueRef));
    }
  }
  if (embeddedComments.length > 0) {
    properties['jira.comment_count'] = String(embeddedComments.length);
  }
}

function applyProjectSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: JiraRecord,
): void {
  const project = payload as Partial<JiraProject> & JiraRecord;

  addStringProperty(properties, 'jira.project_id', project.id);
  addStringProperty(properties, 'jira.project_key', project.key);
  addStringProperty(properties, 'jira.name', project.name);
  addStringProperty(properties, 'jira.description', project.description);
  addStringProperty(properties, 'jira.project_type', project.projectTypeKey ?? project.project_type_key);
  addStringProperty(properties, 'jira.assignee_type', project.assigneeType ?? project.assignee_type);
  addBooleanProperty(properties, 'jira.archived', project.archived);
  addBooleanProperty(properties, 'jira.simplified', project.simplified);
  addStringProperty(properties, 'jira.style', project.style);
  addStringProperty(properties, 'jira.url', project.url);

  if (project.category) {
    addStringProperty(properties, 'jira.category_id', project.category.id);
    addStringProperty(properties, 'jira.category_name', project.category.name);
  }

  if (project.lead) {
    applyUserProperties(properties, relations, 'jira.lead', project.lead);
  }
}

function applySprintSemantics(properties: Record<string, string>, payload: JiraRecord): void {
  const sprint = payload as Partial<JiraSprint> & JiraRecord;

  addStringProperty(properties, 'jira.sprint_id', sprint.id);
  addStringProperty(properties, 'jira.name', sprint.name);
  addStringProperty(properties, 'jira.state', sprint.state);
  addStringProperty(properties, 'jira.start_date', sprint.startDate);
  addStringProperty(properties, 'jira.end_date', sprint.endDate);
  addStringProperty(properties, 'jira.complete_date', sprint.completeDate);
  addStringProperty(properties, 'jira.origin_board_id', sprint.originBoardId);
  addStringProperty(properties, 'jira.goal', sprint.goal);
}

function applyCommentSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: JiraRecord,
): void {
  const comment = payload as Partial<JiraComment> & JiraRecord;

  addStringProperty(properties, 'jira.comment_id', comment.id);
  addStringProperty(properties, 'jira.created_at', comment.created);
  addStringProperty(properties, 'jira.updated_at', comment.updated);
  addBooleanProperty(properties, 'jira.jsd_public', comment.jsdPublic);

  if (comment.author) {
    applyUserProperties(properties, relations, 'jira.author', comment.author);
  }

  if (comment.updateAuthor) {
    applyUserProperties(properties, relations, 'jira.update_author', comment.updateAuthor);
  }

  const issueId = asString(payload.issueId) ?? asString(payload.issue_id);
  const issueKey = asString(payload.issueKey) ?? asString(payload.issue_key);
  const issue = getRecord(payload.issue) as (Partial<JiraIssue> & Partial<JiraIssueReference>) | undefined;
  const linkedIssueId = issueKey ?? issue?.key ?? issueId ?? issue?.id;
  if (linkedIssueId) {
    relations.add(jiraIssuePath(linkedIssueId, issue?.fields?.summary));
    addStringProperty(properties, 'jira.issue_id', issue?.id ?? issueId);
    addStringProperty(properties, 'jira.issue_key', issue?.key ?? issueKey);
  }

  const body = textFromDoc(comment.body);
  if (body) {
    comments.push(body);
    properties['jira.comment_length'] = String(body.length);
  }
}

function applyStatusProperties(
  properties: Record<string, string>,
  prefix: string,
  status: JiraStatus,
): void {
  addStringProperty(properties, `${prefix}_id`, status.id);
  addStringProperty(properties, `${prefix}_name`, status.name);
  if (status.statusCategory) {
    addStringProperty(properties, `${prefix}_category_id`, status.statusCategory.id);
    addStringProperty(properties, `${prefix}_category_key`, status.statusCategory.key);
    addStringProperty(properties, `${prefix}_category_name`, status.statusCategory.name);
  }
}

function applyUserProperties(
  properties: Record<string, string>,
  relations: Set<string>,
  prefix: string,
  user: JiraUser,
): void {
  // Atlassian account profile fields are deliberately excluded from storage and
  // semantics so Relayfile does not retain reportable Jira personal data.
  void properties;
  void relations;
  void prefix;
  void user;
}

function mergeJiraPayload(event: JiraWebhookPayload, objectType: string): Record<string, unknown> {
  const eventRecord = event as JiraRecord;
  const data = getRecord(eventRecord[objectType]) ?? {};
  const issue = objectType === 'comment' ? eventRecord.issue : undefined;
  return {
    ...data,
    issue,
    _webhook: compactObject<JiraWebhookEnvelope>({
      action: normalizeJiraAction(readWebhookEvent(event)),
      changelog: eventRecord.changelog,
      issue: eventRecord.issue,
      issueEventTypeName: asString(eventRecord.issue_event_type_name),
      timestamp: eventRecord.timestamp,
      type: objectType,
      user: eventRecord.user,
      webhookEvent: readWebhookEvent(event),
    }),
  };
}

function inferObjectTypeFromWebhook(event: JiraWebhookPayload): 'comment' | 'issue' | 'project' | 'sprint' {
  const record = event as JiraRecord;
  if (isRecord(record.comment)) return 'comment';
  if (isRecord(record.sprint)) return 'sprint';
  if (isRecord(record.project)) return 'project';
  if (isRecord(record.issue)) return 'issue';
  const webhookEvent = readWebhookEvent(event).toLowerCase();
  if (webhookEvent.includes('comment')) return 'comment';
  if (webhookEvent.includes('sprint')) return 'sprint';
  if (webhookEvent.includes('project')) return 'project';
  if (webhookEvent.includes('issue')) return 'issue';
  throw new Error('Unsupported Jira webhook payload');
}

function readWebhookEvent(event: JiraWebhookPayload): string {
  const record = event as JiraRecord;
  return asString(record.webhookEvent) ?? asString(record.webhook_event) ?? asString(record.issue_event_type_name) ?? 'updated';
}

function readObjectTitle(objectType: string, payload: Record<string, unknown>): string | undefined {
  const normalizedType = normalizeJiraObjectType(objectType);
  switch (normalizedType) {
    case 'issue':
      return asString(getRecord(payload.fields)?.summary) ?? asString(payload.key);
    case 'project':
      return asString(payload.name) ?? asString(payload.key);
    case 'sprint':
      return asString(payload.name);
    case 'comment': {
      // For comments, computeJiraPath repurposes the title slot as the
      // parent issueIdOrKey so the nested path /jira/issues/{key}/comments/
      // {commentId}.json can round-trip through the API. Prefer the parent
      // issue key, fall back to its numeric id.
      const issue = getRecord(payload.issue);
      return asString(issue?.key) ?? asString(issue?.id);
    }
  }
}

function extractPayloadId(payload: Record<string, unknown>, objectType: string): string | undefined {
  if (objectType === 'issue') {
    return asString(payload.id) ?? asString(payload.key);
  }
  return asString(payload.id);
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

function normalizeEventType(eventType: string, objectType: string): string {
  const normalizedObjectType = normalizeJiraObjectType(objectType);
  if (eventType.includes('.')) {
    const action = normalizeJiraAction(eventType.slice(eventType.lastIndexOf('.') + 1));
    return `${normalizedObjectType}.${action}`;
  }
  if (eventType.includes(':')) {
    const action = normalizeJiraAction(eventType.slice(eventType.lastIndexOf(':') + 1));
    return `${normalizedObjectType}.${action}`;
  }
  return `${normalizedObjectType}.${normalizeJiraAction(eventType)}`;
}

function normalizeJiraAction(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('delete') || normalized === 'deleted') return 'deleted';
  if (normalized.includes('create') || normalized === 'created') return 'created';
  return 'updated';
}

function inferFallbackPath(event: NormalizedWebhook | JiraWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeJiraPath(event.objectType, event.objectId);
    }

    const objectType = inferObjectTypeFromWebhook(event);
    const payload = mergeJiraPayload(event, objectType);
    const objectId = extractPayloadId(payload, objectType);
    if (!objectId) {
      return '';
    }
    return computeJiraPath(objectType, objectId, readObjectTitle(objectType, payload));
  } catch {
    return '';
  }
}

function isNormalizedWebhook(event: NormalizedWebhook | JiraWebhookPayload): event is NormalizedWebhook {
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
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== undefined)
    .sort((left, right) => left.localeCompare(right));
}

function asNamedReferences(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => getRecord(entry))
    .map((entry) => asString(entry?.name) ?? asString(entry?.id))
    .filter((entry): entry is string => entry !== undefined)
    .sort((left, right) => left.localeCompare(right));
}

function textFromDoc(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (!value) return undefined;

  const chunks: string[] = [];
  collectText(value, chunks);
  const text = chunks.join(' ').replace(/\s+/gu, ' ').trim();
  return text.length > 0 ? text : undefined;
}

function collectText(value: unknown, chunks: string[]): void {
  if (typeof value === 'string') {
    chunks.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectText(entry, chunks);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const text = asString(value.text);
  if (text) {
    chunks.push(text);
  }

  const content = value.content;
  if (Array.isArray(content)) {
    for (const entry of content) {
      collectText(entry, chunks);
    }
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
