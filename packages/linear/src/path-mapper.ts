export const LINEAR_PATH_ROOT = '/linear';

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
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Encode an id as a path-safe suffix that can be losslessly reversed.
 * We dehyphenate so the suffix is a single token (no `-` collision with
 * the slug separator) but keep the full id so the round-trip is
 * unambiguous. Truncating to 8 chars (the previous behaviour) breaks
 * writeback resolvers that need the full id to address the resource.
 */
function idSuffix(id: string): string {
  return id.replace(/-/g, '');
}

function titleSegmentWithId(title: string | undefined, id: string): string {
  const slug = title ? slugify(title) : '';
  return slug ? `${slug}--${idSuffix(id)}` : encodeLinearPathSegment(id);
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

export function linearIssuePath(issueId: string, title?: string): string {
  return `${LINEAR_PATH_ROOT}/issues/${titleSegmentWithId(title, issueId)}.json`;
}

export function linearCommentPath(commentId: string): string {
  return `${LINEAR_PATH_ROOT}/comments/${encodeLinearPathSegment(commentId)}.json`;
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

export function linearUserPath(userId: string): string {
  return `${LINEAR_PATH_ROOT}/users/${encodeLinearPathSegment(userId)}.json`;
}

export function linearMilestonePath(milestoneId: string): string {
  return `${LINEAR_PATH_ROOT}/milestones/${encodeLinearPathSegment(milestoneId)}.json`;
}

export function linearRoadmapPath(roadmapId: string): string {
  return `${LINEAR_PATH_ROOT}/roadmaps/${encodeLinearPathSegment(roadmapId)}.json`;
}

export function computeLinearPath(objectType: string, objectId: string, title?: string): string {
  const normalizedType = normalizeLinearObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'issue':
      return linearIssuePath(normalizedId, title);
    case 'comment':
      return linearCommentPath(normalizedId);
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
