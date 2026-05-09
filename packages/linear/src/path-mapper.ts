import { createHash } from 'node:crypto';
import { aliasCollisionSuffix, slugifyAlias } from './alias-slug.js';

export const LINEAR_PATH_ROOT = '/linear';
export const LINEAR_CANONICAL_STATES = ['Todo', 'In Progress', 'Done', 'Backlog', 'Canceled'] as const;

export const LINEAR_OBJECT_TYPES = [
  'comment',
  'cycle',
  'issue',
  'milestone',
  'project',
  'roadmap',
  'team',
  'user',
] as const;

export type LinearPathObjectType = (typeof LINEAR_OBJECT_TYPES)[number];

export interface NameWithIdOptions {
  existingNames?: Set<string>;
}

// TODO(#106): Thread existingNames through any future multi-record runtime emitters so collision hashes are exercised beyond helper-level tests.

export interface ParseNameWithIdResult {
  humanReadable: string | null;
  id: string;
  ext: string | null;
}

const OBJECT_TYPE_ALIASES: Readonly<Record<string, LinearPathObjectType>> = {
  comment: 'comment',
  comments: 'comment',
  linearcomment: 'comment',
  cycle: 'cycle',
  cycles: 'cycle',
  linearcycle: 'cycle',
  issue: 'issue',
  issues: 'issue',
  linearissue: 'issue',
  milestone: 'milestone',
  milestones: 'milestone',
  projectmilestone: 'milestone',
  projectmilestones: 'milestone',
  linearmilestone: 'milestone',
  project: 'project',
  projects: 'project',
  linearproject: 'project',
  roadmap: 'roadmap',
  roadmaps: 'roadmap',
  linearroadmap: 'roadmap',
  team: 'team',
  teams: 'team',
  linearteam: 'team',
  user: 'user',
  users: 'user',
  linearuser: 'user',
};

/**
 * Nango sync record `model` names → canonical Linear object types. The Nango
 * `linear-relay` integration emits records under these PascalCase model names
 * (see `cloud/nango-integrations/linear-relay/syncs/*.ts`). Resolving them
 * here lets the cloud's record-writer turn a Nango payload into a relayfile
 * path without hardcoding the mapping at the dispatch site.
 */
const NANGO_MODEL_MAP: Readonly<Record<string, LinearPathObjectType>> = {
  LinearComment: 'comment',
  LinearCycle: 'cycle',
  LinearIssue: 'issue',
  LinearMilestone: 'milestone',
  LinearProject: 'project',
  LinearRoadmap: 'roadmap',
  LinearTeam: 'team',
  LinearUser: 'user',
};

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

  return assertNonEmptySegment(slug, 'state slug');
}

export function normalizeLinearObjectType(objectType: string): LinearPathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Linear object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeLinearObjectType(objectType: string): LinearPathObjectType | undefined {
  try {
    return normalizeLinearObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoLinearModel(model: string): LinearPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeLinearObjectType(model);
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

export function linearIssueByStatePath(stateName: string, identifier: string): string {
  return `${LINEAR_PATH_ROOT}/issues/by-state/${slugifyStateName(stateName)}/${encodeLinearPathSegment(identifier)}.json`;
}

export function linearCommentPath(commentId: string, humanReadable?: string, opts?: NameWithIdOptions): string {
  return `${LINEAR_PATH_ROOT}/comments/${nameWithId(humanReadable, commentId, opts)}.json`;
}

export function linearCommentsIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/comments/_index.json`;
}

export function linearProjectPath(projectId: string): string {
  return `${LINEAR_PATH_ROOT}/projects/${encodeLinearPathSegment(projectId)}.json`;
}

export function linearCyclePath(cycleId: string): string {
  return `${LINEAR_PATH_ROOT}/cycles/${encodeLinearPathSegment(cycleId)}.json`;
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

export function linearRoadmapPath(roadmapId: string): string {
  return `${LINEAR_PATH_ROOT}/roadmaps/${encodeLinearPathSegment(roadmapId)}.json`;
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

export function linearByIdAliasPath(scope: string, identifier: string): string {
  return `${scope}/by-id/${encodeLinearPathSegment(identifier)}.json`;
}

export function computeLinearPath(objectType: string, objectId: string, humanReadable?: string): string {
  const normalizedType = normalizeLinearObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'issue':
      return linearIssuePath(normalizedId, humanReadable);
    case 'comment':
      return linearCommentPath(normalizedId, humanReadable);
    case 'project':
      return linearProjectPath(normalizedId);
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
