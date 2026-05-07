export const CLICKUP_PATH_ROOT = '/clickup';

export const CLICKUP_OBJECT_TYPES = [
  'folder',
  'list',
  'space',
  'task',
] as const;

export type ClickUpPathObjectType = (typeof CLICKUP_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, ClickUpPathObjectType>> = {
  clickupfolder: 'folder',
  clickuplist: 'list',
  clickupspace: 'space',
  clickuptask: 'task',
  folder: 'folder',
  folders: 'folder',
  list: 'list',
  lists: 'list',
  space: 'space',
  spaces: 'space',
  task: 'task',
  tasks: 'task',
};

const NANGO_MODEL_MAP: Readonly<Record<string, ClickUpPathObjectType>> = {
  ClickUpFolder: 'folder',
  ClickUpList: 'list',
  ClickUpSpace: 'space',
  ClickUpTask: 'task',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`ClickUp ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeClickUpPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

function titleSegmentWithId(_title: string | undefined, id: string): string {
  return encodeClickUpPathSegment(id);
}

export function normalizeClickUpObjectType(objectType: string): ClickUpPathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[^a-z]/g, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported ClickUp object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeClickUpObjectType(objectType: string): ClickUpPathObjectType | undefined {
  try {
    return normalizeClickUpObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoClickUpModel(model: string): ClickUpPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeClickUpObjectType(model);
}

export function clickUpTaskPath(taskId: string, title?: string): string {
  return `${CLICKUP_PATH_ROOT}/tasks/${titleSegmentWithId(title, assertNonEmptySegment(taskId, 'task id'))}.json`;
}

export function clickUpListPath(listId: string, name?: string): string {
  return `${CLICKUP_PATH_ROOT}/lists/${titleSegmentWithId(name, assertNonEmptySegment(listId, 'list id'))}.json`;
}

export function clickUpFolderPath(folderId: string, name?: string): string {
  return `${CLICKUP_PATH_ROOT}/folders/${titleSegmentWithId(name, assertNonEmptySegment(folderId, 'folder id'))}.json`;
}

export function clickUpSpacePath(spaceId: string, name?: string): string {
  return `${CLICKUP_PATH_ROOT}/spaces/${titleSegmentWithId(name, assertNonEmptySegment(spaceId, 'space id'))}.json`;
}

export function computeClickUpPath(objectType: string, objectId: string, title?: string): string {
  const normalizedType = normalizeClickUpObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'folder':
      return clickUpFolderPath(normalizedId, title);
    case 'list':
      return clickUpListPath(normalizedId, title);
    case 'space':
      return clickUpSpacePath(normalizedId, title);
    case 'task':
      return clickUpTaskPath(normalizedId, title);
  }
}

export function extractClickUpIdFromPathSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const slugged = /--(.+)$/u.exec(decoded);
  return slugged?.[1] ? decodeURIComponent(slugged[1]) : decoded;
}
