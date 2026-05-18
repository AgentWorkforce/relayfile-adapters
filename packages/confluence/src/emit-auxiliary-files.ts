/**
 * Adapter-owned auxiliary-file emission for Confluence.
 *
 * This is the Phase 1 reference port for the cross-adapter `emitAuxiliaryFiles`
 * contract defined in `@relayfile/adapter-core`. It generalizes the
 * write-loop currently sitting in `cloud/packages/core/src/sync/record-writer.ts`
 * (`writeConfluenceAuxiliaryFiles`) so the same primitive can be reused
 * across Slack, Jira, Notion, Linear, GitHub in Phase 2, and so cloud's
 * dispatcher collapses to a 10-line provider switch in Phase 3.
 *
 * Behavior reproduced from cloud's current implementation:
 *
 *   1. For every page record, write the by-id alias unconditionally (the
 *      stable reconciliation anchor) plus by-title / by-state / by-space /
 *      by-parent when the underlying fields are present. The canonical
 *      `/confluence/spaces/<spaceId>/pages/<slug>__<id>.json` path is
 *      written too — the bytes are identical at every alias path, so any
 *      one of them resolves to the same payload (matches the contract
 *      adapter-confluence#69 established).
 *   2. For every page rename / status change / spaceId change, read the
 *      prior by-id alias to recover the previous title / status /
 *      spaceId, recompute the prior alias set, and delete every alias
 *      that no longer applies. Reads degrade to "no reconciliation" when
 *      the client lacks `readFile` — same back-compat we shipped in
 *      b2440df.
 *   3. For every space record, the same shape: by-id, by-title (if name
 *      slugs to non-empty), by-key (when present) plus the canonical
 *      `/confluence/spaces/<slug>__<id>.json`.
 *   4. For deleted records, all known alias and canonical paths are
 *      removed. Index rows are also removed in the same flush.
 *   5. `_index.json` files for pages and spaces are read once, merged
 *      with upserts and removes, written once. Failures are accumulated
 *      into the returned `errors` array, never thrown.
 *
 * Records are accepted as already-cleaned `ConfluencePage` / `ConfluenceSpace`
 * objects (the cleaning step happens in cloud; this adapter doesn't need
 * to strip Nango metadata). To delete a record, pass an object with `id`
 * plus `_deleted: true` — that's the contract the cloud dispatcher will
 * adopt in Phase 3.
 */

import {
  PriorAliasReader,
  IndexFileReconciler,
  runEmitBatch,
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitDelete,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import { slugifyAlias } from './alias-slug.js';
import {
  confluencePageByIdAliasPath,
  confluencePageByEditedPath,
  confluencePageByParentAliasPath,
  confluencePageBySpaceAliasPath,
  confluencePageByStatePath,
  confluencePageByTitleAliasPath,
  confluencePagePath,
  confluencePagesIndexPath,
  confluenceSpaceByIdAliasPath,
  confluenceSpaceByKeyAliasPath,
  confluenceSpaceByTitleAliasPath,
  confluenceSpacePath,
  confluenceSpacesIndexPath,
} from './path-mapper.js';
import { buildConfluenceRootIndexFile } from './index-emitter.js';
import {
  confluencePageIndexRow,
  confluenceSpaceIndexRow,
  type ConfluencePageIndexRow,
  type ConfluenceSpaceIndexRow,
} from './queries.js';
import {
  CONFLUENCE_PROVIDER_NAME,
  type ConfluencePage,
  type ConfluenceSpace,
  type RelayFileClientLike,
} from './types.js';

/**
 * Records accepted by `emitConfluenceAuxiliaryFiles`. Each entry is either
 * a full page/space object or a `{ id, _deleted: true }` tombstone for the
 * delete branch. Adapters in Phase 2 will adopt the same `_deleted` flag
 * so the cloud dispatcher can route uniformly across providers.
 */
export type ConfluencePageEmitRecord =
  | ConfluencePage
  | { id: string; _deleted: true };

export type ConfluenceSpaceEmitRecord =
  | ConfluenceSpace
  | { id: string; _deleted: true };

export interface ConfluenceEmitAuxiliaryFilesInput {
  workspaceId: string;
  /** Page records (full or `_deleted` tombstones). Pass `undefined` for
   *  pure-space batches. */
  pages?: readonly ConfluencePageEmitRecord[];
  /** Space records (full or `_deleted` tombstones). Pass `undefined` for
   *  pure-page batches. */
  spaces?: readonly ConfluenceSpaceEmitRecord[];
  /**
   * Optional connection id to include in the rendered payload wrapper so
   * downstream readers can route writeback by connection. Mirrors the
   * `ConfluenceAdapter.renderContent` output without forcing callers to
   * instantiate the class.
   */
  connectionId?: string;
}

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

/**
 * Phase-1 entry point. Adapters in Phase 2 will expose the same function
 * shape; cloud's Phase 3 dispatcher iterates `(provider, records)` and
 * calls the corresponding `emit*AuxiliaryFiles` function with a shimmed
 * `AuxiliaryEmitterClient`.
 */
export async function emitConfluenceAuxiliaryFiles(
  client: AuxiliaryEmitterClient | RelayFileClientLike,
  input: ConfluenceEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const emitterClient = client as AuxiliaryEmitterClient;
  const workspaceId = input.workspaceId;
  const pages = input.pages ?? [];
  const spaces = input.spaces ?? [];

  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  // Always emit the root `/confluence/_index.json` so `ls /confluence/`
  // reliably surfaces the top-level resource buckets, even for empty /
  // single-bucket batches. Mirrors `emitSlackAuxiliaryFiles`.
  await writeRootIndex(emitterClient, workspaceId, aggregate);

  if (pages.length === 0 && spaces.length === 0) {
    return aggregate;
  }

  if (pages.length > 0) {
    const pageResult = await emitPages(emitterClient, workspaceId, pages, input.connectionId);
    accumulate(aggregate, pageResult);
  }

  if (spaces.length > 0) {
    const spaceResult = await emitSpaces(emitterClient, workspaceId, spaces, input.connectionId);
    accumulate(aggregate, spaceResult);
  }

  return aggregate;
}

// -- root index -------------------------------------------------------------

async function writeRootIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const file = buildConfluenceRootIndexFile();
  try {
    await client.writeFile({
      workspaceId,
      path: file.path,
      content: file.content,
      contentType: file.contentType,
    });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({
      path: file.path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// -- pages ------------------------------------------------------------------

async function emitPages(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly ConfluencePageEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const indexReconciler = new IndexFileReconciler<ConfluencePageIndexRow>({
    client,
    workspaceId,
    path: confluencePagesIndexPath(),
    builder: (rows) => ({
      path: confluencePagesIndexPath(),
      content: `${JSON.stringify(
        [...rows].sort(comparePageIndexRows),
      )}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });

  const priorReader = new PriorAliasReader(client, workspaceId);

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planPageDelete(record.id, priorReader, indexReconciler);
    }
    return planPageWrite(record, priorReader, indexReconciler, connectionId);
  });

  // Index flush after every per-record plan: one read+write per batch, not
  // per record. Cloud's current implementation does the same.
  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);

  return fanOut;
}

async function planPageWrite(
  page: ConfluencePage,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<ConfluencePageIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(page.id);
  if (!id) {
    return {};
  }

  const title = readNonEmptyString(page.title);
  const status = readNonEmptyString(page.status);
  const spaceId = readNonEmptyString(page.spaceId);
  const parentId = readNonEmptyString(page.parentId);
  const editedDate = editedDateSegment(readPageEditedAt(page));

  const content = renderPageContent(page, connectionId, false);

  const newPaths = pagePathsFor({ id, title, status, spaceId, parentId, editedDate });

  // Reconciliation: read the prior by-id alias and compute paths that no
  // longer apply. Anchored on by-id so it survives every other field change.
  const prior = await priorReader.read<PriorPageState>(
    confluencePageByIdAliasPath(id),
    extractPriorPageState,
  );
  const stalePaths = prior ? diffPaths(pagePathsFor({ id, ...prior }), newPaths) : [];

  const writes: EmitWrite[] = newPaths.map((path) => ({
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
  }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));

  indexReconciler.upsert(confluencePageIndexRow(page));

  return { writes, deletes };
}

async function planPageDelete(
  id: string,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<ConfluencePageIndexRow>,
): Promise<EmitPlan> {
  // For deletes we have no fresh payload, so we rely entirely on the prior
  // by-id alias to recover the alias fields. If the prior alias is missing
  // (degraded reader, or first-ever sync), we still delete the by-id alias
  // unconditionally — that's the minimal cleanup.
  const prior = await priorReader.read<PriorPageState>(
    confluencePageByIdAliasPath(id),
    extractPriorPageState,
  );
  const paths = pagePathsFor({ id, ...(prior ?? {}) });
  // The index row must drop too — otherwise consumers reading
  // `_index.json` see ghost entries for records whose canonical and alias
  // files have already been removed. `IndexFileReconciler.remove` no-ops
  // if the id isn't present, so this is safe even for "first-ever sync"
  // deletes where no prior row existed.
  indexReconciler.remove(id);
  return { deletes: paths.map((path) => ({ path })) };
}

// -- spaces -----------------------------------------------------------------

async function emitSpaces(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly ConfluenceSpaceEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const indexReconciler = new IndexFileReconciler<ConfluenceSpaceIndexRow>({
    client,
    workspaceId,
    path: confluenceSpacesIndexPath(),
    builder: (rows) => ({
      path: confluenceSpacesIndexPath(),
      content: `${JSON.stringify(
        [...rows].sort(compareSpaceIndexRows),
      )}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });

  const priorReader = new PriorAliasReader(client, workspaceId);

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planSpaceDelete(record.id, priorReader, indexReconciler);
    }
    return planSpaceWrite(record, priorReader, indexReconciler, connectionId);
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);

  return fanOut;
}

async function planSpaceWrite(
  space: ConfluenceSpace,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<ConfluenceSpaceIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(space.id);
  if (!id) {
    return {};
  }

  const name = readNonEmptyString(space.name) ?? readNonEmptyString(space.key);
  const key = readNonEmptyString(space.key);

  const content = renderSpaceContent(space, connectionId, false);

  const newPaths = spacePathsFor({ id, name, key });

  const prior = await priorReader.read<PriorSpaceState>(
    confluenceSpaceByIdAliasPath(id),
    extractPriorSpaceState,
  );
  const stalePaths = prior ? diffPaths(spacePathsFor({ id, ...prior }), newPaths) : [];

  const writes: EmitWrite[] = newPaths.map((path) => ({
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
  }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));

  indexReconciler.upsert(confluenceSpaceIndexRow(space));

  return { writes, deletes };
}

async function planSpaceDelete(
  id: string,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<ConfluenceSpaceIndexRow>,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorSpaceState>(
    confluenceSpaceByIdAliasPath(id),
    extractPriorSpaceState,
  );
  const paths = spacePathsFor({ id, ...(prior ?? {}) });
  // See `planPageDelete` — index row must drop alongside the files.
  indexReconciler.remove(id);
  return { deletes: paths.map((path) => ({ path })) };
}

// -- shared per-object helpers ---------------------------------------------

interface PriorPageState {
  title?: string | undefined;
  status?: string | undefined;
  spaceId?: string | undefined;
  parentId?: string | undefined;
  editedDate?: string | undefined;
}

interface PriorSpaceState {
  name?: string | undefined;
  key?: string | undefined;
}

function pagePathsFor(args: { id: string } & PriorPageState): string[] {
  const { id, title, status, spaceId, parentId, editedDate } = args;
  const paths: string[] = [];
  // Canonical path: title + spaceId derived.
  paths.push(confluencePagePath(id, title, spaceId));
  // by-id (stable reconciliation anchor)
  paths.push(confluencePageByIdAliasPath(id));
  if (title && slugifies(title)) {
    paths.push(confluencePageByTitleAliasPath(title, id));
  }
  if (status) {
    paths.push(confluencePageByStatePath(status, id));
  }
  if (editedDate) {
    paths.push(confluencePageByEditedPath(editedDate, id));
  }
  if (spaceId) {
    paths.push(confluencePageBySpaceAliasPath(spaceId, id));
  }
  if (parentId) {
    paths.push(confluencePageByParentAliasPath(parentId, id));
  }
  return paths;
}

function spacePathsFor(args: { id: string } & PriorSpaceState): string[] {
  const { id, name, key } = args;
  const paths: string[] = [];
  paths.push(confluenceSpacePath(id, name ?? key));
  paths.push(confluenceSpaceByIdAliasPath(id));
  if (name && slugifies(name)) {
    paths.push(confluenceSpaceByTitleAliasPath(name, id));
  }
  if (key) {
    paths.push(confluenceSpaceByKeyAliasPath(key));
  }
  return paths;
}

function diffPaths(prior: readonly string[], next: readonly string[]): string[] {
  const nextSet = new Set(next);
  const seen = new Set<string>();
  const stale: string[] = [];
  for (const p of prior) {
    if (!nextSet.has(p) && !seen.has(p)) {
      seen.add(p);
      stale.push(p);
    }
  }
  return stale;
}

function extractPriorPageState(parsed: Record<string, unknown>): PriorPageState | null {
  // The by-id alias wraps the page payload under `payload` (matches the
  // shape `ConfluenceAdapter.renderContent` writes). Older mounts may have
  // stored the payload at the root; we accept both for compatibility.
  const payload = pickPayload(parsed);
  if (!payload) return null;
  return {
    title: readNonEmptyString(payload.title),
    status: readNonEmptyString(payload.status),
    spaceId:
      readNonEmptyString(payload.spaceId) ?? readNonEmptyString(payload.space_id),
    parentId:
      readNonEmptyString(payload.parentId) ?? readNonEmptyString(payload.parent_id),
    editedDate: editedDateSegment(readPageEditedAt(payload as ConfluencePage)),
  };
}

function extractPriorSpaceState(parsed: Record<string, unknown>): PriorSpaceState | null {
  const payload = pickPayload(parsed);
  if (!payload) return null;
  return {
    name: readNonEmptyString(payload.name) ?? readNonEmptyString(payload.title),
    key: readNonEmptyString(payload.key),
  };
}

function pickPayload(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const wrapped = parsed.payload;
  if (isRecord(wrapped)) {
    return wrapped;
  }
  // Fall back to the parsed object itself (legacy by-id alias shape).
  return parsed;
}

function renderPageContent(
  page: ConfluencePage,
  connectionId: string | undefined,
  deleted: boolean,
): string {
  return JSON.stringify(
    {
      provider: CONFLUENCE_PROVIDER_NAME,
      objectType: 'page',
      objectId: page.id,
      deleted,
      payload: page,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );
}

function renderSpaceContent(
  space: ConfluenceSpace,
  connectionId: string | undefined,
  deleted: boolean,
): string {
  return JSON.stringify(
    {
      provider: CONFLUENCE_PROVIDER_NAME,
      objectType: 'space',
      objectId: space.id,
      deleted,
      payload: space,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );
}

function comparePageIndexRows(left: ConfluencePageIndexRow, right: ConfluencePageIndexRow): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

function compareSpaceIndexRows(left: ConfluenceSpaceIndexRow, right: ConfluenceSpaceIndexRow): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

function isDeleteRecord(
  record: ConfluencePageEmitRecord | ConfluenceSpaceEmitRecord,
): record is { id: string; _deleted: true } {
  return (
    isRecord(record) &&
    (record as { _deleted?: unknown })._deleted === true &&
    typeof (record as { id?: unknown }).id === 'string'
  );
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPageEditedAt(page: ConfluencePage): string | undefined {
  return readNonEmptyString(page.version?.createdAt) ?? readNonEmptyString(page.createdAt);
}

function editedDateSegment(value: string | undefined): string | undefined {
  return value?.match(/^(\d{4}-\d{2}-\d{2})/u)?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Skip by-title aliases for titles that slug to nothing (emoji-only /
 * punctuation-only). The by-id alias still resolves those records.
 *
 * Delegates to the shared `slugifyAlias` per AGENTS.md "NEVER write a
 * new slugifier" rule. `slugifyAlias` returns the literal string
 * `'untitled'` as its empty-slug sentinel.
 */
function slugifies(value: string): boolean {
  return slugifyAlias(value) !== 'untitled';
}

function accumulate(
  aggregate: EmitAuxiliaryFilesResult,
  partial: EmitAuxiliaryFilesResult,
): void {
  aggregate.written += partial.written;
  aggregate.deleted += partial.deleted;
  if (partial.errors.length > 0) {
    aggregate.errors.push(...partial.errors);
  }
}
