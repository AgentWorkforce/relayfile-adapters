import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from '@relayfile/adapter-core';

import {
  computeFathomPath,
  fathomByIdAliasPath,
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

  await emitResource(
    client,
    input.workspaceId,
    aggregate,
    input.meetings ?? [],
    {
      resource: 'meetings',
      indexPath: fathomMeetingsIndexPath(),
      canonicalPath: (record) => computeFathomPath('meeting', readId(record.id)),
      title: (record) => readString(record.meeting_title) ?? readString(record.title) ?? `meeting ${record.id}`,
      updated: (record) => readString(record.created_at) ?? new Date().toISOString(),
      objectType: 'meeting',
      connectionId: input.connectionId,
    },
  );

  await emitResource(
    client,
    input.workspaceId,
    aggregate,
    input.recordingSummaries ?? [],
    {
      resource: 'recording-summaries',
      indexPath: fathomRecordingSummariesIndexPath(),
      canonicalPath: (record) => fathomRecordingSummaryPath(readId(record.id)),
      title: (record) => `summary ${record.id}`,
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
      canonicalPath: (record) => fathomRecordingTranscriptPath(readId(record.id)),
      title: (record) => `transcript ${record.id}`,
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

interface EmitResourceOptions<TRecord extends { id: string }> {
  resource: 'meetings' | 'recording-summaries' | 'recording-transcripts' | 'teams' | 'team-members';
  indexPath: string;
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
    const id = readId(record.id);
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

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
