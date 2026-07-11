import { createHash } from 'node:crypto';
import { aliasCollisionSuffix, slugifyAlias } from './alias-slug.js';
import {
  linearStatePath,
  normalizeNangoLinearModel,
} from './planner-contract.js';
import type { LinearPathObjectType } from './planner-contract.js';
import { LINEAR_AGENT_WEBHOOK_EVENTS } from './types.js';

export {
  LINEAR_OBJECT_TYPES,
  linearStatePath,
  linearStatesIndexPath,
  normalizeNangoLinearModel,
} from './planner-contract.js';
export type { LinearPathObjectType } from './planner-contract.js';

export const LINEAR_PATH_ROOT = '/linear';
export const LINEAR_CANONICAL_STATES = ['Todo', 'In Progress', 'Done', 'Backlog', 'Canceled'] as const;
export const LINEAR_AGENT_WEBHOOK_PATH_ROOTS = {
  AgentSessionEvent: `${LINEAR_PATH_ROOT}/agent-sessions`,
  AppUserNotification: `${LINEAR_PATH_ROOT}/app-user-notifications`,
  PermissionChange: `${LINEAR_PATH_ROOT}/permission-changes`,
  OAuthApp: `${LINEAR_PATH_ROOT}/oauth-app`,
} as const;

export type LinearAgentWebhookCategory = keyof typeof LINEAR_AGENT_WEBHOOK_PATH_ROOTS;

export interface NameWithIdOptions {
  existingNames?: Set<string>;
}

// TODO(#106): Thread existingNames through any future multi-record runtime emitters so collision hashes are exercised beyond helper-level tests.

export interface ParseNameWithIdResult {
  humanReadable: string | null;
  id: string;
  ext: string | null;
}

const LINEAR_PUBLIC_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/u;
const MAX_HUMAN_READABLE_LENGTH = 80;
const CANONICAL_STATE_SLUGS: Readonly<Record<(typeof LINEAR_CANONICAL_STATES)[number], string>> = {
  Todo: 'todo',
  'In Progress': 'in-progress',
  Done: 'done',
  Backlog: 'backlog',
  Canceled: 'canceled',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Linear ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeLinearPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

function slugify(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]+/g, '');
  const slug = ascii
    .replace(/^-+|-+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  if (slug.length <= MAX_HUMAN_READABLE_LENGTH) {
    return slug;
  }

  const truncated = slug.slice(0, MAX_HUMAN_READABLE_LENGTH);
  const cutIndex = truncated.lastIndexOf('-');
  const bounded = cutIndex > 0 ? truncated.slice(0, cutIndex) : truncated;
  return bounded.replace(/^-+|-+$/g, '');
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function normalizeHumanReadable(value: string | undefined): string {
  if (!value) {
    return '';
  }

  if (LINEAR_PUBLIC_IDENTIFIER_PATTERN.test(value)) {
    return value;
  }

  return slugify(value);
}

export function nameWithId(humanReadable: string | undefined, id: string, opts: NameWithIdOptions = {}): string {
  const normalizedId = encodeLinearPathSegment(id);
  const normalizedHumanReadable = normalizeHumanReadable(humanReadable);
  if (!normalizedHumanReadable) {
    return normalizedId;
  }

  const existingNames = opts.existingNames;
  const baseName = existingNames?.has(normalizedHumanReadable)
    ? `${normalizedHumanReadable}-${shortHash(normalizedId)}`
    : normalizedHumanReadable;
  existingNames?.add(baseName);
  return `${baseName}__${normalizedId}`;
}

// For Linear `<humanReadable>__<id>` segments, `humanReadable` is the leading prefix and `id` is the trailing identifier.
export function parseNameWithId(filename: string): ParseNameWithIdResult {
  const extIndex = filename.lastIndexOf('.');
  const ext = extIndex > 0 && extIndex < filename.length - 1 ? filename.slice(extIndex + 1) : null;
  const basename = ext ? filename.slice(0, extIndex) : filename;
  const separatorIndex = basename.lastIndexOf('__');

  if (separatorIndex <= 0 || separatorIndex === basename.length - 2) {
    return {
      humanReadable: null,
      id: basename,
      ext,
    };
  }

  return {
    humanReadable: basename.slice(0, separatorIndex),
    id: basename.slice(separatorIndex + 2),
    ext,
  };
}

export function slugifyStateName(stateName: string): string {
  const trimmed = assertNonEmptySegment(stateName, 'state name');
  const canonicalSlug = CANONICAL_STATE_SLUGS[trimmed as (typeof LINEAR_CANONICAL_STATES)[number]];
  if (canonicalSlug) {
    return canonicalSlug;
  }

  let slug = '';
  let previousWasSeparator = false;
  for (const character of trimmed.normalize('NFC').toLowerCase()) {
    if (/\s/u.test(character)) {
      if (!previousWasSeparator && slug.length > 0) {
        slug += '-';
      }
      previousWasSeparator = true;
      continue;
    }

    previousWasSeparator = false;
    if (/[a-z0-9]/u.test(character)) {
      slug += character;
      continue;
    }

    if (character === '-') {
      slug += '%2D';
      continue;
    }

    slug += encodeURIComponent(character);
  }

  // Symbol-only state names are rejected so callers surface an ingest error
  // instead of emitting an ambiguous empty by-state directory.
  return assertNonEmptySegment(slug, 'state slug');
}

export function normalizeLinearObjectType(objectType: string): LinearPathObjectType {
  return normalizeNangoLinearModel(objectType);
}

export function tryNormalizeLinearObjectType(objectType: string): LinearPathObjectType | undefined {
  try {
    return normalizeLinearObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function linearAgentWebhookCategory(eventType: string): LinearAgentWebhookCategory | null {
  const category = eventType.trim().split('.')[0] ?? '';
  return category in LINEAR_AGENT_WEBHOOK_PATH_ROOTS
    ? category as LinearAgentWebhookCategory
    : null;
}

export function linearAgentWebhookTriggerGlob(eventType: string): string | null {
  if (!LINEAR_AGENT_WEBHOOK_EVENTS.includes(eventType as (typeof LINEAR_AGENT_WEBHOOK_EVENTS)[number])) {
    return null;
  }
  const category = linearAgentWebhookCategory(eventType);
  return category ? `${LINEAR_AGENT_WEBHOOK_PATH_ROOTS[category]}/**` : null;
}

export function linearAgentWebhookEventPath(eventType: string, objectId?: string | null): string | null {
  if (!LINEAR_AGENT_WEBHOOK_EVENTS.includes(eventType as (typeof LINEAR_AGENT_WEBHOOK_EVENTS)[number])) {
    return null;
  }
  const category = linearAgentWebhookCategory(eventType);
  if (!category) {
    return null;
  }
  const root = LINEAR_AGENT_WEBHOOK_PATH_ROOTS[category];
  const id = objectId?.trim();
  return id ? `${root}/${encodeLinearPathSegment(id)}.json` : null;
}

export function linearIssuePath(
  issueId: string,
  identifierOrHumanReadable?: string,
  title?: string,
  opts?: NameWithIdOptions,
): string {
  const humanReadable = title ? identifierOrHumanReadable ?? title : identifierOrHumanReadable;
  return `${LINEAR_PATH_ROOT}/issues/${nameWithId(humanReadable, issueId, opts)}.json`;
}

export function linearIssuesIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/issues/_index.json`;
}

export function linearRootIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/_index.json`;
}

export function linearIssueByStatePath(stateName: string, identifier: string): string {
  return `${LINEAR_PATH_ROOT}/issues/by-state/${slugifyStateName(stateName)}/${encodeLinearPathSegment(identifier)}.json`;
}

export function linearIssueByAssigneePath(assigneeId: string, identifier: string): string {
  return `${LINEAR_PATH_ROOT}/issues/by-assignee/${encodeLinearPathSegment(assigneeId)}/${encodeLinearPathSegment(identifier)}.json`;
}

export function linearIssueByCreatorPath(creatorId: string, identifier: string): string {
  return `${LINEAR_PATH_ROOT}/issues/by-creator/${encodeLinearPathSegment(creatorId)}/${encodeLinearPathSegment(identifier)}.json`;
}

export function linearIssueByPriorityPath(priority: number | string, identifier: string): string {
  return `${LINEAR_PATH_ROOT}/issues/by-priority/${encodeLinearPathSegment(
    linearPrioritySlug(priority),
  )}/${encodeLinearPathSegment(identifier)}.json`;
}

export function linearIssueByEditedPath(editedDate: string, issueId: string): string {
  return `${LINEAR_PATH_ROOT}/issues/by-edited/${encodeLinearPathSegment(editedDate)}/${encodeLinearPathSegment(issueId)}.json`;
}

export function linearPrioritySlug(priority: number | string): string {
  if (typeof priority === 'number') {
    switch (priority) {
      case 0:
        return 'no-priority';
      case 1:
        return 'urgent';
      case 2:
        return 'high';
      case 3:
        return 'medium';
      case 4:
        return 'low';
      default:
        return encodeLinearPathSegment(String(priority));
    }
  }
  return slugifyAlias(priority);
}

/**
 * Canonical comment record path. The comment is a **directory record**
 * (`comments/<name>__<id>/meta.json`), not a flat leaf file. This is
 * deliberate: a Linear comment can grow children — Linear supports per-comment
 * emoji reactions (the webhook normalizer already recognizes `reaction`
 * payloads) and threaded replies — which would materialize under
 * `comments/<name>__<id>/...`. A flat leaf `comments/<name>__<id>.json` cannot
 * coexist with that same-named directory on a POSIX mount
 * (`mkdir ... : not a directory`), wedging the whole mirror. Readers should
 * fall back to the legacy filename via
 * {@link linearCommentReadCandidatePaths}.
 */
export function linearCommentPath(commentId: string, humanReadable?: string, opts?: NameWithIdOptions): string {
  return `${LINEAR_PATH_ROOT}/comments/${nameWithId(humanReadable, commentId, opts)}/meta.json`;
}

/**
 * @deprecated Pre-0.9.x emitted a flat `/linear/comments/<name>__<id>.json`
 * leaf file, which collides with any same-named child directory on a POSIX
 * mount. Use {@link linearCommentPath}. Retained for back-compat reads (and
 * legacy-mirror tombstone deletes) only — see
 * {@link linearCommentReadCandidatePaths}.
 */
export function linearCommentLegacyPath(commentId: string, humanReadable?: string, opts?: NameWithIdOptions): string {
  return `${LINEAR_PATH_ROOT}/comments/${nameWithId(humanReadable, commentId, opts)}.json`;
}

/**
 * Reader hint: candidate paths for a Linear comment canonical record, in order
 * of preference — current (`<name>__<id>/meta.json`) then legacy
 * (`<name>__<id>.json`) — so a comment mirrored by either the current or a
 * pre-0.9.x adapter still reads.
 */
export function linearCommentReadCandidatePaths(commentId: string, humanReadable?: string, opts?: NameWithIdOptions): string[] {
  return [
    linearCommentPath(commentId, humanReadable, opts),
    linearCommentLegacyPath(commentId, humanReadable, opts),
  ];
}

export function linearCommentsIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/comments/_index.json`;
}

export function linearProjectDirectoryPath(projectId: string): string {
  return `${LINEAR_PATH_ROOT}/projects/${encodeLinearPathSegment(projectId)}`;
}

export function linearProjectPath(projectId: string): string {
  return `${linearProjectDirectoryPath(projectId)}/meta.json`;
}

/**
 * @deprecated Pre-project-writeback mirrors emitted projects as flat
 * `/linear/projects/<id>.json` leaf files. New mirrors use
 * `/linear/projects/<id>/meta.json` so project child writebacks such as
 * `add-issues.json` can coexist without a POSIX file/dir collision.
 */
export function linearProjectLegacyPath(projectId: string): string {
  return `${LINEAR_PATH_ROOT}/projects/${encodeLinearPathSegment(projectId)}.json`;
}

export function linearProjectsIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/projects/_index.json`;
}

export function linearProjectByStatePath(state: string, projectId: string): string {
  const slug = slugifyAlias(assertNonEmptySegment(state, 'project state'));
  if (!slug) {
    throw new Error('Linear project state must slug to a non-empty string');
  }
  return `${LINEAR_PATH_ROOT}/projects/by-state/${encodeLinearPathSegment(slug)}/${encodeLinearPathSegment(projectId)}.json`;
}

export function linearProjectByTeamPath(teamId: string, projectId: string): string {
  return `${LINEAR_PATH_ROOT}/projects/by-team/${encodeLinearPathSegment(teamId)}/${encodeLinearPathSegment(projectId)}.json`;
}

/** Local writeback path for grouping existing issues into a project. */
export function linearProjectAddIssuesPath(projectId: string): string {
  return `${linearProjectDirectoryPath(projectId)}/add-issues.json`;
}

export function linearLabelPath(labelId: string): string {
  return `${LINEAR_PATH_ROOT}/labels/${encodeLinearPathSegment(labelId)}.json`;
}

export function linearLabelsIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/labels/_index.json`;
}

export function linearLabelByTeamPath(teamId: string, labelId: string): string {
  return `${LINEAR_PATH_ROOT}/labels/by-team/${encodeLinearPathSegment(teamId)}/${encodeLinearPathSegment(labelId)}.json`;
}

export function linearCyclePath(cycleId: string): string {
  return `${LINEAR_PATH_ROOT}/cycles/${encodeLinearPathSegment(cycleId)}.json`;
}

export function linearCyclesIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/cycles/_index.json`;
}

export function linearTeamPath(teamId: string): string {
  return `${LINEAR_PATH_ROOT}/teams/${encodeLinearPathSegment(teamId)}.json`;
}

export function linearTeamsIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/teams/_index.json`;
}

export function linearUserPath(userId: string): string {
  return `${LINEAR_PATH_ROOT}/users/${encodeLinearPathSegment(userId)}.json`;
}

export function linearUsersIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/users/_index.json`;
}

export function linearMilestonePath(milestoneId: string): string {
  return `${LINEAR_PATH_ROOT}/milestones/${encodeLinearPathSegment(milestoneId)}.json`;
}

export function linearMilestonesIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/milestones/_index.json`;
}

export function linearRoadmapPath(roadmapId: string): string {
  return `${LINEAR_PATH_ROOT}/roadmaps/${encodeLinearPathSegment(roadmapId)}.json`;
}

export function linearRoadmapsIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/roadmaps/_index.json`;
}

export function linearByTitleAliasPath(scope: string, title: string, id: string, colliding = false): string {
  const slug = slugifyAlias(title);
  if (!slug) {
    // TODO(issue #106): define empty-slug fallback/skip behavior for emoji-only or punctuation-only Linear titles instead of throwing.
    throw new Error('Linear alias title must slug to a non-empty string');
  }

  const filename = colliding ? `${slug}-${aliasCollisionSuffix(id)}` : slug;
  return `${scope}/by-title/${encodeLinearPathSegment(filename)}.json`;
}

export function linearByNameAliasPath(scope: string, name: string, id: string, colliding = false): string {
  const slug = slugifyAlias(name);
  if (!slug) {
    throw new Error('Linear alias name must slug to a non-empty string');
  }

  const filename = colliding ? `${slug}-${aliasCollisionSuffix(id)}` : slug;
  return `${scope}/by-name/${encodeLinearPathSegment(filename)}.json`;
}

export function linearByIdAliasPath(scope: string, identifier: string): string {
  return `${scope}/by-id/${encodeLinearPathSegment(identifier)}.json`;
}

/**
 * Stable UUID-keyed alias for Linear records. Used as the reconciliation
 * anchor when computing prior state, because the Linear UUID (`issue.id`)
 * is always present even on bare delete tombstones, whereas the human-readable
 * `identifier` (e.g. `TEAM-123`) may be missing on partial payloads or on
 * issues that were created without one. The existing `linearByIdAliasPath`
 * remains the human-readable lookup alias keyed on `identifier` when
 * available — both are emitted side-by-side for issues so consumers can
 * resolve a record by either key.
 */
export function linearByUuidAliasPath(scope: string, uuid: string): string {
  return `${scope}/by-uuid/${encodeLinearPathSegment(uuid)}.json`;
}

export function computeLinearPath(objectType: string, objectId: string, humanReadable?: string): string {
  const normalizedType = normalizeLinearObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'issue':
      return linearIssuePath(normalizedId, humanReadable);
    case 'label':
      return linearLabelPath(normalizedId);
    case 'comment':
      return linearCommentPath(normalizedId, humanReadable);
    case 'project':
      return linearProjectPath(normalizedId);
    case 'state':
      return linearStatePath(normalizedId);
    case 'cycle':
      return linearCyclePath(normalizedId);
    case 'team':
      return linearTeamPath(normalizedId);
    case 'user':
      return linearUserPath(normalizedId);
    case 'milestone':
      return linearMilestonePath(normalizedId);
    case 'roadmap':
      return linearRoadmapPath(normalizedId);
  }
}
