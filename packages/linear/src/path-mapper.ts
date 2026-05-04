export const LINEAR_PATH_ROOT = '/linear';

export const LINEAR_OBJECT_TYPES = ['comment', 'cycle', 'issue', 'project'] as const;

export type LinearPathObjectType = (typeof LINEAR_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, LinearPathObjectType>> = {
  comment: 'comment',
  comments: 'comment',
  cycle: 'cycle',
  cycles: 'cycle',
  issue: 'issue',
  issues: 'issue',
  project: 'project',
  projects: 'project',
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

function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}

function titleSegmentWithId(title: string | undefined, id: string): string {
  const slug = title ? slugify(title) : '';
  return slug ? `${slug}--${shortId(id)}` : encodeLinearPathSegment(id);
}

export function normalizeLinearObjectType(objectType: string): LinearPathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Linear object type: ${objectType}`);
  }
  return mapped;
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
  }
}
