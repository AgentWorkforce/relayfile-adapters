import { FATHOM_PATH_ROOT } from './types.js';

export type FathomPathObjectType =
  | 'meeting'
  | 'recording-summary'
  | 'recording-transcript'
  | 'team'
  | 'team-member';

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Fathom ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeFathomPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function fathomMeetingPath(id: string): string {
  return `${FATHOM_PATH_ROOT}/meetings/${encodeFathomPathSegment(id)}.json`;
}

export function fathomRecordingSummaryPath(recordingId: string): string {
  return `${FATHOM_PATH_ROOT}/recordings/${encodeFathomPathSegment(recordingId)}/summary.json`;
}

export function fathomRecordingTranscriptPath(recordingId: string): string {
  return `${FATHOM_PATH_ROOT}/recordings/${encodeFathomPathSegment(recordingId)}/transcript.json`;
}

export function fathomTeamPath(id: string): string {
  return `${FATHOM_PATH_ROOT}/teams/${encodeFathomPathSegment(id)}.json`;
}

export function fathomTeamMemberPath(id: string): string {
  return `${FATHOM_PATH_ROOT}/team-members/${encodeFathomPathSegment(id)}.json`;
}

export function fathomMeetingsIndexPath(): string {
  return `${FATHOM_PATH_ROOT}/meetings/_index.json`;
}

export function fathomRecordingSummariesIndexPath(): string {
  return `${FATHOM_PATH_ROOT}/recording-summaries/_index.json`;
}

export function fathomRecordingTranscriptsIndexPath(): string {
  return `${FATHOM_PATH_ROOT}/recording-transcripts/_index.json`;
}

export function fathomTeamsIndexPath(): string {
  return `${FATHOM_PATH_ROOT}/teams/_index.json`;
}

export function fathomTeamMembersIndexPath(): string {
  return `${FATHOM_PATH_ROOT}/team-members/_index.json`;
}

export function fathomByIdAliasPath(resource: 'meetings' | 'recording-summaries' | 'recording-transcripts' | 'teams' | 'team-members', id: string): string {
  return `${FATHOM_PATH_ROOT}/${resource}/by-id/${encodeFathomPathSegment(id)}.json`;
}

export function computeFathomPath(objectType: string, objectId: string): string {
  const normalizedType = objectType.trim().toLowerCase();
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  if (normalizedType === 'meeting' || normalizedType === 'fathommeeting') {
    return fathomMeetingPath(normalizedId);
  }
  if (
    normalizedType === 'recordingsummary' ||
    normalizedType === 'recording-summary' ||
    normalizedType === 'fathomrecordingsummary'
  ) {
    return fathomRecordingSummaryPath(normalizedId);
  }
  if (
    normalizedType === 'recordingtranscript' ||
    normalizedType === 'recording-transcript' ||
    normalizedType === 'fathomrecordingtranscript'
  ) {
    return fathomRecordingTranscriptPath(normalizedId);
  }
  if (normalizedType === 'team' || normalizedType === 'fathomteam') {
    return fathomTeamPath(normalizedId);
  }
  if (normalizedType === 'teammember' || normalizedType === 'team-member' || normalizedType === 'fathomteammember') {
    return fathomTeamMemberPath(normalizedId);
  }

  throw new Error(`Unsupported Fathom object type: ${objectType}`);
}
