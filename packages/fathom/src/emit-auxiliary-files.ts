import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from '@relayfile/adapter-core';

import {
  computeFathomPath,
  fathomByIdAliasPath,
  fathomMeetingByDayIndexPath,
  fathomMeetingByRecordedByIndexPath,
  fathomMeetingByTeamIndexPath,
  fathomMeetingsIndexPath,
  fathomRecordingSummariesIndexPath,
  fathomRecordingSummaryPath,
  fathomRecordingTranscriptPath,
  fathomRecordingTranscriptsIndexPath,
  fathomTeamMembersIndexPath,
  fathomTeamsIndexPath,
} from './path-mapper.js';
import {
  FATHOM_PROVIDER,
  type FathomMeetingRecord,
  type FathomRecordingSummaryRecord,
  type FathomRecordingTranscriptRecord,
  type FathomTeamMemberRecord,
  type FathomTeamRecord,
} from './types.js';

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

type DeleteRecord = { id: string; _deleted: true };

type EmitRow = {
  id: string;
  title: string;
  updated: string;
  canonicalPath: string;
  day?: string;
  team?: string;
  recordedBy?: string;
  tags?: string[];
};

export interface EmitFathomAuxiliaryFilesInput {
  workspaceId: string;
  meetings?: readonly (FathomMeetingRecord | DeleteRecord)[];
  recordingSummaries?: readonly (FathomRecordingSummaryRecord | DeleteRecord)[];
  recordingTranscripts?: readonly (FathomRecordingTranscriptRecord | DeleteRecord)[];
  teams?: readonly (FathomTeamRecord | DeleteRecord)[];
  teamMembers?: readonly (FathomTeamMemberRecord | DeleteRecord)[];
  connectionId?: string;
}

export async function emitFathomAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitFathomAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await writeRootIndex(client, input.workspaceId, aggregate);

  await emitMeetingsResource(client, input.workspaceId, aggregate, input.meetings ?? [], input.connectionId);

  await emitResource(
    client,
    input.workspaceId,
    aggregate,
    input.recordingSummaries ?? [],
    {
      resource: 'recording-summaries',
      indexPath: fathomRecordingSummariesIndexPath(),
      idForResource: (record) => readRecordingScopedId(record),
      canonicalPath: (record) => fathomRecordingSummaryPath(readRecordingScopedId(record)),
      title: (record) => `summary ${readRecordingScopedId(record)}`,
      updated: (record) => readString(record.created_at) ?? new Date().toISOString(),
      objectType: 'recording-summary',
      connectionId: input.connectionId,
    },
  );

  await emitResource(
    client,
    input.workspaceId,
    aggregate,
    input.recordingTranscripts ?? [],
    {
      resource: 'recording-transcripts',
      indexPath: fathomRecordingTranscriptsIndexPath(),
      idForResource: (record) => readRecordingScopedId(record),
      canonicalPath: (record) => fathomRecordingTranscriptPath(readRecordingScopedId(record)),
      title: (record) => `transcript ${readRecordingScopedId(record)}`,
      updated: (record) => readString(record.created_at) ?? new Date().toISOString(),
      objectType: 'recording-transcript',
      connectionId: input.connectionId,
    },
  );

  await emitResource(
    client,
    input.workspaceId,
    aggregate,
    input.teams ?? [],
    {
      resource: 'teams',
      indexPath: fathomTeamsIndexPath(),
      canonicalPath: (record) => computeFathomPath('team', readId(record.id)),
      title: (record) => readString(record.name) ?? `team ${record.id}`,
      updated: (record) => readString(record.created_at) ?? new Date().toISOString(),
      objectType: 'team',
      connectionId: input.connectionId,
    },
  );

  await emitResource(
    client,
    input.workspaceId,
    aggregate,
    input.teamMembers ?? [],
    {
      resource: 'team-members',
      indexPath: fathomTeamMembersIndexPath(),
      canonicalPath: (record) => computeFathomPath('team-member', readId(record.id)),
      title: (record) => readString(record.email) ?? readString(record.name) ?? `member ${record.id}`,
      updated: (record) => readString(record.created_at) ?? new Date().toISOString(),
      objectType: 'team-member',
      connectionId: input.connectionId,
    },
  );

  return aggregate;
}

async function emitMeetingsResource(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
  records: readonly (FathomMeetingRecord | DeleteRecord)[],
  connectionId?: string,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const indexRows = await readJsonArray<EmitRow>(client, workspaceId, fathomMeetingsIndexPath());
  const rowMap = new Map(indexRows.map((row) => [row.id, row]));
  const previousGroupPaths = collectMeetingGroupPaths(indexRows);

  for (const record of records) {
    const sourceId = readId(record.id);
    const id = isDeleteRecord(record) ? sourceId : readRecordingScopedId(record);
    const aliasPath = fathomByIdAliasPath('meetings', id);

    if (isDeleteRecord(record)) {
      rowMap.delete(id);
      await safeDelete(client, workspaceId, aliasPath, aggregate);
      continue;
    }

    const canonicalPath = computeFathomPath('meeting', id);
    const updated = readString(record.created_at) ?? new Date().toISOString();
    const day = isoDay(updated);
    const recordedBy = nestedString(record, 'recorded_by', 'email');
    const team = nestedString(record, 'recorded_by', 'team');
    const tags = buildMeetingTags(day, recordedBy, team);
    const row: EmitRow = {
      id,
      title: readString(record.meeting_title) ?? readString(record.title) ?? `meeting ${id}`,
      updated,
      canonicalPath,
      ...(day ? { day } : {}),
      ...(recordedBy ? { recordedBy } : {}),
      ...(team ? { team } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    };
    rowMap.set(id, row);
    if (sourceId !== id) {
      rowMap.delete(sourceId);
      await safeDelete(client, workspaceId, fathomByIdAliasPath('meetings', sourceId), aggregate);
    }

    const aliasPayload = JSON.stringify(
      {
        provider: FATHOM_PROVIDER,
        objectType: 'meeting',
        objectId: id,
        canonicalPath,
        payload: record,
        ...(connectionId ? { connectionId } : {}),
      },
      null,
      2,
    );

    await safeWrite(client, workspaceId, aliasPath, aliasPayload, aggregate);
  }

  const nextRows = [...rowMap.values()].sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
  await safeWrite(client, workspaceId, fathomMeetingsIndexPath(), `${JSON.stringify(nextRows, null, 2)}\n`, aggregate);

  const nextGroupPaths = collectMeetingGroupPaths(nextRows);
  await writeMeetingGroupedIndexes(client, workspaceId, aggregate, nextRows);
  for (const path of previousGroupPaths) {
    if (!nextGroupPaths.has(path)) {
      await safeDelete(client, workspaceId, path, aggregate);
    }
  }
}

interface EmitResourceOptions<TRecord extends { id: string }> {
  resource: 'meetings' | 'recording-summaries' | 'recording-transcripts' | 'teams' | 'team-members';
  indexPath: string;
  idForResource?: (record: TRecord) => string;
  canonicalPath: (record: TRecord) => string;
  title: (record: TRecord) => string;
  updated: (record: TRecord) => string;
  objectType: string;
  connectionId?: string | undefined;
}

async function emitResource<TRecord extends { id: string }>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
  records: readonly (TRecord | DeleteRecord)[],
  options: EmitResourceOptions<TRecord>,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const indexRows = await readJsonArray<EmitRow>(client, workspaceId, options.indexPath);
  const rowMap = new Map(indexRows.map((row) => [row.id, row]));

  for (const record of records) {
    const sourceId = readId(record.id);
    const id = isDeleteRecord(record) ? sourceId : (options.idForResource?.(record as TRecord) ?? sourceId);
    const aliasPath = fathomByIdAliasPath(options.resource, id);

    if (isDeleteRecord(record)) {
      rowMap.delete(id);
      await safeDelete(client, workspaceId, aliasPath, aggregate);
      continue;
    }

    const canonicalPath = options.canonicalPath(record as TRecord);
    const row: EmitRow = {
      id,
      title: options.title(record as TRecord),
      updated: options.updated(record as TRecord),
      canonicalPath,
    };
    rowMap.set(id, row);
    if (sourceId !== id) {
      rowMap.delete(sourceId);
      await safeDelete(client, workspaceId, fathomByIdAliasPath(options.resource, sourceId), aggregate);
    }

    const aliasPayload = JSON.stringify(
      {
        provider: FATHOM_PROVIDER,
        objectType: options.objectType,
        objectId: id,
        canonicalPath,
        payload: record,
        ...(options.connectionId ? { connectionId: options.connectionId } : {}),
      },
      null,
      2,
    );

    await safeWrite(client, workspaceId, aliasPath, aliasPayload, aggregate);
  }

  const nextRows = [...rowMap.values()].sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
  await safeWrite(client, workspaceId, options.indexPath, `${JSON.stringify(nextRows, null, 2)}\n`, aggregate);
}

async function writeRootIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const rows = [
    { id: 'meetings', title: 'Meetings', canonicalPath: '/fathom/meetings/_index.json' },
    { id: 'recording-summaries', title: 'Recording Summaries', canonicalPath: '/fathom/recording-summaries/_index.json' },
    { id: 'recording-transcripts', title: 'Recording Transcripts', canonicalPath: '/fathom/recording-transcripts/_index.json' },
    { id: 'teams', title: 'Teams', canonicalPath: '/fathom/teams/_index.json' },
    { id: 'team-members', title: 'Team Members', canonicalPath: '/fathom/team-members/_index.json' },
  ];

  await safeWrite(client, workspaceId, '/fathom/_index.json', `${JSON.stringify(rows, null, 2)}\n`, aggregate);
}

function isDeleteRecord(record: unknown): record is DeleteRecord {
  return typeof record === 'object' && record !== null && (record as { _deleted?: unknown })._deleted === true;
}

function readId(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error('Fathom record id must be a non-empty string or finite number');
}

function readRecordingScopedId(record: { id: unknown; recording_id?: unknown }): string {
  if (record.recording_id !== undefined && record.recording_id !== null) {
    return readId(record.recording_id);
  }
  return readId(record.id);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function nestedString(
  value: Record<string, unknown>,
  first: string,
  second: string,
): string | undefined {
  const nested = value[first];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return undefined;
  }
  return readString((nested as Record<string, unknown>)[second]);
}

function isoDay(value: string | undefined): string | undefined {
  const parsed = readString(value);
  if (!parsed) {
    return undefined;
  }
  return parsed.length >= 10 ? parsed.slice(0, 10) : undefined;
}

function buildMeetingTags(day: string | undefined, recordedBy: string | undefined, team: string | undefined): string[] {
  const tags: string[] = [];
  if (day) {
    tags.push(`day:${day}`);
  }
  if (recordedBy) {
    tags.push(`recorded-by:${recordedBy}`);
  }
  if (team) {
    tags.push(`team:${team}`);
  }
  return tags;
}

function collectMeetingGroupPaths(rows: readonly EmitRow[]): Set<string> {
  const paths = new Set<string>();
  for (const row of rows) {
    if (row.day) {
      paths.add(fathomMeetingByDayIndexPath(row.day));
    }
    if (row.team) {
      paths.add(fathomMeetingByTeamIndexPath(row.team));
    }
    if (row.recordedBy) {
      paths.add(fathomMeetingByRecordedByIndexPath(row.recordedBy));
    }
  }
  return paths;
}

async function writeMeetingGroupedIndexes(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
  rows: readonly EmitRow[],
): Promise<void> {
  const byDay = new Map<string, EmitRow[]>();
  const byTeam = new Map<string, EmitRow[]>();
  const byRecordedBy = new Map<string, EmitRow[]>();

  for (const row of rows) {
    if (row.day) {
      pushGrouped(byDay, row.day, row);
    }
    if (row.team) {
      pushGrouped(byTeam, row.team, row);
    }
    if (row.recordedBy) {
      pushGrouped(byRecordedBy, row.recordedBy, row);
    }
  }

  for (const [day, groupedRows] of byDay) {
    await safeWrite(
      client,
      workspaceId,
      fathomMeetingByDayIndexPath(day),
      `${JSON.stringify(groupedRows, null, 2)}\n`,
      aggregate,
    );
  }
  for (const [team, groupedRows] of byTeam) {
    await safeWrite(
      client,
      workspaceId,
      fathomMeetingByTeamIndexPath(team),
      `${JSON.stringify(groupedRows, null, 2)}\n`,
      aggregate,
    );
  }
  for (const [recordedBy, groupedRows] of byRecordedBy) {
    await safeWrite(
      client,
      workspaceId,
      fathomMeetingByRecordedByIndexPath(recordedBy),
      `${JSON.stringify(groupedRows, null, 2)}\n`,
      aggregate,
    );
  }
}

function pushGrouped(map: Map<string, EmitRow[]>, key: string, row: EmitRow): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(row);
    return;
  }
  map.set(key, [row]);
}

async function readJsonArray<T>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): Promise<T[]> {
  if (!client.readFile) {
    return [];
  }

  try {
    const response = await client.readFile({ workspaceId, path });
    const text = response?.content;
    if (!text) {
      return [];
    }
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function safeWrite(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  content: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  try {
    await client.writeFile({
      workspaceId,
      path,
      content,
      contentType: JSON_CONTENT_TYPE,
    });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({ path, error: error instanceof Error ? error.message : String(error) });
  }
}

async function safeDelete(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  if (!client.deleteFile) {
    return;
  }

  try {
    await client.deleteFile({ workspaceId, path });
    aggregate.deleted += 1;
  } catch (error) {
    aggregate.errors.push({ path, error: error instanceof Error ? error.message : String(error) });
  }
}
