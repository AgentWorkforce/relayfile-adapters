import { GRANOLA_PATH_ROOT } from './types.js';

export type GranolaPathObjectType = 'folder' | 'note';

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Granola ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeGranolaPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function granolaNotePath(noteId: string): string {
  return `${GRANOLA_PATH_ROOT}/notes/${encodeGranolaPathSegment(noteId)}.json`;
}

export function granolaFolderPath(folderId: string): string {
  return `${GRANOLA_PATH_ROOT}/folders/${encodeGranolaPathSegment(folderId)}.json`;
}

export function granolaNotesIndexPath(): string {
  return `${GRANOLA_PATH_ROOT}/notes/_index.json`;
}

export function granolaFoldersIndexPath(): string {
  return `${GRANOLA_PATH_ROOT}/folders/_index.json`;
}

export function granolaByIdAliasPath(resource: 'notes' | 'folders', id: string): string {
  return `${GRANOLA_PATH_ROOT}/${resource}/by-id/${encodeGranolaPathSegment(id)}.json`;
}

export function granolaNoteByDayIndexPath(day: string): string {
  return `${GRANOLA_PATH_ROOT}/notes/by-day/${encodeGranolaPathSegment(day)}/_index.json`;
}

export function granolaNoteByFolderIndexPath(folderId: string): string {
  return `${GRANOLA_PATH_ROOT}/notes/by-folder/${encodeGranolaPathSegment(folderId)}/_index.json`;
}

export function granolaFolderByParentIndexPath(parentFolderId: string): string {
  return `${GRANOLA_PATH_ROOT}/folders/by-parent/${encodeGranolaPathSegment(parentFolderId)}/_index.json`;
}

export function computeGranolaPath(objectType: string, objectId: string): string {
  const normalizedType = objectType.trim().toLowerCase();
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  if (normalizedType === 'note' || normalizedType === 'granolanote') {
    return granolaNotePath(normalizedId);
  }
  if (normalizedType === 'folder' || normalizedType === 'granolafolder') {
    return granolaFolderPath(normalizedId);
  }

  throw new Error(`Unsupported Granola object type: ${objectType}`);
}
