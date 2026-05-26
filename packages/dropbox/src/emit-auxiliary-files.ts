import { createHash } from 'node:crypto';

import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
} from '@relayfile/adapter-core';

import {
  computeDropboxPath,
  dropboxByIdAliasPath,
  dropboxFileByPathAliasPath,
  dropboxFilesIndexPath,
  dropboxFolderByPathAliasPath,
  dropboxFoldersIndexPath,
  dropboxRootIndexPath,
  dropboxSharedFoldersIndexPath,
  dropboxSharedLinksIndexPath,
} from './path-mapper.js';

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

type DeleteRecord = { id: string; _deleted: true; path_lower?: string; dropbox_id?: string };

type DropboxFileRecord = {
  id: string;
  dropbox_id?: string;
  name?: string;
  path_lower?: string;
  server_modified?: string;
  client_modified?: string;
};

type DropboxFolderRecord = {
  id: string;
  dropbox_id?: string;
  name?: string;
  path_lower?: string;
};

type DropboxSharedFolderRecord = {
  id?: string;
  shared_folder_id?: string;
  shared_folder_name?: string;
};

type DropboxSharedLinkRecord = {
  id?: string;
  name?: string;
  url?: string;
};

interface IndexRow {
  id: string;
  title: string;
  updated: string;
  canonicalPath: string;
  pathLower?: string;
}

export interface EmitDropboxAuxiliaryFilesInput {
  workspaceId: string;
  files?: readonly (DropboxFileRecord | DeleteRecord)[];
  folders?: readonly (DropboxFolderRecord | DeleteRecord)[];
  sharedFolders?: readonly (DropboxSharedFolderRecord | DeleteRecord)[];
  sharedLinks?: readonly (DropboxSharedLinkRecord | DeleteRecord)[];
  connectionId?: string;
}

export async function emitDropboxAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitDropboxAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  await safeWrite(
    client,
    input.workspaceId,
    dropboxRootIndexPath(),
    `${JSON.stringify([
      { id: 'files', title: 'Files', canonicalPath: dropboxFilesIndexPath() },
      { id: 'folders', title: 'Folders', canonicalPath: dropboxFoldersIndexPath() },
      {
        id: 'shared-folders',
        title: 'Shared Folders',
        canonicalPath: dropboxSharedFoldersIndexPath(),
      },
      {
        id: 'shared-links',
        title: 'Shared Links',
        canonicalPath: dropboxSharedLinksIndexPath(),
      },
    ], null, 2)}\n`,
    aggregate,
  );

  await emitFiles(client, input.workspaceId, input.files ?? [], input.connectionId, aggregate);
  await emitFolders(client, input.workspaceId, input.folders ?? [], input.connectionId, aggregate);
  await emitSharedFolders(
    client,
    input.workspaceId,
    input.sharedFolders ?? [],
    input.connectionId,
    aggregate,
  );
  await emitSharedLinks(client, input.workspaceId, input.sharedLinks ?? [], input.connectionId, aggregate);

  return aggregate;
}

async function emitFiles(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly (DropboxFileRecord | DeleteRecord)[],
  connectionId: string | undefined,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const existingRows = await readIndex(client, workspaceId, dropboxFilesIndexPath(), aggregate);
  if (existingRows === null) {
    return;
  }
  const rows = new Map(existingRows.map((row) => [row.id, row]));

  for (const record of records) {
    const id = readId(record.id);
    const previous = rows.get(id);
    const previousPathLower = previous?.pathLower;
    const pathLower = readString(record.path_lower) ?? previousPathLower ?? id;
    const canonicalPath = computeDropboxPath('file', id, {
      path_lower: pathLower,
      name: readFieldString(record, 'name'),
    });
    const byPath = dropboxFileByPathAliasPath(pathLower);
    const byId = dropboxByIdAliasPath('files', readString(record.dropbox_id) ?? id);

    if (isDeleteRecord(record)) {
      rows.delete(id);
      await safeDelete(client, workspaceId, byPath, aggregate);
      await safeDelete(client, workspaceId, byId, aggregate);
      continue;
    }

    if (previousPathLower && previousPathLower !== pathLower) {
      await safeDelete(
        client,
        workspaceId,
        dropboxFileByPathAliasPath(previousPathLower),
        aggregate,
      );
    }

    rows.set(id, {
      id,
      title: readString(record.name) ?? pathLower,
      updated:
        readString(record.server_modified) ??
        readString(record.client_modified) ??
        new Date().toISOString(),
      canonicalPath,
      pathLower,
    });

    const aliasPayload = buildAliasPayload({
      provider: 'dropbox',
      objectType: 'file',
      objectId: id,
      canonicalPath,
      payload: record,
      connectionId,
    });

    await safeWrite(client, workspaceId, byPath, aliasPayload, aggregate);
    await safeWrite(client, workspaceId, byId, aliasPayload, aggregate);
  }

  await writeIndex(client, workspaceId, dropboxFilesIndexPath(), rows, aggregate);
}

async function emitFolders(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly (DropboxFolderRecord | DeleteRecord)[],
  connectionId: string | undefined,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const existingRows = await readIndex(client, workspaceId, dropboxFoldersIndexPath(), aggregate);
  if (existingRows === null) {
    return;
  }
  const rows = new Map(existingRows.map((row) => [row.id, row]));

  for (const record of records) {
    const id = readId(record.id);
    const previous = rows.get(id);
    const previousPathLower = previous?.pathLower;
    const pathLower = readString(record.path_lower) ?? previousPathLower ?? id;
    const canonicalPath = computeDropboxPath('folder', id, {
      path_lower: pathLower,
      name: readFieldString(record, 'name'),
    });
    const byPath = dropboxFolderByPathAliasPath(pathLower);
    const byId = dropboxByIdAliasPath('folders', readString(record.dropbox_id) ?? id);

    if (isDeleteRecord(record)) {
      rows.delete(id);
      await safeDelete(client, workspaceId, byPath, aggregate);
      await safeDelete(client, workspaceId, byId, aggregate);
      continue;
    }

    if (previousPathLower && previousPathLower !== pathLower) {
      await safeDelete(
        client,
        workspaceId,
        dropboxFolderByPathAliasPath(previousPathLower),
        aggregate,
      );
    }

    rows.set(id, {
      id,
      title: readString(record.name) ?? pathLower,
      updated: new Date().toISOString(),
      canonicalPath,
      pathLower,
    });

    const aliasPayload = buildAliasPayload({
      provider: 'dropbox',
      objectType: 'folder',
      objectId: id,
      canonicalPath,
      payload: record,
      connectionId,
    });

    await safeWrite(client, workspaceId, byPath, aliasPayload, aggregate);
    await safeWrite(client, workspaceId, byId, aliasPayload, aggregate);
  }

  await writeIndex(client, workspaceId, dropboxFoldersIndexPath(), rows, aggregate);
}

async function emitSharedFolders(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly (DropboxSharedFolderRecord | DeleteRecord)[],
  connectionId: string | undefined,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const existingRows = await readIndex(client, workspaceId, dropboxSharedFoldersIndexPath(), aggregate);
  if (existingRows === null) {
    return;
  }
  const rows = new Map(existingRows.map((row) => [row.id, row]));

  for (const record of records) {
    const idValue = readString(record.id) ?? readFieldString(record, 'shared_folder_id');
    if (!idValue) {
      aggregate.errors.push({
        path: dropboxSharedFoldersIndexPath(),
        error: 'Dropbox shared-folder record is missing both id and shared_folder_id',
      });
      continue;
    }
    const id = readId(idValue);
    const canonicalPath = computeDropboxPath('shared-folder', id);
    const byId = dropboxByIdAliasPath('shared-folders', id);

    if (isDeleteRecord(record)) {
      rows.delete(id);
      await safeDelete(client, workspaceId, byId, aggregate);
      continue;
    }

    rows.set(id, {
      id,
      title: readString(record.shared_folder_name) ?? id,
      updated: new Date().toISOString(),
      canonicalPath,
    });

    await safeWrite(
      client,
      workspaceId,
      byId,
      buildAliasPayload({
        provider: 'dropbox',
        objectType: 'shared-folder',
        objectId: id,
        canonicalPath,
        payload: record,
        connectionId,
      }),
      aggregate,
    );
  }

  await writeIndex(client, workspaceId, dropboxSharedFoldersIndexPath(), rows, aggregate);
}

async function emitSharedLinks(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly (DropboxSharedLinkRecord | DeleteRecord)[],
  connectionId: string | undefined,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const existingRows = await readIndex(client, workspaceId, dropboxSharedLinksIndexPath(), aggregate);
  if (existingRows === null) {
    return;
  }
  const rows = new Map(existingRows.map((row) => [row.id, row]));

  for (const record of records) {
    const explicitId = readString(record.id);
    const url = readFieldString(record, 'url');
    const id = explicitId
      ? readId(explicitId)
      : (url ? `url_${createHash('sha256').update(url).digest('hex').slice(0, 24)}` : null);
    if (!id) {
      aggregate.errors.push({
        path: dropboxSharedLinksIndexPath(),
        error: 'Dropbox shared-link record is missing both id and url',
      });
      continue;
    }
    const canonicalPath = computeDropboxPath('shared-link', id);
    const byId = dropboxByIdAliasPath('shared-links', id);

    if (isDeleteRecord(record)) {
      rows.delete(id);
      await safeDelete(client, workspaceId, byId, aggregate);
      continue;
    }

    rows.set(id, {
      id,
      title: readString(record.name) ?? readString(record.url) ?? id,
      updated: new Date().toISOString(),
      canonicalPath,
    });

    await safeWrite(
      client,
      workspaceId,
      byId,
      buildAliasPayload({
        provider: 'dropbox',
        objectType: 'shared-link',
        objectId: id,
        canonicalPath,
        payload: record,
        connectionId,
      }),
      aggregate,
    );
  }

  await writeIndex(client, workspaceId, dropboxSharedLinksIndexPath(), rows, aggregate);
}

function buildAliasPayload(input: {
  provider: string;
  objectType: string;
  objectId: string;
  canonicalPath: string;
  payload: Record<string, unknown>;
  connectionId?: string;
}): string {
  return `${JSON.stringify(
    {
      provider: input.provider,
      objectType: input.objectType,
      objectId: input.objectId,
      canonicalPath: input.canonicalPath,
      payload: input.payload,
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    },
    null,
    2,
  )}\n`;
}

function readId(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw new Error('Dropbox record id must be a non-empty string or finite number');
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readFieldString(record: unknown, field: string): string | undefined {
  if (!record || typeof record !== 'object') {
    return undefined;
  }
  return readString((record as Record<string, unknown>)[field]);
}

function isDeleteRecord(record: unknown): record is DeleteRecord {
  return Boolean(
    record &&
      typeof record === 'object' &&
      (record as { _deleted?: unknown })._deleted === true,
  );
}

async function readIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<IndexRow[] | null> {
  if (!client.readFile) {
    return [];
  }

  try {
    const value = await client.readFile({ workspaceId, path });
    const content = typeof value === 'string' ? value : value?.content;
    if (!content) {
      return [];
    }
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      aggregate.errors.push({ path, error: 'Expected index JSON array' });
      return null;
    }
    return parsed.filter((row): row is IndexRow => {
      if (!row || typeof row !== 'object') {
        return false;
      }
      const candidate = row as Partial<IndexRow>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.title === 'string' &&
        typeof candidate.updated === 'string' &&
        typeof candidate.canonicalPath === 'string' &&
        (candidate.pathLower === undefined || typeof candidate.pathLower === 'string')
      );
    });
  } catch (error) {
    aggregate.errors.push({
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  rows: Map<string, IndexRow>,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const next = [...rows.values()].sort(
    (left, right) =>
      right.updated.localeCompare(left.updated) || left.id.localeCompare(right.id),
  );
  await safeWrite(client, workspaceId, path, `${JSON.stringify(next, null, 2)}\n`, aggregate);
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
    aggregate.errors.push({
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function safeDelete(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  try {
    if (!client.deleteFile) {
      return;
    }
    await client.deleteFile({ workspaceId, path });
    aggregate.deleted += 1;
  } catch (error) {
    aggregate.errors.push({
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
