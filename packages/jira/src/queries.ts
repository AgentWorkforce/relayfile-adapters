import { extractJiraIdFromPathSegment } from './path-mapper.js';
import type {
  JiraIssue,
  JiraProject,
  JiraReadRequest,
  JiraSprint,
} from './types.js';

// -- Index rows ------------------------------------------------------------

/**
 * Shape of `/jira/issues/_index.json` rows. Mirrors the LAYOUT contract:
 * `{ id, title, updated, key, state, projectKey }`. The cloud's previous
 * `writeJiraAuxiliaryFiles` used `status` as the column name; the adapter
 * adopts `state` to match the layout doc surfaced to agents and to align
 * with the cross-adapter convention used by Linear (which also surfaces a
 * `state` column for status).
 */
export interface JiraIssueIndexRow {
  id: string;
  title: string;
  updated: string;
  key: string;
  state: string;
  projectKey: string;
}

export interface JiraProjectIndexRow {
  id: string;
  title: string;
  updated: string;
  key: string;
}

export interface JiraSprintIndexRow {
  id: string;
  title: string;
  updated: string;
  key: string;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function jiraIssueIndexRow(issue: JiraIssue): JiraIssueIndexRow {
  const fields = isRecord(issue.fields) ? issue.fields : {};
  const status = isRecord(fields.status) ? fields.status : {};
  const project = isRecord(fields.project) ? fields.project : {};

  return {
    id: String(issue.id),
    title:
      readNonEmptyString((fields as { summary?: unknown }).summary) ??
      readNonEmptyString((issue as { key?: unknown }).key) ??
      '',
    updated:
      readNonEmptyString((fields as { updated?: unknown }).updated) ??
      readNonEmptyString((issue as { updated?: unknown }).updated) ??
      '',
    key: readNonEmptyString((issue as { key?: unknown }).key) ?? '',
    state: readNonEmptyString((status as { name?: unknown }).name) ?? '',
    projectKey: readNonEmptyString((project as { key?: unknown }).key) ?? '',
  };
}

export function jiraProjectIndexRow(project: JiraProject): JiraProjectIndexRow {
  return {
    id: String(project.id),
    title:
      readNonEmptyString(project.name) ??
      readNonEmptyString(project.key) ??
      '',
    updated:
      readNonEmptyString((project as { updated?: unknown }).updated) ??
      '',
    key: readNonEmptyString(project.key) ?? '',
  };
}

export function jiraSprintIndexRow(sprint: JiraSprint): JiraSprintIndexRow {
  return {
    id: String(sprint.id),
    title:
      readNonEmptyString(sprint.name) ??
      '',
    updated:
      readNonEmptyString((sprint as { updated?: unknown }).updated) ??
      readNonEmptyString(sprint.completeDate) ??
      readNonEmptyString(sprint.endDate) ??
      readNonEmptyString(sprint.startDate) ??
      '',
    key: readNonEmptyString((sprint as { key?: unknown }).key) ?? '',
  };
}

export const JIRA_REST_ISSUE_ROUTE = '/rest/api/3/issue';
export const JIRA_REST_PROJECT_ROUTE = '/rest/api/3/project';
export const JIRA_REST_SEARCH_ROUTE = '/rest/api/3/search';
export const JIRA_REST_AGILE_SPRINT_ROUTE = '/rest/agile/1.0/sprint';

export function resolveJiraReadRequest(path: string): JiraReadRequest {
  const normalized = normalizePath(path);

  if (normalized === '/jira/issues' || normalized === '/jira/issues/') {
    return {
      action: 'list_issues',
      method: 'GET',
      endpoint: JIRA_REST_SEARCH_ROUTE,
      query: {
        jql: 'order by updated DESC',
        maxResults: '100',
      },
    };
  }

  if (normalized === '/jira/projects' || normalized === '/jira/projects/') {
    return {
      action: 'list_projects',
      method: 'GET',
      endpoint: JIRA_REST_PROJECT_ROUTE,
    };
  }

  const issueCommentMatch = normalized.match(/^\/jira\/issues\/([^/]+)\/comments\/?$/u);
  if (issueCommentMatch?.[1]) {
    return {
      action: 'get_issue_comments',
      method: 'GET',
      endpoint: `${JIRA_REST_ISSUE_ROUTE}/${extractJiraIdFromPathSegment(issueCommentMatch[1])}/comment`,
    };
  }

  const issueMatch = normalized.match(/^\/jira\/issues\/([^/]+)\.json$/u);
  if (issueMatch?.[1]) {
    return {
      action: 'get_issue',
      method: 'GET',
      endpoint: `${JIRA_REST_ISSUE_ROUTE}/${extractJiraIdFromPathSegment(issueMatch[1])}`,
      query: {
        expand: 'renderedFields,changelog',
      },
    };
  }

  const projectVersionsMatch = normalized.match(/^\/jira\/projects\/([^/]+)\/versions\/?$/u);
  if (projectVersionsMatch?.[1]) {
    return {
      action: 'get_project_versions',
      method: 'GET',
      endpoint: `${JIRA_REST_PROJECT_ROUTE}/${extractJiraIdFromPathSegment(projectVersionsMatch[1])}/versions`,
    };
  }

  const projectMatch = normalized.match(/^\/jira\/projects\/([^/]+)\.json$/u);
  if (projectMatch?.[1]) {
    return {
      action: 'get_project',
      method: 'GET',
      endpoint: `${JIRA_REST_PROJECT_ROUTE}/${extractJiraIdFromPathSegment(projectMatch[1])}`,
    };
  }

  const sprintMatch = normalized.match(/^\/jira\/sprints\/([^/]+)\.json$/u);
  if (sprintMatch?.[1]) {
    return {
      action: 'get_sprint',
      method: 'GET',
      endpoint: `${JIRA_REST_AGILE_SPRINT_ROUTE}/${extractJiraIdFromPathSegment(sprintMatch[1])}`,
    };
  }

  const nestedCommentMatch = normalized.match(
    /^\/jira\/issues\/([^/]+)\/comments\/([^/]+)\.json$/u,
  );
  if (nestedCommentMatch?.[1] && nestedCommentMatch[2]) {
    return {
      action: 'get_comment',
      method: 'GET',
      endpoint: `${JIRA_REST_ISSUE_ROUTE}/${extractJiraIdFromPathSegment(nestedCommentMatch[1])}/comment/${extractJiraIdFromPathSegment(nestedCommentMatch[2])}`,
    };
  }

  if (/^\/jira\/comments\/[^/]+\.json$/u.test(normalized)) {
    throw new Error(
      `Comment read requires the parent issue context. Use /jira/issues/{issueIdOrKey}/comments/{commentId}.json instead of ${path}`,
    );
  }

  throw new Error(`No Jira read rule matched ${path}`);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed;
}
