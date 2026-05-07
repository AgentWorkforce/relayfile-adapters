export const JIRA_PATH_ROOT = '/jira';

export const JIRA_OBJECT_TYPES = [
  'comment',
  'issue',
  'project',
  'sprint',
] as const;

export type JiraPathObjectType = (typeof JIRA_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, JiraPathObjectType>> = {
  comment: 'comment',
  comments: 'comment',
  jiracomment: 'comment',
  issue: 'issue',
  issues: 'issue',
  jiraissue: 'issue',
  project: 'project',
  projects: 'project',
  jiraproject: 'project',
  sprint: 'sprint',
  sprints: 'sprint',
  jirasprint: 'sprint',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Jira ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeJiraPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

function slugify(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function titleSegmentWithId(title: string | undefined, id: string): string {
  const slug = title ? slugify(title) : '';
  // Preserve hyphens in IDs (e.g. Jira issue keys like "ENG-42"). The "--"
  // separator between slug and ID is the disambiguator, and slugs never
  // contain "--" because slugify collapses any non-alphanumeric run into a
  // single "-". So extractJiraIdFromPathSegment can recover the ID
  // verbatim by capturing everything after the last "--".
  return slug ? `${slug}--${id}` : encodeJiraPathSegment(id);
}

export function normalizeJiraObjectType(objectType: string): JiraPathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Jira object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeJiraObjectType(objectType: string): JiraPathObjectType | undefined {
  try {
    return normalizeJiraObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function jiraIssuePath(issueIdOrKey: string, summary?: string): string {
  return `${JIRA_PATH_ROOT}/issues/${titleSegmentWithId(summary, issueIdOrKey)}.json`;
}

export function jiraProjectPath(projectIdOrKey: string, name?: string): string {
  return `${JIRA_PATH_ROOT}/projects/${titleSegmentWithId(name, projectIdOrKey)}.json`;
}

export function jiraSprintPath(sprintId: string, name?: string): string {
  return `${JIRA_PATH_ROOT}/sprints/${titleSegmentWithId(name, sprintId)}.json`;
}

export function jiraCommentPath(commentId: string, issueIdOrKey?: string): string {
  // Nested form is required for read/update because the Jira REST API needs
  // the parent issue context for both GET and PUT on a single comment:
  // GET/PUT /rest/api/3/issue/{issueIdOrKey}/comment/{commentId}.
  // The flat form is retained only for legacy webhook payloads that lack
  // issue context; it cannot be round-tripped through the API.
  if (issueIdOrKey) {
    return `${JIRA_PATH_ROOT}/issues/${encodeJiraPathSegment(issueIdOrKey)}/comments/${encodeJiraPathSegment(commentId)}.json`;
  }
  return `${JIRA_PATH_ROOT}/comments/${encodeJiraPathSegment(commentId)}.json`;
}

export function computeJiraPath(objectType: string, objectId: string, title?: string): string {
  const normalizedType = normalizeJiraObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'issue':
      return jiraIssuePath(normalizedId, title);
    case 'project':
      return jiraProjectPath(normalizedId, title);
    case 'sprint':
      return jiraSprintPath(normalizedId, title);
    case 'comment':
      // For comments, the optional `title` argument is repurposed as the
      // parent issueIdOrKey. Callers using the public API should prefer
      // jiraCommentPath(commentId, issueIdOrKey) directly.
      return jiraCommentPath(normalizedId, title);
  }
}

export function extractJiraIdFromPathSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const suffix = /--([^/]+)$/u.exec(decoded);
  return suffix?.[1] ? suffix[1] : decoded;
}
