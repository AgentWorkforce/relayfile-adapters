import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import { extractJiraIdFromPathSegment } from './path-mapper.js';
import { resources } from './resources.js';
import type { JiraWritebackRequest } from './types.js';
import { isAdfDoc, markdownToAdf } from './adf.js';

// Jira Cloud REST v3 comment bodies must be ADF. Author content is Markdown, so
// string bodies are converted; an already-structured ADF doc passes through.
function toCommentBody(raw: unknown): unknown {
  if (typeof raw === 'string') return markdownToAdf(raw);
  if (isAdfDoc(raw)) return raw;
  return raw;
}

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

export const JIRA_REST_ISSUE_ROUTE = '/rest/api/3/issue';
export const JIRA_REST_PROJECT_ROUTE = '/rest/api/3/project';
export const JIRA_REST_AGILE_SPRINT_ROUTE = '/rest/agile/1.0/sprint';

export function resolveJiraWritebackRequest(path: string, content: string): JiraWritebackRequest {
  const normalized = normalizePath(path);
  const route = classifyWrite(normalized, resources);

  if (route?.resource.name === 'comments') {
    const segments = normalized.match(/^\/jira\/issues\/([^/]+)\/comments\/([^/]+)\.json$/u);
    if (segments?.[1] && route.kind === 'create') {
      return buildCommentCreate(extractJiraIdFromPathSegment(segments[1]), content);
    }
    if (segments?.[1] && segments[2] && route.kind === 'patch') {
      return buildCommentUpdate(
        extractJiraIdFromPathSegment(segments[1]),
        extractJiraIdFromPathSegment(segments[2]),
        content,
      );
    }
  }

  if (route?.resource.name === 'transitions') {
    const segments = normalized.match(/^\/jira\/issues\/([^/]+)\/transitions\/([^/]+)\.json$/u);
    if (segments?.[1] && route.kind === 'create') {
      return buildIssueTransition(extractJiraIdFromPathSegment(segments[1]), content);
    }
  }

  // Reject the flat form for updates: Jira's PUT /comment requires the
  // parent issue ID in the path, so the flat form cannot resolve.
  if (/^\/jira\/comments\/[^/]+\.json$/u.test(normalized)) {
    throw new Error(
      `Comment update writeback requires the parent issue context. Use /jira/issues/{issueIdOrKey}/comments/{commentId}.json instead of ${path}`,
    );
  }

  if (route?.resource.name === 'issues') {
    if (route.kind === 'create') {
      return buildIssueCreate(content);
    }
    const issueUpdateMatch = normalized.match(/^\/jira\/issues\/([^/]+)\.json$/u);
    if (route.kind === 'patch' && issueUpdateMatch?.[1]) {
      return buildIssueUpdate(extractJiraIdFromPathSegment(issueUpdateMatch[1]), content);
    }
  }

  if (route?.resource.name === 'projects') {
    if (route.kind === 'create') {
      return buildProjectCreate(content);
    }
    const projectUpdateMatch = normalized.match(/^\/jira\/projects\/([^/]+)\.json$/u);
    if (route.kind === 'patch' && projectUpdateMatch?.[1]) {
      return buildProjectUpdate(extractJiraIdFromPathSegment(projectUpdateMatch[1]), content);
    }
  }

  // Sprints are not yet declared as a resource; fall back to ad-hoc routing.
  const sprintUpdateMatch = normalized.match(/^\/jira\/sprints\/([^/]+)\.json$/u);
  if (sprintUpdateMatch?.[1]) {
    return buildSprintUpdate(extractJiraIdFromPathSegment(sprintUpdateMatch[1]), content);
  }

  throw new Error(`No Jira writeback rule matched ${path}`);
}

export function resolveJiraDeleteRequest(path: string): JiraWritebackRequest {
  const normalized = normalizePath(path);
  const route = classifyWrite(normalized, resources, { fsEvent: 'delete' });
  if (!route) {
    throw new Error(`No Jira delete writeback rule matched ${path}`);
  }

  if (route.resource.name === 'comments') {
    const commentMatch = normalized.match(/^\/jira\/issues\/([^/]+)\/comments\/([^/]+)\.json$/u);
    if (commentMatch?.[1] && commentMatch[2]) {
      return {
        action: 'delete_comment',
        method: 'DELETE',
        endpoint: `${JIRA_REST_ISSUE_ROUTE}/${extractJiraIdFromPathSegment(commentMatch[1])}/comment/${extractJiraIdFromPathSegment(commentMatch[2])}`,
      };
    }
  }

  if (route.resource.name === 'issues') {
    const issueMatch = normalized.match(/^\/jira\/issues\/([^/]+)\.json$/u);
    if (issueMatch?.[1]) {
      return {
        action: 'delete_issue',
        method: 'DELETE',
        endpoint: `${JIRA_REST_ISSUE_ROUTE}/${extractJiraIdFromPathSegment(issueMatch[1])}`,
      };
    }
  }

  if (route.resource.name === 'projects') {
    const projectMatch = normalized.match(/^\/jira\/projects\/([^/]+)\.json$/u);
    if (projectMatch?.[1]) {
      return {
        action: 'delete_project',
        method: 'DELETE',
        endpoint: `${JIRA_REST_PROJECT_ROUTE}/${extractJiraIdFromPathSegment(projectMatch[1])}`,
      };
    }
  }

  throw new Error(`No Jira delete writeback rule matched ${path}`);
}

function buildCommentCreate(issueIdOrKey: string, content: string): JiraWritebackRequest {
  const parsed = safeParseJson(content);
  const body = typeof parsed === 'string' ? parsed : readUnknown(parsed, 'body');
  if (!body) {
    throw new Error('comment create writeback requires a non-empty body');
  }
  return {
    action: 'create_comment',
    method: 'POST',
    endpoint: `${JIRA_REST_ISSUE_ROUTE}/${issueIdOrKey}/comment`,
    body: { body: toCommentBody(body) },
  };
}

function buildCommentUpdate(
  issueIdOrKey: string,
  commentId: string,
  content: string,
): JiraWritebackRequest {
  const parsed = parseJsonObject(content);
  const body = readUnknown(parsed, 'body');
  if (!body) {
    throw new Error('comment update writeback requires a non-empty body');
  }
  return {
    action: 'update_comment',
    method: 'PUT',
    endpoint: `${JIRA_REST_ISSUE_ROUTE}/${issueIdOrKey}/comment/${commentId}`,
    body: { body: toCommentBody(body) },
  };
}

function buildIssueCreate(content: string): JiraWritebackRequest {
  const payload = parseJsonObject(content);
  rejectReadOnlyFields(payload);
  const fields = normalizeIssueFields(payload);
  if (!isRecord(fields.project)) {
    throw new Error('issue create writeback requires fields.project');
  }
  if (!readString(fields, 'summary')) {
    throw new Error('issue create writeback requires fields.summary');
  }
  if (!isRecord(fields.issuetype)) {
    throw new Error('issue create writeback requires fields.issuetype');
  }
  return {
    action: 'create_issue',
    method: 'POST',
    endpoint: JIRA_REST_ISSUE_ROUTE,
    body: { fields },
  };
}

function buildIssueUpdate(issueIdOrKey: string, content: string): JiraWritebackRequest {
  const payload = parseJsonObject(content);
  const source = looksLikeSyncedEnvelope(payload) && isRecord(payload.payload)
    ? payload.payload
    : payload;
  rejectReadOnlyFields(source);
  const fields = normalizeIssueFields(source);
  if (Object.keys(fields).length === 0) {
    throw new Error('issue update writeback requires at least one mutable field');
  }
  return {
    action: 'update_issue',
    method: 'PUT',
    endpoint: `${JIRA_REST_ISSUE_ROUTE}/${issueIdOrKey}`,
    body: { fields },
  };
}

function buildIssueTransition(issueIdOrKey: string, content: string): JiraWritebackRequest {
  const parsed = safeParseJson(content);
  const transition = normalizeTransition(parsed);
  return {
    action: 'transition_issue',
    method: 'POST',
    endpoint: `${JIRA_REST_ISSUE_ROUTE}/${issueIdOrKey}/transitions`,
    body: { transition },
  };
}

function buildProjectCreate(content: string): JiraWritebackRequest {
  const body = parseJsonObject(content);
  rejectReadOnlyFields(body);
  for (const required of ['key', 'name', 'projectTypeKey', 'leadAccountId']) {
    if (!readString(body, required)) {
      throw new Error(`project create writeback requires ${required}`);
    }
  }
  return {
    action: 'create_project',
    method: 'POST',
    endpoint: JIRA_REST_PROJECT_ROUTE,
    body,
  };
}

function normalizeTransition(payload: unknown): { id: string } {
  if (typeof payload === 'string') {
    const id = payload.trim();
    if (!id) {
      throw new Error('issue transition writeback requires transition.id');
    }
    return { id };
  }
  if (!isRecord(payload)) {
    throw new Error('issue transition writeback requires a transition object or id');
  }
  const transition = isRecord(payload.transition) ? payload.transition : payload;
  const id = readString(transition, 'id');
  if (!id) {
    throw new Error('issue transition writeback requires transition.id');
  }
  return { id: id.trim() };
}

function buildProjectUpdate(projectIdOrKey: string, content: string): JiraWritebackRequest {
  const payload = parseJsonObject(content);
  rejectReadOnlyFields(payload);
  const body = pickAllowed(payload, PROJECT_UPDATE_ALLOWLIST);
  if (Object.keys(body).length === 0) {
    throw new Error('project update writeback requires at least one mutable field');
  }
  return {
    action: 'update_project',
    method: 'PUT',
    endpoint: `${JIRA_REST_PROJECT_ROUTE}/${projectIdOrKey}`,
    body,
  };
}

function buildSprintUpdate(sprintId: string, content: string): JiraWritebackRequest {
  const payload = parseJsonObject(content);
  rejectReadOnlyFields(payload);
  const body = pickAllowed(payload, SPRINT_UPDATE_ALLOWLIST);
  if (Object.keys(body).length === 0) {
    throw new Error('sprint update writeback requires at least one mutable field');
  }
  return {
    action: 'update_sprint',
    method: 'PUT',
    endpoint: `${JIRA_REST_AGILE_SPRINT_ROUTE}/${sprintId}`,
    body,
  };
}

const ISSUE_FIELD_ALLOWLIST: ReadonlySet<string> = new Set([
  'assignee',
  'components',
  'description',
  'duedate',
  'environment',
  'fixVersions',
  'issuetype',
  'labels',
  'parent',
  'priority',
  'project',
  'reporter',
  'summary',
  'versions',
]);

const PROJECT_UPDATE_ALLOWLIST: ReadonlySet<string> = new Set([
  'assigneeType',
  'avatarId',
  'categoryId',
  'description',
  'issueSecurityScheme',
  'leadAccountId',
  'name',
  'notificationScheme',
  'permissionScheme',
  'projectTemplateKey',
  'projectTypeKey',
  'url',
]);

const SPRINT_UPDATE_ALLOWLIST: ReadonlySet<string> = new Set([
  'completeDate',
  'endDate',
  'goal',
  'name',
  'startDate',
  'state',
]);

const ENVELOPE_MARKER_KEYS = ['provider', 'objectType', 'objectId', 'workspaceId'] as const;
const READ_ONLY_FIELDS = new Set([
  'id',
  'key',
  'self',
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

function normalizeIssueFields(payload: Record<string, unknown>): Record<string, unknown> {
  const source = isRecord(payload.fields) ? payload.fields : payload;
  return pickAllowed(source, ISSUE_FIELD_ALLOWLIST);
}

function rejectReadOnlyFields(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
  }
}

function pickAllowed(
  payload: Record<string, unknown>,
  allowlist: ReadonlySet<string>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (allowlist.has(key) && value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function looksLikeSyncedEnvelope(payload: Record<string, unknown>): boolean {
  if (!isRecord(payload.payload)) return false;
  return ENVELOPE_MARKER_KEYS.some((key) => key in payload);
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content.trim();
  }
}

function readUnknown(record: unknown, key: string): unknown {
  return isRecord(record) ? record[key] : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed;
}
