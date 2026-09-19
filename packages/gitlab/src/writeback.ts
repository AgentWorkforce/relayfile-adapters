import { withProxyRetry } from '@relayfile/adapter-core/http';
import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import type {
  ConnectionProvider,
  ProxyRequest,
  ProxyResponse,
  WritebackPathTarget,
  WritebackResult,
} from './types.js';
import { decodeProjectPath, parseGitLabPath } from './path-mapper.js';
import { resources } from './resources.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

type GitLabWritebackAction = 'delete_issue_note' | 'delete_merge_request_discussion';
type GitLabStateEvent = 'close' | 'reopen';
type WritebackPayload = Record<string, unknown>;

export interface GitLabWritebackRequest {
  method: ProxyRequest['method'];
  endpoint: string;
  body?: WritebackPayload;
  action?: GitLabWritebackAction;
}

export interface GitLabWritebackHandlerOptions {
  baseUrl?: string;
  connectionId?: string;
}

interface CanonicalTarget {
  iid: string;
  projectPath: string;
}

interface GitLabWritebackResponse {
  id?: number | string;
  iid?: number | string;
}

interface IssueWritebackPayload extends WritebackPayload {
  assignee_ids?: number[];
  confidential?: boolean;
  description?: string;
  labels?: string;
  milestone_id?: number;
  state_event?: GitLabStateEvent;
  title?: string;
}

interface MergeRequestWritebackPayload extends WritebackPayload {
  description?: string;
  draft?: boolean;
  labels?: string;
  remove_source_branch?: boolean;
  source_branch?: string;
  state_event?: GitLabStateEvent;
  target_branch?: string;
  title?: string;
}

interface RefWritebackPayload extends WritebackPayload {
  branch: string;
  ref: string;
}

interface MergeWritebackPayload extends WritebackPayload {
  merge_commit_message?: string;
  should_remove_source_branch?: boolean;
  squash?: boolean;
}

interface StateWritebackPayload extends WritebackPayload {
  state_event: GitLabStateEvent;
}

const READ_ONLY_FIELDS = new Set<string>([
  'id',
  'createdAt',
  'updatedAt',
  'url',
  'identifier',
  'provider',
  'objectType',
  'objectId',
  'workspaceId',
  'connectionId',
  '_webhook',
  '_connection',
]);
const ISSUE_FIELDS = [
  'title',
  'description',
  'labels',
  'assignee_ids',
  'milestone_id',
  'confidential',
  'state_event',
] as const;
const MR_FIELDS = [
  'source_branch',
  'target_branch',
  'title',
  'description',
  'labels',
  'remove_source_branch',
  'draft',
  'state_event',
] as const;

export class GitLabWritebackHandler {
  constructor(
    private readonly provider: ConnectionProvider,
    private readonly options: GitLabWritebackHandlerOptions = {},
  ) {}

  extractWritebackTarget(path: string): WritebackPathTarget {
    const parsed = parseGitLabPath(path);
    if (!parsed) {
      throw unsupported(path);
    }

    const route = classifyWrite(path, resources);
    const meta =
      parsed.subResource === 'meta.json' ||
      parsed.subResource === 'metadata.json' ||
      parsed.subResource === undefined;

    if (meta && parsed.objectType === 'issues') {
      return {
        entity: 'issue',
        projectPath: parsed.projectPath,
        resourceId: parsed.objectId,
      };
    }
    if (meta && parsed.objectType === 'merge_requests') {
      return {
        entity: 'merge_request',
        projectPath: parsed.projectPath,
        resourceId: parsed.objectId,
      };
    }
    if (route?.resource.name === 'comments' && route.kind === 'create') {
      return {
        entity: 'issue_note',
        projectPath: parsed.projectPath,
        resourceId: parsed.objectId,
      };
    }
    if (route?.resource.name === 'discussions' && route.kind === 'create') {
      return {
        entity: 'merge_request_discussion',
        projectPath: parsed.projectPath,
        resourceId: parsed.objectId,
      };
    }

    throw unsupported(path);
  }

  resolveDeleteRequest(path: string): GitLabWritebackRequest {
    return resolveDeleteRequest(path);
  }

  async writeBack(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<WritebackResult> {
    try {
      const request = resolveGitLabWritebackRequest(path, content);
      const proxyRequest: ProxyRequest = {
        ...request,
        baseUrl: this.options.baseUrl ?? 'https://gitlab.com',
        connectionId: this.options.connectionId ?? workspaceId,
        headers: { 'Content-Type': 'application/json' },
      };
      const response: ProxyResponse<GitLabWritebackResponse | null> = await withProxyRetry(
        this.provider,
      ).proxy<GitLabWritebackResponse | null>(proxyRequest);

      if (response.status >= 400) {
        return {
          success: false,
          error: `${request.method} ${request.endpoint} failed with ${response.status}`,
        };
      }

      const result = response.data;
      return {
        success: true,
        externalId: result?.id ? String(result.id) : result?.iid ? String(result.iid) : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function resolveGitLabWritebackRequest(
  path: string,
  content: string,
): GitLabWritebackRequest {
  const route = classifyWrite(path, resources);
  if (!route) {
    throw unsupported(path);
  }

  if (route.resource.name === 'issues') {
    if (route.kind === 'create') {
      return {
        method: 'POST',
        endpoint: issueEndpoint(collectionProject(path, 'issues')),
        body: issuePayload(content, true),
      };
    }
    if (route.kind === 'patch') {
      const target = canonicalTarget(path, 'issues');
      return {
        method: 'PUT',
        endpoint: `${issueEndpoint(target.projectPath)}/${target.iid}`,
        body: issuePayload(content, false),
      };
    }
  }

  if (route.resource.name === 'merge-requests') {
    if (route.kind === 'create') {
      return {
        method: 'POST',
        endpoint: mrEndpoint(collectionProject(path, 'merge-requests')),
        body: mrPayload(content, true),
      };
    }
    if (route.kind === 'patch') {
      const target = canonicalTarget(path, 'merge_requests');
      return {
        method: 'PUT',
        endpoint: `${mrEndpoint(target.projectPath)}/${target.iid}`,
        body: mrPayload(content, false),
      };
    }
  }

  if (route.resource.name === 'refs' && route.kind === 'create') {
    return {
      method: 'POST',
      endpoint: `/api/v4/projects/${projectId(collectionProject(path, 'refs'))}/repository/branches`,
      body: refPayload(content),
    };
  }

  if (route.resource.name === 'merge' && route.kind === 'patch') {
    const target = canonicalTarget(path, 'merge_requests');
    return {
      method: 'PUT',
      endpoint: `${mrEndpoint(target.projectPath)}/${target.iid}/merge`,
      body: mergePayload(content),
    };
  }

  if (route.resource.name === 'close-merge-request' && route.kind === 'patch') {
    const target = canonicalTarget(path, 'merge_requests');
    return {
      method: 'PUT',
      endpoint: `${mrEndpoint(target.projectPath)}/${target.iid}`,
      body: statePayload(content),
    };
  }

  if (route.resource.name === 'discussions' && route.kind === 'create') {
    const target = canonicalTarget(path, 'merge_requests');
    const body = payload(content);
    required(body, 'body', 'GitLab merge request discussion create writeback');
    return {
      method: 'POST',
      endpoint: `${mrEndpoint(target.projectPath)}/${target.iid}/discussions`,
      body,
    };
  }

  if (route.resource.name === 'comments' && route.kind === 'create') {
    const target = canonicalTarget(path, 'issues');
    const body = payload(content);
    required(body, 'body', 'GitLab issue note create writeback');
    return {
      method: 'POST',
      endpoint: `${issueEndpoint(target.projectPath)}/${target.iid}/notes`,
      body,
    };
  }

  throw unsupported(path);
}

export function resolveDeleteRequest(path: string): GitLabWritebackRequest {
  const nested = path.match(
    /^\/gitlab\/projects\/(.+?)\/merge_requests\/([^/]+)\/discussions\/([^/]+)\/notes\/([^/]+)\.json$/,
  );
  if (nested) {
    return {
      action: 'delete_merge_request_discussion',
      method: 'DELETE',
      endpoint: `${mrEndpoint(decodeProjectPath(nested[1]))}/${iid(nested[2])}/discussions/${encodeURIComponent(nested[3])}/notes/${encodeURIComponent(nested[4])}`,
    };
  }

  const parsed = parseGitLabPath(path);
  const route = classifyWrite(path, resources, { fsEvent: 'delete' });
  if (
    parsed &&
    route?.resource.name === 'comments' &&
    route.kind === 'delete' &&
    parsed.objectType === 'issues' &&
    parsed.subResourceId
  ) {
    return {
      action: 'delete_issue_note',
      method: 'DELETE',
      endpoint: `${issueEndpoint(parsed.projectPath)}/${parsed.objectId}/notes/${encodeURIComponent(parsed.subResourceId)}`,
    };
  }

  throw new Error(`Unsupported GitLab delete writeback path: ${path}`);
}

function issuePayload(content: string, creating: boolean): IssueWritebackPayload {
  const context = `GitLab issue ${creating ? 'create' : 'update'} payload`;
  const source = typed(content, context, ISSUE_FIELDS);
  const body: IssueWritebackPayload = {};

  addString(body, source, 'title', creating);
  addString(body, source, 'description');
  labels(body, source);
  addIntArray(body, source, 'assignee_ids');
  addInt(body, source, 'milestone_id');
  addBool(body, source, 'confidential');
  if (!creating) {
    addState(body, source);
  }
  mutable(body, context);
  return body;
}

function mrPayload(content: string, creating: boolean): MergeRequestWritebackPayload {
  const context = `GitLab merge request ${creating ? 'create' : 'update'} payload`;
  const source = typed(content, context, MR_FIELDS);
  const body: MergeRequestWritebackPayload = {};

  for (const field of ['source_branch', 'target_branch', 'title'] as const) {
    addString(body, source, field, creating);
  }
  addString(body, source, 'description');
  labels(body, source);
  addBool(body, source, 'remove_source_branch');
  addBool(body, source, 'draft');
  if (!creating) {
    addState(body, source);
  }
  mutable(body, context);
  return body;
}

function refPayload(content: string): RefWritebackPayload {
  const context = 'GitLab branch create payload';
  const source = typed(content, context, ['branch', 'ref']);
  return {
    branch: required(source, 'branch', context),
    ref: required(source, 'ref', context),
  };
}

function mergePayload(content: string): MergeWritebackPayload {
  const context = 'GitLab merge request merge payload';
  const source = typed(content, context, [
    'merge_commit_message',
    'squash',
    'should_remove_source_branch',
  ]);
  const body: MergeWritebackPayload = {};

  addString(body, source, 'merge_commit_message');
  addBool(body, source, 'squash');
  addBool(body, source, 'should_remove_source_branch');
  return body;
}

function statePayload(content: string): StateWritebackPayload {
  const context = 'GitLab merge request close payload';
  const source = typed(content, context, ['state_event']);
  const stateEvent = required(source, 'state_event', context);
  if (stateEvent !== 'close' && stateEvent !== 'reopen') {
    throw new Error(`${context}.state_event must be one of close, reopen`);
  }
  return { state_event: stateEvent };
}

function payload(content: string): WritebackPayload {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid GitLab writeback JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GitLab writeback payload must be a JSON object');
  }

  const record = value as WritebackPayload;
  for (const key of Object.keys(record)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
  }
  return record;
}

function typed(
  content: string,
  context: string,
  fields: readonly string[],
): WritebackPayload {
  const value = payload(content);
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) {
      throw new Error(`${context}.${key} is not supported`);
    }
  }
  return value;
}

function required(value: WritebackPayload, key: string, context: string): string {
  const field = string(value, key, context);
  if (!field) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return field;
}

function string(value: WritebackPayload, key: string, context: string): string | undefined {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== 'string' || !field.trim()) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return field.trim();
}

function addString(
  body: WritebackPayload,
  value: WritebackPayload,
  key: string,
  requiredValue = false,
): void {
  const field = string(
    value,
    key,
    `GitLab ${key === 'title' ? 'issue create payload' : 'writeback payload'}`,
  );
  if (requiredValue && !field) {
    throw new Error(
      `GitLab ${key === 'title' ? 'issue create payload' : 'merge request create payload'}.${key} must be a non-empty string`,
    );
  }
  if (field !== undefined) {
    body[key] = field;
  }
}

function labels(body: WritebackPayload, value: WritebackPayload): void {
  if (value.labels === undefined) {
    return;
  }
  if (typeof value.labels === 'string' && value.labels.trim()) {
    body.labels = value.labels.trim();
    return;
  }
  if (
    !Array.isArray(value.labels) ||
    value.labels.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    throw new Error(
      'GitLab writeback payload.labels must be a non-empty string or an array of non-empty strings',
    );
  }
  body.labels = value.labels.map((item) => item.trim()).join(',');
}

function addBool(body: WritebackPayload, value: WritebackPayload, key: string): void {
  if (value[key] === undefined) {
    return;
  }
  if (typeof value[key] !== 'boolean') {
    throw new Error(`GitLab writeback payload.${key} must be a boolean`);
  }
  body[key] = value[key];
}

function addInt(body: WritebackPayload, value: WritebackPayload, key: string): void {
  const field = value[key];
  if (field === undefined) {
    return;
  }
  if (typeof field !== 'number' || !Number.isInteger(field) || field < 1) {
    throw new Error(`GitLab writeback payload.${key} must be a positive integer`);
  }
  body[key] = field;
}

function addIntArray(body: WritebackPayload, value: WritebackPayload, key: string): void {
  const field = value[key];
  if (field === undefined) {
    return;
  }
  if (
    !Array.isArray(field) ||
    field.some(
      (item: unknown) =>
        typeof item !== 'number' || !Number.isInteger(item) || item < 1,
    )
  ) {
    throw new Error(`GitLab writeback payload.${key} must be an array of positive integers`);
  }
  body[key] = field;
}

function addState(body: WritebackPayload, value: WritebackPayload): void {
  const field = value.state_event;
  if (field === undefined) {
    return;
  }
  if (field !== 'close' && field !== 'reopen') {
    throw new Error('GitLab writeback payload.state_event must be one of close, reopen');
  }
  body.state_event = field;
}

function mutable(body: WritebackPayload, context: string): void {
  if (!Object.keys(body).length) {
    throw new Error(`${context} requires at least one mutable field`);
  }
}

function collectionProject(path: string, collection: string): string {
  const match = path.match(new RegExp(`^/gitlab/projects/(.+?)/${collection}/[^/]+\\.json$`));
  if (!match?.[1]) {
    throw unsupported(path);
  }
  return decodeProjectPath(match[1]);
}

function canonicalTarget(path: string, expected: 'issues' | 'merge_requests'): CanonicalTarget {
  const parsed = parseGitLabPath(path);
  if (
    !parsed ||
    parsed.objectType !== expected ||
    !/^[1-9]\d*$/.test(parsed.objectId)
  ) {
    throw unsupported(path);
  }
  return { projectPath: parsed.projectPath, iid: parsed.objectId };
}

function iid(segment: string): string {
  return decodeURIComponent(segment).split('__')[0];
}

function projectId(projectPath: string): string {
  return encodeURIComponent(projectPath);
}

function issueEndpoint(projectPath: string): string {
  return `/api/v4/projects/${projectId(projectPath)}/issues`;
}

function mrEndpoint(projectPath: string): string {
  return `/api/v4/projects/${projectId(projectPath)}/merge_requests`;
}

function unsupported(path: string): Error {
  return new Error(
    `Unsupported GitLab writeback path: ${path}. Expected an issue, merge request create/update, branch ref, merge request merge/close, discussion, or issue note.`,
  );
}
