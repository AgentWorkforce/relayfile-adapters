import type { RelayFileClient, WriteQueuedResponse } from '@relayfile/sdk';
import { upsertIndexAtomic, type AtomicUpsertOptions, type VfsLike } from '@relayfile/adapter-core';
import { ingestDatabaseArtifacts } from './databases/ingestion.js';
import { buildIndexFiles } from './index-emitter.js';
import { notionLayoutPromptFile } from './layout-prompt.js';
import { ingestPageArtifacts, retrievePage } from './pages/ingestion.js';
import { ingestUserArtifacts } from './users/ingestion.js';
import {
  notionByIdAliasPath,
  notionByNameAliasPath,
  notionByTitleAliasPath,
  notionPageByDatabaseAliasPath,
  notionPageByParentAliasPath,
} from './path-mapper.js';
import { slugifyAlias } from './alias-slug.js';
import type { NotionApiClient } from './client.js';
import type { NotionVfsFile } from './types.js';
import { withNotionNamingScope } from './path-mapper.js';

export interface WorkspaceWriteError {
  path: string;
  error: string;
}

export interface WorkspaceWriteFilesResult {
  responses: WriteQueuedResponse[];
  errors: WorkspaceWriteError[];
  primaryWriteErrors: WorkspaceWriteError[];
}

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

  // Users are workspace-scoped (no per-database/per-page filter needed)
  // and the /v1/users API returns the full visible directory in one
  // paginated call. Tolerate auth/permission failures: an integration
  // token without `read_user_info` scope still has a usable mount.
  try {
    files.push(...(await ingestUserArtifacts(client)));
  } catch {
    // intentionally swallow — see comment above
  }

  return [...files, ...buildIndexFiles(files), notionLayoutPromptFile()];
}

export async function writeWorkspaceFiles(
  relayClient: RelayFileClient,
  workspaceId: string,
  files: NotionVfsFile[],
): Promise<WorkspaceWriteFilesResult> {
  const batchIndexPaths = new Set(files.filter((file) => isIndexPath(file.path)).map((file) => file.path));

  const outcomes = await Promise.all(
    files.map(async (file) => {
      let response: WriteQueuedResponse | undefined;
      try {
        const baseRevision = await resolveBaseRevision(relayClient, workspaceId, file.path);
        response = await relayClient.writeFile({
          workspaceId,
          path: file.path,
          baseRevision,
          contentType: file.contentType,
          content: file.content,
          semantics: file.semantics,
        });
        if (file.aliasMetadata) {
          await writeNotionAliases(relayClient, workspaceId, file, batchIndexPaths);
        }
        return { response };
      } catch (error) {
        const writeError = {
          path: file.path,
          error: error instanceof Error ? error.message : String(error),
        };
        return {
          response,
          error: writeError,
          primaryWriteError: response ? undefined : writeError,
        };
      }
    }),
  );

  return {
    responses: outcomes.flatMap((outcome) => (outcome.response ? [outcome.response] : [])),
    errors: outcomes.flatMap((outcome) => (outcome.error ? [outcome.error] : [])),
    primaryWriteErrors: outcomes.flatMap((outcome) => (outcome.primaryWriteError ? [outcome.primaryWriteError] : [])),
  };
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
  batchIndexPaths: ReadonlySet<string>,
): Promise<void> {
  // duplicate JSON write — RelayFile exposes file writes, not symlink primitives, so aliases store canonical bytes verbatim.
  const aliasMetadata = file.aliasMetadata;
  if (!aliasMetadata) {
    return;
  }

  const aliasKind = aliasMetadata.aliasKind ?? 'page';
  const aliasIndexPath = `${aliasMetadata.scopePath}/_index.json`;

  // Bulk ingest appends record indexes for these scopes; those indexes
  // must own the `_index.json` shape when present in the same batch.
  if (!batchIndexPaths.has(aliasIndexPath)) {
    await writeNotionIndex(relayClient, workspaceId, aliasMetadata.scopePath, requiredRowsFor(aliasKind));
  }
  await writeAliasFile(relayClient, workspaceId, notionByIdAliasPath(aliasMetadata.scopePath, aliasMetadata.id), file);

  // by-title for pages/databases, by-name for users. The label always
  // slugs through the same helper and always carries the deterministic
  // <slug>__<short_id> suffix, so duplicate titles cannot clobber.
  const labelForAlias = aliasKind === 'user' ? aliasMetadata.name : aliasMetadata.title;
  const trimmedLabel = labelForAlias?.trim();
  if (trimmedLabel && slugifyAlias(trimmedLabel)) {
    const titleAliasPath =
      aliasKind === 'user'
        ? notionByNameAliasPath(aliasMetadata.scopePath, trimmedLabel, aliasMetadata.id)
        : notionByTitleAliasPath(aliasMetadata.scopePath, trimmedLabel, aliasMetadata.id);
    // TODO(issue #106): remove stale by-title/by-name aliases when a record is
    // renamed on re-ingest; this wave only writes the current alias.
    await writeAliasFile(relayClient, workspaceId, titleAliasPath, file);
  }

  if (aliasKind !== 'page') {
    return;
  }

  // Cross-reference: a page that lives in a database is also reachable
  // at /notion/pages/by-database/<db-slug>__<db_short_id>/<page-slug>__<short_id>.json.
  // Skip when the page has no title or database title to slug against.
  if (
    aliasMetadata.databaseId &&
    aliasMetadata.databaseTitle &&
    slugifyAlias(aliasMetadata.databaseTitle) &&
    trimmedLabel &&
    slugifyAlias(trimmedLabel)
  ) {
    const byDatabasePath = notionPageByDatabaseAliasPath(
      aliasMetadata.databaseId,
      aliasMetadata.id,
      aliasMetadata.databaseTitle,
      trimmedLabel,
    );
    await writeAliasFile(relayClient, workspaceId, byDatabasePath, file);
  }

  // Cross-reference: a child page is also reachable at
  // /notion/pages/by-parent/<type>-<parent-slug>__<short_id>/<page-slug>__<short_id>.json.
  // Workspace-rooted pages are intentionally skipped — the workspace
  // by-parent bucket would collect every top-level page and lose its
  // navigational value.
  if (
    aliasMetadata.parentType &&
    aliasMetadata.parentType !== 'workspace' &&
    aliasMetadata.parentId &&
    trimmedLabel &&
    slugifyAlias(trimmedLabel)
  ) {
    const byParentPath = notionPageByParentAliasPath(
      aliasMetadata.parentType,
      aliasMetadata.parentId,
      aliasMetadata.id,
      aliasMetadata.parentTitle,
      trimmedLabel,
    );
    await writeAliasFile(relayClient, workspaceId, byParentPath, file);
  }
}

function requiredRowsFor(aliasKind: 'page' | 'database' | 'user'): NotionIndexRow[] {
  if (aliasKind === 'user') {
    return [
      { title: 'by-id', file: 'by-id/' },
      { title: 'by-name', file: 'by-name/' },
    ];
  }
  return [
    { title: 'by-id', file: 'by-id/' },
    { title: 'by-title', file: 'by-title/' },
  ];
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

async function writeNotionIndex(
  relayClient: RelayFileClient,
  workspaceId: string,
  scopePath: string,
  requiredRows: NotionIndexRow[],
  options?: AtomicUpsertOptions,
): Promise<void> {
  const indexPath = `${scopePath}/_index.json`;
  const vfs = relayClientToVfs(relayClient, workspaceId);

  await upsertIndexAtomic<NotionIndexRow>(
    vfs,
    indexPath,
    parseIndexRows,
    (rows) => mergeIndexRowsList(rows, requiredRows),
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

function isIndexPath(path: string): boolean {
  return path.endsWith('/_index.json');
}
