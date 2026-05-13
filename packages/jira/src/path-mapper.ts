import { slugifyAlias } from './alias-slug.js';

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
  // Preserve hyphens in IDs (e.g. Jira issue keys like "ENG-42"). The "__"
  // separator between slug and ID is the disambiguator. Slugs never contain
  // "__" because slugify collapses any non-alphanumeric run into a single
  // "-" (so "_" and runs of "_" never make it through). That guarantees
  // extractJiraIdFromPathSegment can recover the ID verbatim by capturing
  // everything after the last "__". This matches the cross-adapter
  // `<slug>__<id>` convention used by github, linear, notion, and
  // confluence. The legacy "--" joiner remains readable by the parser so
  // mounts written before this migration keep resolving.
  return slug ? `${slug}__${id}` : encodeJiraPathSegment(id);
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

/**
 * Decode a Jira path segment back to its raw identifier. Supports both the
 * current `<slug>__<id>` convention and the legacy `<slug>--<id>` joiner so
 * mounts written before the cross-adapter convention migration keep
 * resolving. Mirrors `extractConfluenceIdFromPathSegment` in
 * `@relayfile/adapter-confluence`.
 */
// -- Index paths -----------------------------------------------------------

export function jiraRootIndexPath(): string {
  return `${JIRA_PATH_ROOT}/_index.json`;
}

export function jiraIssuesIndexPath(): string {
  return `${JIRA_PATH_ROOT}/issues/_index.json`;
}

export function jiraProjectsIndexPath(): string {
  return `${JIRA_PATH_ROOT}/projects/_index.json`;
}

export function jiraSprintsIndexPath(): string {
  return `${JIRA_PATH_ROOT}/sprints/_index.json`;
}

// -- Issue alias paths -----------------------------------------------------

/**
 * Stable reconciliation anchor for issues: keyed only on the immutable id,
 * so rename / state-transition / key-change all leave this alias resolving
 * to the latest payload. Adapter aux-file emission reads this alias before
 * every write to recover prior alias-field values and compute stale paths
 * to delete.
 */
export function jiraIssueByIdAliasPath(id: string): string {
  return `${JIRA_PATH_ROOT}/issues/by-id/${encodeJiraPathSegment(id)}.json`;
}

/**
 * `by-key/<TEAM-123>.json` — Jira's natural human-readable key. The key
 * follows the issue across renames, so this alias is durable for any
 * project that doesn't rename itself. Project-key changes (move) do
 * invalidate the key; aux-file emission deletes the prior key alias on
 * that transition.
 */
export function jiraIssueByKeyAliasPath(key: string): string {
  return `${JIRA_PATH_ROOT}/issues/by-key/${encodeJiraPathSegment(key)}.json`;
}

/**
 * `by-state/<status>/<id>.json` — grouped by status name slug (`to-do`,
 * `in-progress`, `done`). The leaf is the issue id (not the key), matching
 * the LAYOUT contract and giving readers a stable lookup that survives
 * project moves. Issues transitioning between states require deleting the
 * old `by-state/<old-state>/<id>.json` file, which the emit-aux module
 * handles via the by-id reconciliation read.
 */
export function jiraIssueByStatePath(stateName: string, id: string): string {
  const slug = slugifyAlias(stateName);
  return `${JIRA_PATH_ROOT}/issues/by-state/${encodeJiraPathSegment(slug)}/${encodeJiraPathSegment(id)}.json`;
}

/**
 * `by-assignee/<accountId>/<issueId>.json` — grouped by the Atlassian
 * `accountId` of the assignee (a stable 24-char identifier in Jira Cloud).
 * Issues without an assignee are not emitted under this prefix. When an
 * issue is re-assigned, aux-file emission deletes the prior path via the
 * by-id reconciliation read, so this alias always reflects the current
 * assignment.
 */
export function jiraIssueByAssigneeAliasPath(accountId: string, issueId: string): string {
  return `${JIRA_PATH_ROOT}/issues/by-assignee/${encodeJiraPathSegment(accountId)}/${encodeJiraPathSegment(issueId)}.json`;
}

// -- Project alias paths ---------------------------------------------------

/**
 * Stable reconciliation anchor for projects. The canonical
 * `<slug>__<id>.json` filename embeds the (mutable) project name; this
 * alias is keyed only on the immutable id so readers can resolve a
 * project from its id without scanning. Mirrors the role of
 * `jiraIssueByIdAliasPath` for projects, enabling canonical-delete on
 * tombstones.
 */
export function jiraProjectByIdAliasPath(id: string): string {
  return `${JIRA_PATH_ROOT}/projects/by-id/${encodeJiraPathSegment(id)}.json`;
}

// -- Sprint alias paths ----------------------------------------------------

/**
 * Stable reconciliation anchor for sprints. See `jiraProjectByIdAliasPath`.
 */
export function jiraSprintByIdAliasPath(id: string): string {
  return `${JIRA_PATH_ROOT}/sprints/by-id/${encodeJiraPathSegment(id)}.json`;
}

export function extractJiraIdFromPathSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const currentMatch = /__([^/]+)$/u.exec(decoded);
  if (currentMatch?.[1]) {
    return currentMatch[1];
  }
  const legacyMatch = /--([^/]+)$/u.exec(decoded);
  return legacyMatch?.[1] ? legacyMatch[1] : decoded;
}
