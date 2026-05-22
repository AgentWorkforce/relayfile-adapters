import {
  IndexFileReconciler,
  PriorAliasReader,
  runEmitBatch,
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitPlan,
} from '@relayfile/adapter-core';

import {
  computeGranolaPath,
  granolaByIdAliasPath,
  granolaFolderByParentIndexPath,
  granolaFoldersIndexPath,
  granolaNoteByDayIndexPath,
  granolaNoteByFolderIndexPath,
  granolaNotesIndexPath,
} from './path-mapper.js';
import { GRANOLA_PROVIDER, type GranolaFolder, type GranolaNote } from './types.js';

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export type GranolaNoteEmitRecord = GranolaNote | { id: string; _deleted: true };
export type GranolaFolderEmitRecord = GranolaFolder | { id: string; _deleted: true };

export interface EmitGranolaAuxiliaryFilesInput {
  workspaceId: string;
  notes?: readonly GranolaNoteEmitRecord[];
  folders?: readonly GranolaFolderEmitRecord[];
  connectionId?: string;
}

interface GranolaNoteIndexRow {
  id: string;
  title: string;
  updated?: string;
  day?: string;
  folderIds?: readonly string[];
  canonicalPath: string;
}

interface GranolaFolderIndexRow {
  id: string;
  title: string;
  parentFolderId?: string;
  canonicalPath: string;
}

interface GranolaFacetRow {
  id: string;
  title: string;
  canonicalPath: string;
  updated?: string;
}

interface PriorNoteState {
  title?: string;
  updated?: string;
  day?: string;
  folderIds?: readonly string[];
}

interface PriorFolderState {
  title?: string;
  parentFolderId?: string;
}

export async function emitGranolaAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitGranolaAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const notes = input.notes ?? [];
  const folders = input.folders ?? [];
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await writeRootIndex(client, input.workspaceId, aggregate);

  if (notes.length === 0 && folders.length === 0) {
    return aggregate;
  }

  if (notes.length > 0) {
    const result = await emitNotes(client, input.workspaceId, notes, input.connectionId);
    aggregate.written += result.written;
    aggregate.deleted += result.deleted;
    aggregate.errors.push(...result.errors);
  }

  if (folders.length > 0) {
    const result = await emitFolders(client, input.workspaceId, folders, input.connectionId);
    aggregate.written += result.written;
    aggregate.deleted += result.deleted;
    aggregate.errors.push(...result.errors);
  }

  return aggregate;
}

async function emitNotes(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly GranolaNoteEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const priorReader = new PriorAliasReader(client, workspaceId);
  const mainIndex = createIndexReconciler<GranolaNoteIndexRow>(client, workspaceId, granolaNotesIndexPath());
  const facetReconcilers = new Map<string, IndexFileReconciler<GranolaFacetRow>>();

  const fanout = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planNoteDelete(
        record.id,
        priorReader,
        mainIndex,
        facetReconcilers,
        client,
        workspaceId,
      );
    }
    return planNoteWrite(
      record,
      priorReader,
      mainIndex,
      facetReconcilers,
      client,
      workspaceId,
      connectionId,
    );
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

async function emitFolders(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly GranolaFolderEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const priorReader = new PriorAliasReader(client, workspaceId);
  const mainIndex = createIndexReconciler<GranolaFolderIndexRow>(client, workspaceId, granolaFoldersIndexPath());
  const facetReconcilers = new Map<string, IndexFileReconciler<GranolaFacetRow>>();

  const fanout = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planFolderDelete(
        record.id,
        priorReader,
        mainIndex,
        facetReconcilers,
        client,
        workspaceId,
      );
    }
    return planFolderWrite(
      record,
      priorReader,
      mainIndex,
      facetReconcilers,
      client,
      workspaceId,
      connectionId,
    );
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

async function planNoteWrite(
  note: GranolaNote,
  priorReader: PriorAliasReader,
  mainIndex: IndexFileReconciler<GranolaNoteIndexRow>,
  facetReconcilers: Map<string, IndexFileReconciler<GranolaFacetRow>>,
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(note.id);
  if (!id) return {};

  const row = noteIndexRow(note);
  mainIndex.upsert(row);

  const nextFacetPaths = noteFacetIndexPathsFromRow(row);
  for (const path of nextFacetPaths) {
    getFacetReconciler(facetReconcilers, client, workspaceId, path).upsert(toFacetRow(row));
  }

  const prior = await priorReader.read<PriorNoteState>(
    granolaByIdAliasPath('notes', id),
    extractPriorNoteState,
  );
  if (prior) {
    for (const priorPath of noteFacetIndexPathsFromState(id, prior)) {
      getFacetReconciler(facetReconcilers, client, workspaceId, priorPath).remove(id);
    }
  }

  const content = JSON.stringify(
    {
      provider: GRANOLA_PROVIDER,
      objectType: 'note',
      objectId: id,
      canonicalPath: computeGranolaPath('note', id),
      payload: note,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );

  return {
    writes: [
      {
        path: granolaByIdAliasPath('notes', id),
        content,
        contentType: JSON_CONTENT_TYPE,
      },
    ],
  };
}

async function planNoteDelete(
  idValue: string,
  priorReader: PriorAliasReader,
  mainIndex: IndexFileReconciler<GranolaNoteIndexRow>,
  facetReconcilers: Map<string, IndexFileReconciler<GranolaFacetRow>>,
  client: AuxiliaryEmitterClient,
  workspaceId: string,
): Promise<EmitPlan> {
  const id = readNonEmptyString(idValue);
  if (!id) return {};

  mainIndex.remove(id);
  const prior = await priorReader.read<PriorNoteState>(
    granolaByIdAliasPath('notes', id),
    extractPriorNoteState,
  );

  for (const priorPath of noteFacetIndexPathsFromState(id, prior ?? {})) {
    getFacetReconciler(facetReconcilers, client, workspaceId, priorPath).remove(id);
  }

  return {
    deletes: [
      {
        path: granolaByIdAliasPath('notes', id),
      },
    ],
  };
}

async function planFolderWrite(
  folder: GranolaFolder,
  priorReader: PriorAliasReader,
  mainIndex: IndexFileReconciler<GranolaFolderIndexRow>,
  facetReconcilers: Map<string, IndexFileReconciler<GranolaFacetRow>>,
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(folder.id);
  if (!id) return {};

  const row = folderIndexRow(folder);
  mainIndex.upsert(row);

  const nextFacetPaths = folderFacetIndexPathsFromRow(row);
  for (const path of nextFacetPaths) {
    getFacetReconciler(facetReconcilers, client, workspaceId, path).upsert(toFacetRow(row));
  }

  const prior = await priorReader.read<PriorFolderState>(
    granolaByIdAliasPath('folders', id),
    extractPriorFolderState,
  );
  if (prior) {
    for (const priorPath of folderFacetIndexPathsFromState(id, prior)) {
      getFacetReconciler(facetReconcilers, client, workspaceId, priorPath).remove(id);
    }
  }

  const content = JSON.stringify(
    {
      provider: GRANOLA_PROVIDER,
      objectType: 'folder',
      objectId: id,
      canonicalPath: computeGranolaPath('folder', id),
      payload: folder,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );

  return {
    writes: [
      {
        path: granolaByIdAliasPath('folders', id),
        content,
        contentType: JSON_CONTENT_TYPE,
      },
    ],
  };
}

async function planFolderDelete(
  idValue: string,
  priorReader: PriorAliasReader,
  mainIndex: IndexFileReconciler<GranolaFolderIndexRow>,
  facetReconcilers: Map<string, IndexFileReconciler<GranolaFacetRow>>,
  client: AuxiliaryEmitterClient,
  workspaceId: string,
): Promise<EmitPlan> {
  const id = readNonEmptyString(idValue);
  if (!id) return {};

  mainIndex.remove(id);
  const prior = await priorReader.read<PriorFolderState>(
    granolaByIdAliasPath('folders', id),
    extractPriorFolderState,
  );

  for (const priorPath of folderFacetIndexPathsFromState(id, prior ?? {})) {
    getFacetReconciler(facetReconcilers, client, workspaceId, priorPath).remove(id);
  }

  return {
    deletes: [
      {
        path: granolaByIdAliasPath('folders', id),
      },
    ],
  };
}

function createIndexReconciler<T extends { id: string }>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): IndexFileReconciler<T> {
  return new IndexFileReconciler<T>({
    client,
    workspaceId,
    path,
    builder: (rows) => ({
      path,
      contentType: JSON_CONTENT_TYPE,
      content: `${JSON.stringify([...rows].sort(compareRows))}\n`,
    }),
  });
}

function getFacetReconciler<T extends { id: string }>(
  map: Map<string, IndexFileReconciler<T>>,
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): IndexFileReconciler<T> {
  const existing = map.get(path);
  if (existing) return existing;

  const created = createIndexReconciler<T>(client, workspaceId, path);
  map.set(path, created);
  return created;
}

function compareRows<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function noteIndexRow(note: GranolaNote): GranolaNoteIndexRow {
  const id = note.id;
  const title = readNonEmptyString(note.title) ?? '(untitled)';
  const updated = readNonEmptyString(note.updated_at);
  const day = updated ? parseIsoDay(updated) : undefined;
  const folderIds = readFolderIds(note.folder_membership);

  return {
    id,
    title,
    ...(updated ? { updated } : {}),
    ...(day ? { day } : {}),
    ...(folderIds.length > 0 ? { folderIds } : {}),
    canonicalPath: computeGranolaPath('note', id),
  };
}

function folderIndexRow(folder: GranolaFolder): GranolaFolderIndexRow {
  const id = folder.id;
  const title = readNonEmptyString(folder.name) ?? id;
  const parentFolderId = readNonEmptyString(folder.parent_folder_id);

  return {
    id,
    title,
    ...(parentFolderId ? { parentFolderId } : {}),
    canonicalPath: computeGranolaPath('folder', id),
  };
}

function toFacetRow(
  row: GranolaNoteIndexRow | GranolaFolderIndexRow,
): GranolaFacetRow {
  const updated = 'updated' in row ? row.updated : undefined;
  return {
    id: row.id,
    title: row.title,
    canonicalPath: row.canonicalPath,
    ...(updated ? { updated } : {}),
  };
}

function noteFacetIndexPathsFromRow(row: GranolaNoteIndexRow): string[] {
  const paths: string[] = [];
  if (row.day) {
    paths.push(granolaNoteByDayIndexPath(row.day));
  }
  for (const folderId of row.folderIds ?? []) {
    paths.push(granolaNoteByFolderIndexPath(folderId));
  }
  return dedupe(paths);
}

function noteFacetIndexPathsFromState(id: string, state: PriorNoteState): string[] {
  const paths: string[] = [];
  if (state.day) {
    paths.push(granolaNoteByDayIndexPath(state.day));
  }
  for (const folderId of state.folderIds ?? []) {
    const normalized = readNonEmptyString(folderId);
    if (normalized) {
      paths.push(granolaNoteByFolderIndexPath(normalized));
    }
  }
  if (paths.length === 0 && state.updated) {
    const fallbackDay = parseIsoDay(state.updated);
    if (fallbackDay) {
      paths.push(granolaNoteByDayIndexPath(fallbackDay));
    }
  }
  if (paths.length === 0 && id) {
    return [];
  }
  return dedupe(paths);
}

function folderFacetIndexPathsFromRow(row: GranolaFolderIndexRow): string[] {
  if (!row.parentFolderId) {
    return [];
  }
  return [granolaFolderByParentIndexPath(row.parentFolderId)];
}

function folderFacetIndexPathsFromState(id: string, state: PriorFolderState): string[] {
  const parentId = readNonEmptyString(state.parentFolderId);
  if (!parentId && id) {
    return [];
  }
  return parentId ? [granolaFolderByParentIndexPath(parentId)] : [];
}

function extractPriorNoteState(parsed: Record<string, unknown>): PriorNoteState | null {
  const payload = pickPayload(parsed);
  const id = readNonEmptyString(payload.id);
  if (!id) return null;
  const title = readNonEmptyString(payload.title) ?? '(untitled)';
  const updated = readNonEmptyString(payload.updated_at);
  const day = updated ? parseIsoDay(updated) : undefined;
  const folderIds = readFolderIds(payload.folder_membership);

  return {
    ...(title ? { title } : {}),
    ...(updated ? { updated } : {}),
    ...(day ? { day } : {}),
    ...(folderIds.length > 0 ? { folderIds } : {}),
  };
}

function extractPriorFolderState(parsed: Record<string, unknown>): PriorFolderState | null {
  const payload = pickPayload(parsed);
  const id = readNonEmptyString(payload.id);
  if (!id) return null;

  const title = readNonEmptyString(payload.name) ?? id;
  const parentFolderId = readNonEmptyString(payload.parent_folder_id);

  return {
    ...(title ? { title } : {}),
    ...(parentFolderId ? { parentFolderId } : {}),
  };
}

function pickPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(parsed.payload)) {
    return parsed.payload;
  }
  return parsed;
}

function readFolderIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = readNonEmptyString(item.id);
    if (id) ids.add(id);
  }
  return [...ids];
}

function parseIsoDay(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const directMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  if (directMatch?.[1]) {
    return directMatch[1];
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    const direct = trimmed.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(direct) ? direct : undefined;
  }
  return parsed.toISOString().slice(0, 10);
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

function isDeleteRecord(record: unknown): record is { id: string; _deleted: true } {
  return isRecord(record) && record._deleted === true && typeof record.id === 'string';
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function writeRootIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const content = JSON.stringify(
    [
      {
        path: '/granola/notes',
        title: 'Notes',
      },
      {
        path: '/granola/folders',
        title: 'Folders',
      },
    ],
    null,
    2,
  );

  try {
    await client.writeFile({
      workspaceId,
      path: '/granola/_index.json',
      content: `${content}\n`,
      contentType: JSON_CONTENT_TYPE,
    });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({
      path: '/granola/_index.json',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
