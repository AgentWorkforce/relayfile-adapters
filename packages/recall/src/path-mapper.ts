import { RECALL_PATH_ROOT } from './types.js';

export type RecallPathObjectType = 'recording' | 'transcript';

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Recall ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeRecallPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function recallRecordingPath(recordingId: string): string {
  return `${RECALL_PATH_ROOT}/recordings/${encodeRecallPathSegment(recordingId)}.json`;
}

export function recallRecordingsIndexPath(): string {
  return `${RECALL_PATH_ROOT}/recordings/_index.json`;
}

export function recallByIdAliasPath(id: string): string {
  return `${RECALL_PATH_ROOT}/recordings/by-id/${encodeRecallPathSegment(id)}.json`;
}

export function recallRecordingByDayIndexPath(day: string): string {
  return `${RECALL_PATH_ROOT}/recordings/by-day/${encodeRecallPathSegment(day)}/_index.json`;
}

export function computeRecallPath(objectType: string, objectId: string): string {
  const normalizedType = objectType.trim().toLowerCase();
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  if (
    normalizedType === 'recording'
    || normalizedType === 'recallrecording'
    || normalizedType === 'transcript'
    || normalizedType === 'recalltranscript'
  ) {
    return recallRecordingPath(normalizedId);
  }

  throw new Error(`Unsupported Recall object type: ${objectType}`);
}

export function parseRecallRecordingPath(path: string): { recordingId: string } | null {
  const match = /^\/?recall\/recordings\/([^/]+)\.json$/u.exec(path);
  if (!match?.[1]) return null;
  return { recordingId: decodeURIComponent(match[1]) };
}
