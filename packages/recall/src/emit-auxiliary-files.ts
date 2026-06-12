import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  runEmitBatch,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitPlan,
} from '@relayfile/adapter-core';

import {
  computeRecallPath,
  recallByIdAliasPath,
  recallRecordingByDayIndexPath,
  recallRecordingsIndexPath,
} from './path-mapper.js';
import { RECALL_PROVIDER, type RecallRecording } from './types.js';

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export type RecallRecordingEmitRecord = RecallRecording | { id: string; _deleted: true };

export interface EmitRecallAuxiliaryFilesInput {
  workspaceId: string;
  recordings?: readonly RecallRecordingEmitRecord[];
  connectionId?: string;
}

interface RecallRecordingIndexRow {
  id: string;
  title: string;
  updated?: string;
  day?: string;
  status?: string;
  canonicalPath: string;
}

interface RecallFacetRow {
  id: string;
  title: string;
  canonicalPath: string;
  updated?: string;
}

export async function emitRecallAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitRecallAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const recordings = input.recordings ?? [];
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await writeRootIndex(client, input.workspaceId, aggregate);

  if (recordings.length === 0) {
    return aggregate;
  }

  const result = await emitRecordings(client, input.workspaceId, recordings, input.connectionId);
  aggregate.written += result.written;
  aggregate.deleted += result.deleted;
  aggregate.errors.push(...result.errors);
  return aggregate;
}

async function emitRecordings(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly RecallRecordingEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const mainIndex = createIndexReconciler<RecallRecordingIndexRow>(
    client,
    workspaceId,
    recallRecordingsIndexPath(),
  );
  const facetReconcilers = new Map<string, IndexFileReconciler<RecallFacetRow>>();

  const fanout = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planRecordingDelete(record.id, mainIndex);
    }
    return planRecordingWrite(record, mainIndex, facetReconcilers, client, workspaceId, connectionId);
  });

  const mainFlush = await mainIndex.flush();
  fanout.written += mainFlush.written;
  fanout.errors.push(...mainFlush.errors);

  for (const reconciler of facetReconcilers.values()) {
    const flush = await reconciler.flush();
    fanout.written += flush.written;
    fanout.errors.push(...flush.errors);
  }

  return fanout;
}

function planRecordingDelete(
  idValue: string,
  mainIndex: IndexFileReconciler<RecallRecordingIndexRow>,
): EmitPlan {
  const id = readNonEmptyString(idValue);
  if (!id) return {};

  mainIndex.remove(id);
  return {
    deletes: [
      { path: recallByIdAliasPath(id) },
    ],
  };
}

function planRecordingWrite(
  recording: RecallRecording,
  mainIndex: IndexFileReconciler<RecallRecordingIndexRow>,
  facetReconcilers: Map<string, IndexFileReconciler<RecallFacetRow>>,
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  connectionId: string | undefined,
): EmitPlan {
  const id = readNonEmptyString(recording.id);
  if (!id) return {};

  const row = recordingIndexRow(recording);
  mainIndex.upsert(row);

  if (row.day) {
    getFacetReconciler(
      facetReconcilers,
      client,
      workspaceId,
      recallRecordingByDayIndexPath(row.day),
    ).upsert(toFacetRow(row));
  }

  const content = JSON.stringify(
    {
      provider: RECALL_PROVIDER,
      objectType: 'recording',
      objectId: id,
      canonicalPath: computeRecallPath('recording', id),
      payload: recording,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );

  return {
    writes: [
      {
        path: recallByIdAliasPath(id),
        content,
        contentType: JSON_CONTENT_TYPE,
      },
    ],
  };
}

async function writeRootIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  try {
    await client.writeFile({
      workspaceId,
      path: '/recall/_index.json',
      content: JSON.stringify(
        [
          {
            id: 'recordings',
            title: 'Recordings',
            path: '/recall/recordings',
          },
        ],
        null,
        2,
      ),
      contentType: JSON_CONTENT_TYPE,
    });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({ path: '/recall/_index.json', error: stringifyError(error) });
  }
}

function recordingIndexRow(recording: RecallRecording): RecallRecordingIndexRow {
  const id = readNonEmptyString(recording.id) ?? '';
  const updated = readNonEmptyString(recording.updated_at)
    ?? readNonEmptyString(recording.completed_at)
    ?? readNonEmptyString(recording.created_at);
  const row: RecallRecordingIndexRow = {
    id,
    title: readNonEmptyString(recording.title) ?? id,
    canonicalPath: computeRecallPath('recording', id),
  };
  if (updated) {
    row.updated = updated;
    row.day = updated.slice(0, 10);
  }
  const status = readNonEmptyString(recording.status);
  if (status) row.status = status;
  return row;
}

function toFacetRow(row: RecallRecordingIndexRow): RecallFacetRow {
  const facet: RecallFacetRow = {
    id: row.id,
    title: row.title,
    canonicalPath: row.canonicalPath,
  };
  if (row.updated) facet.updated = row.updated;
  return facet;
}

function createIndexReconciler<T extends { id: string; updated?: string }>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): IndexFileReconciler<T> {
  return new IndexFileReconciler<T>({
    client,
    workspaceId,
    path,
    builder: (rows: readonly T[]) => ({
      path,
      content: `${JSON.stringify([...rows].sort(compareIndexRows), null, 2)}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });
}

function getFacetReconciler(
  reconcilers: Map<string, IndexFileReconciler<RecallFacetRow>>,
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): IndexFileReconciler<RecallFacetRow> {
  const existing = reconcilers.get(path);
  if (existing) return existing;
  const created = createIndexReconciler<RecallFacetRow>(client, workspaceId, path);
  reconcilers.set(path, created);
  return created;
}

function compareIndexRows(a: { id: string; updated?: string }, b: { id: string; updated?: string }): number {
  const byUpdated = (b.updated ?? '').localeCompare(a.updated ?? '');
  if (byUpdated !== 0) return byUpdated;
  return a.id.localeCompare(b.id);
}

function isDeleteRecord(record: RecallRecordingEmitRecord): record is { id: string; _deleted: true } {
  return '_deleted' in record && record._deleted === true;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
