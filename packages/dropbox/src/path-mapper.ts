export const DROPBOX_PATH_ROOT = '/dropbox';

export const RELAYFILE_ROOT = DROPBOX_PATH_ROOT;
export const OBJECT_RESOURCE_PATH = '/dropbox/files';
export const LIFECYCLE_RESOURCE_PATH = '/dropbox/cursors';

export type DropboxPathObjectType = 'file' | 'folder' | 'shared-folder' | 'shared-link';

export interface ObjectPathInput {
  accountId?: string | number;
  account?: string;
  bucket?: string;
  container?: string;
  db?: string | number;
  schema?: string;
  table?: string;
  siteId?: string;
  driveId?: string;
  id?: string | number;
  key?: string;
  name?: string;
  path?: string;
  threadId?: string;
  primaryKey?: string | number;
}

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Dropbox ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodePathSegment(value: string | number): string {
  return encodeURIComponent(assertNonEmpty(String(value), 'path segment'));
}

function normalizePathSegments(value: string): string[] {
  return value
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => encodePathSegment(segment));
}

function encodedPathOrId(value: string): string {
  const trimmed = assertNonEmpty(value, 'path');
  if (trimmed.includes('/')) {
    return normalizePathSegments(trimmed).join('/');
  }
  return encodePathSegment(trimmed);
}

export function dropboxFilePath(pathOrId: string): string {
  return `${DROPBOX_PATH_ROOT}/files/${encodedPathOrId(pathOrId)}.json`;
}

export function dropboxFolderPath(pathOrId: string): string {
  return `${DROPBOX_PATH_ROOT}/folders/${encodedPathOrId(pathOrId)}.json`;
}

export function dropboxSharedFolderPath(sharedFolderId: string): string {
  return `${DROPBOX_PATH_ROOT}/shared-folders/${encodePathSegment(sharedFolderId)}.json`;
}

export function dropboxSharedLinkPath(sharedLinkId: string): string {
  return `${DROPBOX_PATH_ROOT}/shared-links/${encodePathSegment(sharedLinkId)}.json`;
}

export function dropboxFilesIndexPath(): string {
  return `${DROPBOX_PATH_ROOT}/files/_index.json`;
}

export function dropboxFoldersIndexPath(): string {
  return `${DROPBOX_PATH_ROOT}/folders/_index.json`;
}

export function dropboxSharedFoldersIndexPath(): string {
  return `${DROPBOX_PATH_ROOT}/shared-folders/_index.json`;
}

export function dropboxSharedLinksIndexPath(): string {
  return `${DROPBOX_PATH_ROOT}/shared-links/_index.json`;
}

export function dropboxByIdAliasPath(
  resource: 'files' | 'folders' | 'shared-folders' | 'shared-links',
  id: string,
): string {
  return `${DROPBOX_PATH_ROOT}/${resource}/by-id/${encodePathSegment(id)}.json`;
}

export function dropboxFileByPathAliasPath(pathLower: string): string {
  return `${DROPBOX_PATH_ROOT}/files/by-path/${encodedPathOrId(pathLower)}.json`;
}

export function dropboxFolderByPathAliasPath(pathLower: string): string {
  return `${DROPBOX_PATH_ROOT}/folders/by-path/${encodedPathOrId(pathLower)}.json`;
}

export function computeDropboxPath(
  objectType: string,
  objectId: string,
  options?: { path?: string | null; path_lower?: string | null },
): string {
  const normalizedType = objectType.trim().toLowerCase();
  const id = assertNonEmpty(objectId, 'object id');
  const path = options?.path_lower ?? options?.path ?? null;

  if (normalizedType === 'file' || normalizedType === 'dropboxfile') {
    return dropboxFilePath(path ?? id);
  }
  if (normalizedType === 'folder' || normalizedType === 'dropboxfolder') {
    return dropboxFolderPath(path ?? id);
  }
  if (
    normalizedType === 'shared-folder' ||
    normalizedType === 'sharedfolder' ||
    normalizedType === 'dropboxsharedfolder'
  ) {
    return dropboxSharedFolderPath(id);
  }
  if (
    normalizedType === 'shared-link' ||
    normalizedType === 'sharedlink' ||
    normalizedType === 'dropboxsharedlink'
  ) {
    return dropboxSharedLinkPath(id);
  }

  throw new Error(`Unsupported Dropbox object type: ${objectType}`);
}

export function toObjectRelayfilePath(input: ObjectPathInput): string {
  const raw = input.path ?? input.name ?? (input.id !== undefined ? String(input.id) : '');
  if (!raw) {
    throw new Error('Dropbox object path requires an id, name, or path');
  }
  return dropboxFilePath(raw);
}

export function toLifecycleRelayfilePath(id: string | number): string {
  return `${LIFECYCLE_RESOURCE_PATH}/${encodePathSegment(id)}.json`;
}

export function parseRelayfilePath(path: string): {
  resource: 'object' | 'lifecycle' | 'unknown';
  id: string | null;
  segments: string[];
} {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const segments = normalized
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment.replace(/\.json$/u, '')));

  const lifecycleSegments = LIFECYCLE_RESOURCE_PATH.split('/').filter(Boolean);
  if (lifecycleSegments.every((segment, index) => segment === segments[index])) {
    return { resource: 'lifecycle', id: segments.at(-1) ?? null, segments };
  }

  if (segments[0] === DROPBOX_PATH_ROOT.slice(1)) {
    return { resource: 'object', id: segments.at(-1) ?? null, segments };
  }

  return { resource: 'unknown', id: null, segments };
}
