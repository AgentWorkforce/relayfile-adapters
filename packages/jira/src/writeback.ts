import { extractJiraIdFromPathSegment } from './path-mapper.js';
import type { JiraWritebackRequest } from './types.js';

export const JIRA_REST_ISSUE_ROUTE = '/rest/api/3/issue';
export const JIRA_REST_PROJECT_ROUTE = '/rest/api/3/project';
export const JIRA_REST_AGILE_SPRINT_ROUTE = '/rest/agile/1.0/sprint';

export function resolveJiraWritebackRequest(path: string, content: string): JiraWritebackRequest {
  const normalized = normalizePath(path);

  const newCommentMatch = normalized.match(/^\/jira\/issues\/([^/]+)\/comments\/new\.json$/u);
  if (newCommentMatch?.[1]) {
    return buildCommentCreate(extractJiraIdFromPathSegment(newCommentMatch[1]), content);
  }

  const nestedCommentUpdateMatch = normalized.match(
    /^\/jira\/issues\/([^/]+)\/comments\/([^/]+)\.json$/u,
  );
  if (nestedCommentUpdateMatch?.[1] && nestedCommentUpdateMatch[2]) {
    return buildCommentUpdate(
      extractJiraIdFromPathSegment(nestedCommentUpdateMatch[1]),
      extractJiraIdFromPathSegment(nestedCommentUpdateMatch[2]),
      content,
    );
  }

  // Reject the flat form for updates: Jira's PUT /comment requires the
  // parent issue ID in the path, so the flat form cannot resolve.
  if (/^\/jira\/comments\/[^/]+\.json$/u.test(normalized)) {
    throw new Error(
      `Comment update writeback requires the parent issue context. Use /jira/issues/{issueIdOrKey}/comments/{commentId}.json instead of ${path}`,
    );
  }

  if (normalized === '/jira/issues/new.json' || normalized === '/jira/issues/') {
    return buildIssueCreate(content);
  }

  const issueUpdateMatch = normalized.match(/^\/jira\/issues\/([^/]+)\.json$/u);
  if (issueUpdateMatch?.[1]) {
    return buildIssueUpdate(extractJiraIdFromPathSegment(issueUpdateMatch[1]), content);
  }

  if (normalized === '/jira/projects/new.json' || normalized === '/jira/projects/') {
    return buildProjectCreate(content);
  }

  const projectUpdateMatch = normalized.match(/^\/jira\/projects\/([^/]+)\.json$/u);
  if (projectUpdateMatch?.[1]) {
    return buildProjectUpdate(extractJiraIdFromPathSegment(projectUpdateMatch[1]), content);
  }

  const sprintUpdateMatch = normalized.match(/^\/jira\/sprints\/([^/]+)\.json$/u);
  if (sprintUpdateMatch?.[1]) {
    return buildSprintUpdate(extractJiraIdFromPathSegment(sprintUpdateMatch[1]), content);
  }

  throw new Error(`No Jira writeback rule matched ${path}`);
}

function buildCommentCreate(issueIdOrKey: string, content: string): JiraWritebackRequest {
  const parsed = safeParseJson(content);
  const body = typeof parsed === 'string' ? parsed : readUnknown(parsed, 'body');
  if (!body) {
    throw new Error('comments/new.json writeback requires a non-empty body');
  }
  return {
    action: 'create_comment',
    method: 'POST',
    endpoint: `${JIRA_REST_ISSUE_ROUTE}/${issueIdOrKey}/comment`,
    body: { body },
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
    body: { body },
  };
}

function buildIssueCreate(content: string): JiraWritebackRequest {
  const payload = parseJsonObject(content);
  const fields = normalizeIssueFields(payload);
  if (!isRecord(fields.project)) {
    throw new Error('issues/new.json writeback requires fields.project');
  }
  if (!readString(fields, 'summary')) {
    throw new Error('issues/new.json writeback requires fields.summary');
  }
  if (!isRecord(fields.issuetype)) {
    throw new Error('issues/new.json writeback requires fields.issuetype');
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

function buildProjectCreate(content: string): JiraWritebackRequest {
  const body = parseJsonObject(content);
  for (const required of ['key', 'name', 'projectTypeKey', 'leadAccountId']) {
    if (!readString(body, required)) {
      throw new Error(`projects/new.json writeback requires ${required}`);
    }
  }
  return {
    action: 'create_project',
    method: 'POST',
    endpoint: JIRA_REST_PROJECT_ROUTE,
    body,
  };
}

function buildProjectUpdate(projectIdOrKey: string, content: string): JiraWritebackRequest {
  const payload = parseJsonObject(content);
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

function normalizeIssueFields(payload: Record<string, unknown>): Record<string, unknown> {
  const source = isRecord(payload.fields) ? payload.fields : payload;
  return pickAllowed(source, ISSUE_FIELD_ALLOWLIST);
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
