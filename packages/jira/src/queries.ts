import { extractJiraIdFromPathSegment } from './path-mapper.js';
import type { JiraReadRequest } from './types.js';

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

  const commentMatch = normalized.match(/^\/jira\/comments\/([^/]+)\.json$/u);
  if (commentMatch?.[1]) {
    return {
      action: 'get_comment',
      method: 'GET',
      endpoint: `${JIRA_REST_ISSUE_ROUTE}/comment/list`,
      query: {
        ids: extractJiraIdFromPathSegment(commentMatch[1]),
      },
    };
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
