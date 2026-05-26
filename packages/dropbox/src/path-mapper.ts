import { aliasCollisionSuffix, slugifyAlias } from '@relayfile/adapter-core';

export const DROPBOX_PATH_ROOT = '/dropbox';

export const RELAYFILE_ROOT = DROPBOX_PATH_ROOT;
export const OBJECT_RESOURCE_PATH = '/dropbox/files';
// Deprecated compatibility constant retained for external callers that still
// rely on account-scoped object roots.
export const LEGACY_OBJECT_RESOURCE_PATH = '/dropbox/{accountId}/files';
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

function legacyPathLikeInput(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.includes('/') && !trimmed.toLowerCase().startsWith('id:');
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
  // Backward-compat: legacy callers passed a path-like id and expected nested
  // path output (`/dropbox/files/<path>.json`). Keep that behavior when no
  // title hint is provided.
  if (!title && legacyPathLikeInput(id)) {
    return `${DROPBOX_PATH_ROOT}/files/${encodedPathOrId(id)}.json`;
  }
  const normalizedId = assertNonEmpty(id, 'object id');
  const leaf = stableLeafName(normalizedId, title);
  return `${DROPBOX_PATH_ROOT}/files/${encodePathSegment(leaf)}.json`;
}

export function dropboxFolderPath(id: string, title?: string | null): string {
  // Backward-compat: preserve legacy nested path output for path-like ids.
  if (!title && legacyPathLikeInput(id)) {
    return `${DROPBOX_PATH_ROOT}/folders/${encodedPathOrId(id)}.json`;
  }
  const normalizedId = assertNonEmpty(id, 'object id');
  const leaf = stableLeafName(normalizedId, title);
  return `${DROPBOX_PATH_ROOT}/folders/${encodePathSegment(leaf)}.json`;
}

export function dropboxSharedFolderPath(sharedFolderId: string, name?: string | null): string {
  const normalizedId = assertNonEmpty(sharedFolderId, 'object id');
  const leaf = stableLeafName(normalizedId, name);
  return `${DROPBOX_PATH_ROOT}/shared-folders/${encodePathSegment(leaf)}.json`;
}

export function dropboxSharedLinkPath(sharedLinkId: string, name?: string | null): string {
  const normalizedId = assertNonEmpty(sharedLinkId, 'object id');
  const leaf = stableLeafName(normalizedId, name);
  return `${DROPBOX_PATH_ROOT}/shared-links/${encodePathSegment(leaf)}.json`;
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
  const normalizedType = normalizeDropboxObjectType(objectType);
  const id = assertNonEmpty(objectId, 'object id');
  const path = options?.path_lower ?? options?.path ?? null;
  const name = options?.name ?? (path ? basename(path) : null);

  if (normalizedType === 'file') {
    return dropboxFilePath(id, name);
  }
  if (normalizedType === 'folder') {
    return dropboxFolderPath(id, name);
  }
  if (normalizedType === 'shared-folder') {
    return dropboxSharedFolderPath(id, name);
  }
  if (normalizedType === 'shared-link') {
    return dropboxSharedLinkPath(id, name);
  }

  throw new Error(`Unsupported Dropbox object type: ${objectType}`);
}

export function toObjectRelayfilePath(input: ObjectPathInput): string {
  const legacyPath = toLegacyAccountScopedPath(input);
  if (legacyPath) {
    return legacyPath;
  }

  const objectId = input.id !== undefined ? String(input.id) : null;
  const objectType = normalizeDropboxObjectType(input.objectType ?? input.model ?? 'file');
  const path = input.path ?? null;
  const name = input.name ?? (path ? basename(path) : null);

  if (!objectId) {
    throw new Error('Dropbox object path requires an id');
  }

  if (objectType === 'folder') {
    return computeDropboxPath(objectType, objectId, { path, name });
  }
  if (objectType === 'shared-folder' || objectType === 'shared-link') {
    return computeDropboxPath(objectType, objectId, { path, name });
  }
  return computeDropboxPath(objectType, objectId, { path, name });
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
    const last = segments.at(-1) ?? null;
    const resource = segments[1];
    const isAliasPath = segments[2] === 'by-id' || segments[2] === 'by-path';
    const id =
      last && segments.length >= 3 && resource !== '_index' && !isAliasPath
        ? decodeObjectIdFromLeaf(last, resource)
        : last;
    return { resource: 'object', id, segments };
  }

  return { resource: 'unknown', id: null, segments };
}

function normalizeDropboxObjectType(objectType: string): DropboxPathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[_\s]+/gu, '-');
  if (normalized === 'file' || normalized === 'dropboxfile') {
    return 'file';
  }
  if (normalized === 'folder' || normalized === 'dropboxfolder') {
    return 'folder';
  }
  if (
    normalized === 'shared-folder' ||
    normalized === 'sharedfolder' ||
    normalized === 'dropboxsharedfolder' ||
    (normalized.includes('shared') && normalized.includes('folder'))
  ) {
    return 'shared-folder';
  }
  if (
    normalized === 'shared-link' ||
    normalized === 'sharedlink' ||
    normalized === 'dropboxsharedlink' ||
    (normalized.includes('shared') && normalized.includes('link'))
  ) {
    return 'shared-link';
  }
  throw new Error(`Unsupported Dropbox object type: ${objectType}`);
}

function decodeObjectIdFromLeaf(leaf: string, resource?: string): string {
  if (
    resource !== 'files' &&
    resource !== 'folders' &&
    resource !== 'shared-folders' &&
    resource !== 'shared-links'
  ) {
    return leaf;
  }
  const separatorIndex = leaf.indexOf('__');
  if (separatorIndex === -1) {
    return leaf;
  }
  const candidate = leaf.slice(separatorIndex + 2);
  return candidate || leaf;
}

function toLegacyAccountScopedPath(input: ObjectPathInput): string | null {
  const hasExplicitType =
    typeof input.objectType === 'string' || typeof input.model === 'string';
  if (hasExplicitType) {
    return null;
  }
  const accountScope = input.accountId ?? input.account;
  if (accountScope === undefined || accountScope === null) {
    return null;
  }
  const pathLike = input.path ?? input.key ?? input.name;
  if (!pathLike || pathLike.trim().length === 0) {
    return null;
  }
  const stripped = pathLike.replace(/^\/+/u, '');
  return `${DROPBOX_PATH_ROOT}/${encodePathSegment(accountScope)}/${encodedPathOrId(stripped)}.json`;
}
