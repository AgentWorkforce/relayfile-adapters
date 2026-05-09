import type { RelayFileClient, WriteQueuedResponse } from '@relayfile/sdk';
import { upsertIndexAtomic, type AtomicUpsertOptions, type VfsLike } from '@relayfile/adapter-core';
import { ingestDatabaseArtifacts } from './databases/ingestion.js';
import { buildIndexFiles } from './index-emitter.js';
import { notionLayoutPromptFile } from './layout-prompt.js';
import { ingestPageArtifacts, retrievePage } from './pages/ingestion.js';
import { notionByIdAliasPath, notionByTitleAliasPath } from './path-mapper.js';
import { slugifyAlias } from './alias-slug.js';
import type { NotionApiClient } from './client.js';
import type { NotionVfsFile } from './types.js';
import { withNotionNamingScope } from './path-mapper.js';

export async function collectWorkspaceFiles(client: NotionApiClient): Promise<NotionVfsFile[]> {
  const files: NotionVfsFile[] = [];

  for (const databaseId of client.config.databaseIds ?? []) {
    files.push(...(await withNotionNamingScope(() => ingestDatabaseArtifacts(client, databaseId))));
  }

  await withNotionNamingScope(async () => {
    for (const pageId of client.config.pageIds ?? []) {
      const page = await retrievePage(client, pageId);
      files.push(...(await ingestPageArtifacts(client, page)));
    }
  });

  return [...files, ...buildIndexFiles(files), notionLayoutPromptFile()];
}

export async function writeWorkspaceFiles(
  relayClient: RelayFileClient,
  workspaceId: string,
  files: NotionVfsFile[],
): Promise<WriteQueuedResponse[]> {
  return Promise.all(
    files.map(async (file) => {
      const baseRevision = await resolveBaseRevision(relayClient, workspaceId, file.path);
      const response = await relayClient.writeFile({
        workspaceId,
        path: file.path,
        baseRevision,
        contentType: file.contentType,
        content: file.content,
        semantics: file.semantics,
      });
      if (file.aliasMetadata) {
        await writeNotionAliases(relayClient, workspaceId, file);
      }
      return response;
    }),
  );
}

interface NotionIndexRow {
  file: string;
  title: string;
}

interface NotionIndexDocument {
  rows: NotionIndexRow[];
}

async function resolveBaseRevision(relayClient: RelayFileClient, workspaceId: string, path: string): Promise<string> {
  try {
    const existing = await relayClient.readFile(workspaceId, path);
    return existing.revision;
  } catch {
    return '0';
  }
}

async function writeNotionAliases(
  relayClient: RelayFileClient,
  workspaceId: string,
  file: NotionVfsFile,
): Promise<void> {
  // duplicate JSON write — RelayFile exposes file writes, not symlink primitives, so aliases store canonical bytes verbatim.
  const aliasMetadata = file.aliasMetadata;
  if (!aliasMetadata) {
    return;
  }

  await writeNotionIndex(relayClient, workspaceId, aliasMetadata.scopePath);
  await writeAliasFile(relayClient, workspaceId, notionByIdAliasPath(aliasMetadata.scopePath, aliasMetadata.id), file);

  const title = aliasMetadata.title?.trim();
  if (!title || !slugifyAlias(title)) {
    return;
  }

  const baseAliasPath = notionByTitleAliasPath(aliasMetadata.scopePath, title, aliasMetadata.id);
  const existingBaseContent = await readExistingContent(relayClient, workspaceId, baseAliasPath);
  const aliasPath =
    existingBaseContent !== undefined && existingBaseContent !== file.content
      ? notionByTitleAliasPath(aliasMetadata.scopePath, title, aliasMetadata.id, true)
      : baseAliasPath;

  // TODO(issue #106): remove stale by-title aliases when a page title changes on re-ingest; this wave only writes the current alias.
  await writeAliasFile(relayClient, workspaceId, aliasPath, file);
}

async function writeAliasFile(
  relayClient: RelayFileClient,
  workspaceId: string,
  path: string,
  file: NotionVfsFile,
): Promise<void> {
  const baseRevision = await resolveBaseRevision(relayClient, workspaceId, path);
  await relayClient.writeFile({
    workspaceId,
    path,
    baseRevision,
    contentType: file.contentType,
    content: file.content,
    semantics: file.semantics,
  });
}

async function readExistingContent(
  relayClient: RelayFileClient,
  workspaceId: string,
  path: string,
): Promise<string | undefined> {
  try {
    const existing = await relayClient.readFile(workspaceId, path);
    return typeof existing.content === 'string' ? existing.content : undefined;
  } catch {
    return undefined;
  }
}

async function writeNotionIndex(
  relayClient: RelayFileClient,
  workspaceId: string,
  scopePath: string,
  options?: AtomicUpsertOptions,
): Promise<void> {
  const indexPath = `${scopePath}/_index.json`;
  const vfs = relayClientToVfs(relayClient, workspaceId);

  await upsertIndexAtomic<NotionIndexRow>(
    vfs,
    indexPath,
    parseIndexRows,
    (rows) =>
      mergeIndexRowsList(rows, [
        { title: 'by-id', file: 'by-id/' },
        { title: 'by-title', file: 'by-title/' },
      ]),
    (rows) => `${JSON.stringify({ rows }, null, 2)}\n`,
    options,
  );
}

/**
 * Wrap the SDK's single-input `RelayFileClient` in the VfsLike duck-typed
 * shape the atomic-index helper consumes. The shim is deliberately
 * minimal: it only exposes the readers / writer the helper invokes, and
 * forwards `baseRevision` from the helper's third positional options arg
 * into the SDK's `WriteFileInput.baseRevision` field.
 *
 * Reading a missing file currently surfaces as a thrown error from the
 * SDK; we translate that to `undefined` so the helper treats it as a
 * fresh-revision read (revision "0").
 */
function relayClientToVfs(relayClient: RelayFileClient, workspaceId: string): VfsLike {
  return {
    async readFile(path: string): Promise<{ content: string; revision: string } | undefined> {
      try {
        const existing = await relayClient.readFile(workspaceId, path);
        return { content: existing.content, revision: existing.revision };
      } catch {
        return undefined;
      }
    },
    async writeFile(
      path: string,
      content: string,
      writeOptions?: { baseRevision?: string },
    ): Promise<unknown> {
      return relayClient.writeFile({
        workspaceId,
        path,
        // Default to '0' (fresh revision) when the helper omits the
        // baseRevision; in practice it always passes one.
        baseRevision: writeOptions?.baseRevision ?? '0',
        contentType: 'application/json; charset=utf-8',
        content,
      });
    },
  };
}

function mergeIndexRowsList(existingRows: NotionIndexRow[], requiredRows: NotionIndexRow[]): NotionIndexRow[] {
  const rows = new Map<string, NotionIndexRow>();

  for (const row of existingRows) {
    rows.set(row.file, row);
  }

  for (const row of requiredRows) {
    rows.set(row.file, row);
  }

  return [...rows.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function parseIndexRows(existingContent: string | undefined): NotionIndexRow[] {
  if (!existingContent) {
    return [];
  }

  try {
    const parsed = JSON.parse(existingContent) as Partial<NotionIndexDocument>;
    return Array.isArray(parsed.rows)
      ? parsed.rows.filter((row): row is NotionIndexRow => typeof row?.file === 'string' && typeof row?.title === 'string')
      : [];
  } catch {
    return [];
  }
}
