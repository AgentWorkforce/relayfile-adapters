import { aliasCollisionSuffix, slugifyAlias } from '@relayfile/adapter-core';

export const DROPBOX_PATH_ROOT = '/dropbox';

export const RELAYFILE_ROOT = DROPBOX_PATH_ROOT;
export const OBJECT_RESOURCE_PATH = '/dropbox/files';
export const LIFECYCLE_RESOURCE_PATH = '/dropbox/cursors';

export type DropboxPathObjectType = 'file' | 'folder' | 'shared-folder' | 'shared-link';

export interface ObjectPathInput {
  objectType?: string;
  model?: string;
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

function basename(pathOrId: string): string {
  const trimmed = assertNonEmpty(pathOrId, 'path');
  const parts = trimmed.split('/').map((part) => part.trim()).filter((part) => part.length > 0);
  return parts.at(-1) ?? trimmed;
}

function stableLeafName(
  id: string,
  title?: string | null,
  opts?: { colliding?: boolean },
): string {
  const slugCandidate = title ? slugifyAlias(title) : '';
  const fallback = slugifyAlias(id);
  const baseSlug =
    slugCandidate && slugCandidate !== 'untitled'
      ? slugCandidate
      : (fallback && fallback !== 'untitled' ? fallback : 'item');
  const suffix = opts?.colliding ? `-${aliasCollisionSuffix(id)}` : '';
  return `${baseSlug}${suffix}__${id}`;
}

export function dropboxFilePath(id: string, title?: string | null): string {
  const normalizedId = assertNonEmpty(id, 'object id');
  const leaf = stableLeafName(normalizedId, title);
  return `${DROPBOX_PATH_ROOT}/files/${encodePathSegment(leaf)}.json`;
}

export function dropboxFolderPath(id: string, title?: string | null): string {
  const normalizedId = assertNonEmpty(id, 'object id');
  const leaf = stableLeafName(normalizedId, title);
  return `${DROPBOX_PATH_ROOT}/folders/${encodePathSegment(leaf)}.json`;
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

export function dropboxRootIndexPath(): string {
  return `${DROPBOX_PATH_ROOT}/_index.json`;
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
  options?: { path?: string | null; path_lower?: string | null; name?: string | null },
): string {
  const normalizedType = objectType.trim().toLowerCase();
  const id = assertNonEmpty(objectId, 'object id');
  const path = options?.path_lower ?? options?.path ?? null;
  const name = options?.name ?? (path ? basename(path) : null);

  if (normalizedType === 'file' || normalizedType === 'dropboxfile') {
    return dropboxFilePath(id, name);
  }
  if (normalizedType === 'folder' || normalizedType === 'dropboxfolder') {
    return dropboxFolderPath(id, name);
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
  const objectId = input.id !== undefined ? String(input.id) : null;
  const objectType = input.objectType ?? input.model ?? 'file';
  const path = input.path ?? null;
  const name = input.name ?? (path ? basename(path) : null);

  if (!objectId) {
    throw new Error('Dropbox object path requires an id');
  }

  if (objectType.toLowerCase().includes('folder') && !objectType.toLowerCase().includes('shared')) {
    return computeDropboxPath('folder', objectId, { path, name });
  }
  if (objectType.toLowerCase().includes('shared-folder')) {
    return computeDropboxPath('shared-folder', objectId);
  }
  if (objectType.toLowerCase().includes('shared-link')) {
    return computeDropboxPath('shared-link', objectId);
  }
  return computeDropboxPath('file', objectId, { path, name });
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
  const rawSegments = normalized.split('/').filter(Boolean);
  const segments = rawSegments.map((segment, index) =>
    decodeURIComponent(
      index === rawSegments.length - 1 ? segment.replace(/\.json$/u, '') : segment,
    ),
  );

  const lifecycleSegments = LIFECYCLE_RESOURCE_PATH.split('/').filter(Boolean);
  if (
    segments.length === lifecycleSegments.length + 1 &&
    lifecycleSegments.every((segment, index) => segment === segments[index])
  ) {
    return { resource: 'lifecycle', id: segments.at(-1) ?? null, segments };
  }

  if (segments[0] === DROPBOX_PATH_ROOT.slice(1)) {
    return { resource: 'object', id: segments.at(-1) ?? null, segments };
  }

  return { resource: 'unknown', id: null, segments };
}
