export const ASANA_PATH_ROOT = '/asana';

export const ASANA_OBJECT_TYPES = [
  'task',
  'project',
  'section',
  'workspace',
] as const;

export type AsanaPathObjectType = (typeof ASANA_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, AsanaPathObjectType>> = {
  asanaproject: 'project',
  asanasection: 'section',
  asanatask: 'task',
  asanaworkspace: 'workspace',
  project: 'project',
  projects: 'project',
  section: 'section',
  sections: 'section',
  task: 'task',
  tasks: 'task',
  workspace: 'workspace',
  workspaces: 'workspace',
};

const NANGO_MODEL_MAP: Readonly<Record<string, AsanaPathObjectType>> = {
  AsanaProject: 'project',
  AsanaSection: 'section',
  AsanaTask: 'task',
  AsanaWorkspace: 'workspace',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Asana ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeAsanaPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

function slugify(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function idSuffix(id: string): string {
  return id.replace(/-/g, '');
}

function titleSegmentWithId(title: string | undefined, id: string): string {
  const slug = title ? slugify(title) : '';
  return slug ? `${slug}--${idSuffix(id)}` : encodeAsanaPathSegment(id);
}

export function normalizeAsanaObjectType(objectType: string): AsanaPathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Asana object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeAsanaObjectType(objectType: string): AsanaPathObjectType | undefined {
  try {
    return normalizeAsanaObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoAsanaModel(model: string): AsanaPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeAsanaObjectType(model);
}

export function asanaTaskPath(taskId: string, name?: string): string {
  return `${ASANA_PATH_ROOT}/tasks/${titleSegmentWithId(name, taskId)}.json`;
}

export function asanaProjectPath(projectId: string, name?: string): string {
  return `${ASANA_PATH_ROOT}/projects/${titleSegmentWithId(name, projectId)}.json`;
}

export function asanaSectionPath(sectionId: string, name?: string): string {
  return `${ASANA_PATH_ROOT}/sections/${titleSegmentWithId(name, sectionId)}.json`;
}

export function asanaWorkspacePath(workspaceId: string, name?: string): string {
  return `${ASANA_PATH_ROOT}/workspaces/${titleSegmentWithId(name, workspaceId)}.json`;
}

export function computeAsanaPath(objectType: string, objectId: string, name?: string): string {
  const normalizedType = normalizeAsanaObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'task':
      return asanaTaskPath(normalizedId, name);
    case 'project':
      return asanaProjectPath(normalizedId, name);
    case 'section':
      return asanaSectionPath(normalizedId, name);
    case 'workspace':
      return asanaWorkspacePath(normalizedId, name);
  }
}

export function extractAsanaIdFromPathSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const slugged = /--([^/]+)$/u.exec(decoded);
  if (slugged?.[1]) {
    return slugged[1];
  }
  return decoded;
}
