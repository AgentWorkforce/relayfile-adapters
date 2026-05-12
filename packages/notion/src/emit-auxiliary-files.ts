/**
 * Adapter-owned auxiliary-file emission for Notion.
 *
 * Phase 2 port of the `emitAuxiliaryFiles` contract introduced in
 * `@relayfile/adapter-core` (Phase 1, relayfile-adapters#78). The shape
 * mirrors `packages/confluence/src/emit-auxiliary-files.ts` exactly so
 * cloud's Phase 3 dispatcher can fan out across providers uniformly.
 *
 * Notion-specific behaviour:
 *
 *   1. **Canonical paths are id-only.** Notion titles and user names are
 *      mutable, so we never embed them in the canonical filename. Pages
 *      land at `/notion/pages/<id>.json` (or
 *      `/notion/databases/<dbId>/pages/<id>.json` when the parent is a
 *      database), databases at `/notion/databases/<id>/metadata.json`,
 *      users at `/notion/users/<id>.json`. This is the Devin finding
 *      from cloud#546 — id-only canonical eliminates a whole class of
 *      "rename strands the canonical file" bugs that confluence's port
 *      has to actively reconcile against.
 *   2. **Aliases use the `<slug>__<short_id>` convention** introduced in
 *      relayfile-adapters#70. The short id is derived deterministically
 *      from the canonical UUID via `aliasShortId`, so duplicate titles
 *      across pages or duplicate display names across users can never
 *      clobber each other.
 *   3. **By-database and by-parent aliases** are page-specific:
 *      - `notionPageByDatabaseAliasPath` when `parent.type === 'database_id'`
 *      - `notionPageByParentAliasPath` when `parent.type === 'page_id'`
 *        or `'block_id'` (blocks live under pages so we treat as page).
 *      We skip `parent.type === 'workspace'` for by-parent — the
 *      workspace root would collect every top-level page and lose its
 *      navigational value (matches `bulk-ingest.ts`).
 *   4. **Reconciliation** is anchored on `notionByIdAliasPath('/notion/pages', id)`
 *      (and the equivalents for databases / users). On every write we
 *      read the prior by-id alias, recover the previous title / database /
 *      parent / parentType / name, recompute the prior alias set, and
 *      delete every alias that no longer applies. Reads degrade to
 *      "no reconciliation" when the client lacks `readFile`, matching
 *      adapter-confluence#69's b2440df pattern.
 *   5. **Deletes** drop every known alias and the `_index.json` row.
 *      Per the Devin finding on relayfile-adapters#78, the index
 *      reconciler MUST be told `.remove(id)` on the delete branch —
 *      otherwise `_index.json` accumulates ghost rows for records whose
 *      canonical and alias files have already been removed.
 *
 * Bots: when this PR landed, `path-mapper.ts` did not expose a
 * `notionBotsAliasPath`. Users with `type === 'bot'` get the `is_bot`
 * flag set on their index row but no separate bots-tree emission. Follow
 * up: add `notionBotsAliasPath` and emit alongside by-name.
 *
 * Root `/notion/_index.json`: confluence and slack do not yet emit a
 * provider-root index in their Phase 1 / Phase 2 ports. We leave this as
 * follow-up so the convention can land uniformly across adapters.
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
  notionByIdAliasPath,
  notionByNameAliasPath,
  notionByTitleAliasPath,
  notionDatabaseMetadataPath,
  notionDatabasePagePath,
  notionDatabasesCollectionPath,
  notionDatabasesIndexPath,
  notionPageByDatabaseAliasPath,
  notionPageByParentAliasPath,
  notionPagesIndexPath,
  notionStandalonePagePath,
  notionStandalonePagesCollectionPath,
  notionUserPath,
  notionUsersCollectionPath,
  notionUsersIndexPath,
} from './path-mapper.js';
import {
  NOTION_PROVIDER_NAME,
  type NotionDatabase,
  type NotionPage,
  type NotionParent,
  type NotionUser,
} from './types.js';

/**
 * Records accepted by `emitNotionAuxiliaryFiles`. Each entry is either a
 * full payload or a `{ id, _deleted: true }` tombstone. Cloud's Phase 3
 * dispatcher will normalize Nango `_deleted_at` records into this shape
 * before routing.
 */
export type NotionPageEmitRecord = NotionPageLike | { id: string; _deleted: true };
export type NotionDatabaseEmitRecord = NotionDatabaseLike | { id: string; _deleted: true };
export type NotionUserEmitRecord = NotionUserLike | { id: string; _deleted: true };

/**
 * Loose page shape accepted by the emitter. We accept both the raw
 * `NotionPage` (with rich-text `properties` and a `parent` union) and
 * the post-normalization shape cloud is moving toward (`title` as a
 * string, `parent_id` / `parent_type` already extracted). The reader
 * accepts whichever fields are present.
 */
export interface NotionPageLike {
  id: string;
  title?: string | null;
  properties?: NotionPage['properties'];
  parent?: NotionParent;
  parent_id?: string | null;
  parent_type?: 'database' | 'page' | 'workspace';
  database_id?: string | null;
  databaseId?: string | null;
  database_title?: string | null;
  databaseTitle?: string | null;
  parent_title?: string | null;
  parentTitle?: string | null;
  last_edited_time?: string;
  lastEditedTime?: string;
  created_time?: string;
  createdTime?: string;
  [key: string]: unknown;
}

export interface NotionDatabaseLike {
  id: string;
  title?: string | NotionDatabase['title'] | null;
  last_edited_time?: string;
  lastEditedTime?: string;
  created_time?: string;
  createdTime?: string;
  [key: string]: unknown;
}

export interface NotionUserLike {
  id: string;
  name?: string | null;
  type?: string | null;
  last_edited_time?: string;
  lastEditedTime?: string;
  created_time?: string;
  createdTime?: string;
  [key: string]: unknown;
}

export interface EmitNotionAuxiliaryFilesInput {
  workspaceId: string;
  pages?: readonly NotionPageEmitRecord[];
  databases?: readonly NotionDatabaseEmitRecord[];
  users?: readonly NotionUserEmitRecord[];
  /**
   * Optional connection id included in the rendered payload wrapper so
   * downstream readers can route writeback by connection. Mirrors the
   * pattern set by `emitConfluenceAuxiliaryFiles`.
   */
  connectionId?: string;
}

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

interface NotionIndexRow {
  id: string;
  title: string;
  updated: string;
  parent_id: string | null;
  parent_type: 'database' | 'page' | 'workspace';
}

interface NotionUserIndexRow {
  id: string;
  title: string;
  updated: string;
  is_bot: boolean;
}

/**
 * Phase-2 entry point. Cloud's Phase 3 dispatcher will iterate
 * `(provider, records)` tuples and call this with the appropriate
 * `pages` / `databases` / `users` slice.
 */
export async function emitNotionAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: EmitNotionAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const workspaceId = input.workspaceId;
  const pages = input.pages ?? [];
  const databases = input.databases ?? [];
  const users = input.users ?? [];

  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  if (pages.length === 0 && databases.length === 0 && users.length === 0) {
    return aggregate;
  }

  if (pages.length > 0) {
    accumulate(aggregate, await emitPages(client, workspaceId, pages, input.connectionId));
  }
  if (databases.length > 0) {
    accumulate(aggregate, await emitDatabases(client, workspaceId, databases, input.connectionId));
  }
  if (users.length > 0) {
    accumulate(aggregate, await emitUsers(client, workspaceId, users, input.connectionId));
  }

  return aggregate;
}

// -- pages ------------------------------------------------------------------

async function emitPages(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly NotionPageEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const indexReconciler = new IndexFileReconciler<NotionIndexRow>({
    client,
    workspaceId,
    path: notionPagesIndexPath(),
    builder: (rows) => ({
      path: notionPagesIndexPath(),
      content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });
  const priorReader = new PriorAliasReader(client, workspaceId);
  const pagesScope = notionStandalonePagesCollectionPath();

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planPageDelete(record.id, priorReader, indexReconciler, pagesScope);
    }
    return planPageWrite(record, priorReader, indexReconciler, pagesScope, connectionId);
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);
  return fanOut;
}

async function planPageWrite(
  page: NotionPageLike,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<NotionIndexRow>,
  pagesScope: string,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(page.id);
  if (!id) return {};

  const state = derivePageState(page);
  const content = renderPageContent(page, connectionId, false);
  const newPaths = pagePathsFor({ id, ...state }, pagesScope);

  const prior = await priorReader.read<PriorPageState>(
    notionByIdAliasPath(pagesScope, id),
    extractPriorPageState,
  );
  const stalePaths = prior ? diffPaths(pagePathsFor({ id, ...prior }, pagesScope), newPaths) : [];

  const writes: EmitWrite[] = newPaths.map((path) => ({ path, content, contentType: JSON_CONTENT_TYPE }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));

  indexReconciler.upsert(buildPageIndexRow(id, state, page));
  return { writes, deletes };
}

async function planPageDelete(
  id: string,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<NotionIndexRow>,
  pagesScope: string,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorPageState>(
    notionByIdAliasPath(pagesScope, id),
    extractPriorPageState,
  );
  const paths = pagePathsFor({ id, ...(prior ?? {}) }, pagesScope);
  indexReconciler.remove(id);
  return { deletes: paths.map((path) => ({ path })) };
}

// -- databases --------------------------------------------------------------

async function emitDatabases(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly NotionDatabaseEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const indexReconciler = new IndexFileReconciler<NotionIndexRow>({
    client,
    workspaceId,
    path: notionDatabasesIndexPath(),
    builder: (rows) => ({
      path: notionDatabasesIndexPath(),
      content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });
  const priorReader = new PriorAliasReader(client, workspaceId);
  const databasesScope = notionDatabasesCollectionPath();

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planDatabaseDelete(record.id, priorReader, indexReconciler, databasesScope);
    }
    return planDatabaseWrite(record, priorReader, indexReconciler, databasesScope, connectionId);
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);
  return fanOut;
}

async function planDatabaseWrite(
  database: NotionDatabaseLike,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<NotionIndexRow>,
  databasesScope: string,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(database.id);
  if (!id) return {};

  const title = readDatabaseTitle(database);
  const content = renderDatabaseContent(database, connectionId, false);
  const newPaths = databasePathsFor({ id, title }, databasesScope);

  const prior = await priorReader.read<PriorDatabaseState>(
    notionByIdAliasPath(databasesScope, id),
    extractPriorDatabaseState,
  );
  const stalePaths = prior ? diffPaths(databasePathsFor({ id, ...prior }, databasesScope), newPaths) : [];

  const writes: EmitWrite[] = newPaths.map((path) => ({ path, content, contentType: JSON_CONTENT_TYPE }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));

  indexReconciler.upsert(buildDatabaseIndexRow(id, title, database));
  return { writes, deletes };
}

async function planDatabaseDelete(
  id: string,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<NotionIndexRow>,
  databasesScope: string,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorDatabaseState>(
    notionByIdAliasPath(databasesScope, id),
    extractPriorDatabaseState,
  );
  const paths = databasePathsFor({ id, ...(prior ?? {}) }, databasesScope);
  indexReconciler.remove(id);
  return { deletes: paths.map((path) => ({ path })) };
}

// -- users ------------------------------------------------------------------

async function emitUsers(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly NotionUserEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const indexReconciler = new IndexFileReconciler<NotionUserIndexRow>({
    client,
    workspaceId,
    path: notionUsersIndexPath(),
    builder: (rows) => ({
      path: notionUsersIndexPath(),
      content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });
  const priorReader = new PriorAliasReader(client, workspaceId);
  const usersScope = notionUsersCollectionPath();

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planUserDelete(record.id, priorReader, indexReconciler, usersScope);
    }
    return planUserWrite(record, priorReader, indexReconciler, usersScope, connectionId);
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);
  return fanOut;
}

async function planUserWrite(
  user: NotionUserLike,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<NotionUserIndexRow>,
  usersScope: string,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(user.id);
  if (!id) return {};

  const name = readNonEmptyString(user.name);
  const isBot = readUserIsBot(user);
  const content = renderUserContent(user, connectionId, false);
  const newPaths = userPathsFor({ id, name }, usersScope);

  const prior = await priorReader.read<PriorUserState>(
    notionByIdAliasPath(usersScope, id),
    extractPriorUserState,
  );
  const stalePaths = prior ? diffPaths(userPathsFor({ id, ...prior }, usersScope), newPaths) : [];

  const writes: EmitWrite[] = newPaths.map((path) => ({ path, content, contentType: JSON_CONTENT_TYPE }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));

  indexReconciler.upsert(buildUserIndexRow(id, name, isBot, user));
  return { writes, deletes };
}

async function planUserDelete(
  id: string,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<NotionUserIndexRow>,
  usersScope: string,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorUserState>(
    notionByIdAliasPath(usersScope, id),
    extractPriorUserState,
  );
  const paths = userPathsFor({ id, ...(prior ?? {}) }, usersScope);
  indexReconciler.remove(id);
  return { deletes: paths.map((path) => ({ path })) };
}

// -- path computation -------------------------------------------------------

interface PriorPageState {
  title?: string | undefined;
  databaseId?: string | undefined;
  databaseTitle?: string | undefined;
  parentType?: 'database' | 'page' | 'workspace' | undefined;
  parentId?: string | undefined;
  parentTitle?: string | undefined;
}

interface PriorDatabaseState {
  title?: string | undefined;
}

interface PriorUserState {
  name?: string | undefined;
}

function pagePathsFor(args: { id: string } & PriorPageState, pagesScope: string): string[] {
  const { id, title, databaseId, databaseTitle, parentType, parentId, parentTitle } = args;
  const paths: string[] = [];

  // Canonical: id-only, nested under the owning database when applicable.
  // Titles are mutable; never embed in canonical (Devin finding,
  // cloud#546 — see file header).
  if (parentType === 'database' && databaseId) {
    paths.push(notionDatabasePagePath(databaseId, id));
  } else {
    paths.push(notionStandalonePagePath(id));
  }

  // by-id (stable reconciliation anchor)
  paths.push(notionByIdAliasPath(pagesScope, id));

  if (title && slugifies(title)) {
    paths.push(notionByTitleAliasPath(pagesScope, title, id));
  }

  // by-database: only when the page lives in a database AND we have both
  // titles to slug. The helper throws on empty slugs so we guard at the
  // call site.
  if (
    parentType === 'database' &&
    databaseId &&
    databaseTitle &&
    slugifies(databaseTitle) &&
    title &&
    slugifies(title)
  ) {
    paths.push(notionPageByDatabaseAliasPath(databaseId, id, databaseTitle, title));
  }

  // by-parent: only for pages whose parent is another page. Database-rooted
  // pages already get a by-database alias (the previous branch), and
  // workspace-rooted pages have no meaningful parent to key on — both must
  // be excluded here. The earlier `parentType !== 'workspace'` guard was
  // too permissive: it also admitted `parentType === 'database'`, so a
  // database row emitted BOTH by-database AND by-parent aliases pointing at
  // the same database id, polluting `/notion/pages/by-parent/`. The
  // `PriorPageState.parentType` union only enumerates `'database' | 'page'
  // | 'workspace'` because the adapter normalizes Notion's raw `block_id`
  // parents to `'page'` during ingestion (blocks always live under pages),
  // so a `parentType === 'page'` test is sufficient and exhaustive.
  if (
    parentType === 'page' &&
    parentId &&
    title &&
    slugifies(title)
  ) {
    paths.push(
      notionPageByParentAliasPath(
        parentType,
        parentId,
        id,
        parentTitle,
        title,
      ),
    );
  }

  return paths;
}

function databasePathsFor(args: { id: string } & PriorDatabaseState, databasesScope: string): string[] {
  const { id, title } = args;
  const paths: string[] = [];
  paths.push(notionDatabaseMetadataPath(id));
  paths.push(notionByIdAliasPath(databasesScope, id));
  if (title && slugifies(title)) {
    paths.push(notionByTitleAliasPath(databasesScope, title, id));
  }
  return paths;
}

function userPathsFor(args: { id: string } & PriorUserState, usersScope: string): string[] {
  const { id, name } = args;
  const paths: string[] = [];
  paths.push(notionUserPath(id));
  paths.push(notionByIdAliasPath(usersScope, id));
  if (name && slugifies(name)) {
    paths.push(notionByNameAliasPath(usersScope, name, id));
  }
  // Bots: `notionBotsAliasPath` is not yet defined in path-mapper.ts.
  // Follow-up: add the helper and emit alongside by-name when
  // `is_bot === true`. For now, the `is_bot` flag on the index row is
  // the only bot discrimination surface.
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

// -- state derivation -------------------------------------------------------

function derivePageState(page: NotionPageLike): PriorPageState {
  const title = readPageTitle(page);
  // Accept both the raw Notion parent union AND the post-normalization
  // `parent_type` / `parent_id` cloud emits. Whichever is present wins.
  const fromParent = readParent(page.parent);
  const parentType =
    (page.parent_type as PriorPageState['parentType'] | undefined) ?? fromParent.type;
  const parentId =
    readNonEmptyString(page.parent_id ?? undefined) ?? fromParent.id ?? undefined;

  const databaseId =
    readNonEmptyString(page.database_id ?? undefined) ??
    readNonEmptyString(page.databaseId ?? undefined) ??
    (parentType === 'database' ? parentId : undefined);

  const databaseTitle =
    readNonEmptyString(page.database_title ?? undefined) ??
    readNonEmptyString(page.databaseTitle ?? undefined);

  const parentTitle =
    readNonEmptyString(page.parent_title ?? undefined) ??
    readNonEmptyString(page.parentTitle ?? undefined);

  return { title, databaseId, databaseTitle, parentType, parentId, parentTitle };
}

function readPageTitle(page: NotionPageLike): string | undefined {
  const direct = readNonEmptyString(page.title);
  if (direct) return direct;
  // Fall back to the canonical Notion title property when callers pass
  // raw API records. `findPageTitle` in pages/ingestion.ts does the same
  // walk; we duplicate it here to avoid pulling the whole ingestion
  // module (which would drag in the API client).
  const properties = page.properties;
  if (!properties) return undefined;
  for (const value of Object.values(properties)) {
    if (value && (value as { type?: unknown }).type === 'title') {
      const rich = (value as { title?: Array<{ plain_text?: string }> }).title ?? [];
      const joined = rich.map((r) => r.plain_text ?? '').join('').trim();
      if (joined) return joined;
    }
  }
  return undefined;
}

function readDatabaseTitle(database: NotionDatabaseLike): string | undefined {
  const raw = database.title;
  if (typeof raw === 'string') {
    return readNonEmptyString(raw);
  }
  if (Array.isArray(raw)) {
    const joined = raw.map((r) => (r as { plain_text?: string })?.plain_text ?? '').join('').trim();
    return joined || undefined;
  }
  return undefined;
}

function readUserIsBot(user: NotionUserLike): boolean {
  return readNonEmptyString(user.type) === 'bot';
}

function readParent(parent: NotionParent | undefined): {
  id: string | undefined;
  type: PriorPageState['parentType'];
} {
  if (!parent || typeof parent !== 'object') return { id: undefined, type: undefined };
  if (parent.type === 'database_id') return { id: readNonEmptyString(parent.database_id), type: 'database' };
  if (parent.type === 'page_id') return { id: readNonEmptyString(parent.page_id), type: 'page' };
  if (parent.type === 'block_id') return { id: readNonEmptyString(parent.block_id), type: 'page' };
  if (parent.type === 'workspace') return { id: undefined, type: 'workspace' };
  return { id: undefined, type: undefined };
}

// -- prior alias extractors -------------------------------------------------

function extractPriorPageState(parsed: Record<string, unknown>): PriorPageState | null {
  const payload = pickPayload(parsed);
  if (!payload) return null;
  // The payload may itself carry the derived `parent_id` / `parent_type`
  // (when cloud emits the normalized shape) OR a raw `parent` union. Try
  // both so we recover whichever was written.
  const fromParent = readParent(payload.parent as NotionParent | undefined);
  const parentType =
    (readNonEmptyString(payload.parent_type) as PriorPageState['parentType'] | undefined) ??
    fromParent.type;
  const parentId = readNonEmptyString(payload.parent_id) ?? fromParent.id;

  const databaseId =
    readNonEmptyString(payload.database_id) ??
    readNonEmptyString(payload.databaseId) ??
    (parentType === 'database' ? parentId : undefined);

  // Mirror `readPageTitle`'s shape detection: check the top-level `title`
  // first, then fall back to the raw Notion `properties` map. Without the
  // fallback, prior payloads written in the raw API shape (title only
  // inside `properties`) report `title: undefined`, the old by-title
  // alias is excluded from the stale-path diff, and the stale file leaks
  // across renames. Delegate to `readPageTitle` so the two code paths
  // stay in lockstep by construction.
  const title = readPageTitle(payload as NotionPageLike);

  return {
    title,
    databaseId,
    databaseTitle:
      readNonEmptyString(payload.database_title) ?? readNonEmptyString(payload.databaseTitle),
    parentType,
    parentId,
    parentTitle:
      readNonEmptyString(payload.parent_title) ?? readNonEmptyString(payload.parentTitle),
  };
}

function extractPriorDatabaseState(parsed: Record<string, unknown>): PriorDatabaseState | null {
  const payload = pickPayload(parsed);
  if (!payload) return null;
  // Database title can land as a string OR as a Notion rich-text array
  // (when the raw API record is wrapped). Handle both.
  const rawTitle = payload.title;
  if (typeof rawTitle === 'string') {
    return { title: readNonEmptyString(rawTitle) };
  }
  if (Array.isArray(rawTitle)) {
    const joined = rawTitle.map((r) => (r as { plain_text?: string })?.plain_text ?? '').join('').trim();
    return { title: joined || undefined };
  }
  return { title: undefined };
}

function extractPriorUserState(parsed: Record<string, unknown>): PriorUserState | null {
  const payload = pickPayload(parsed);
  if (!payload) return null;
  return { name: readNonEmptyString(payload.name) };
}

function pickPayload(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const wrapped = parsed.payload;
  if (isRecord(wrapped)) return wrapped;
  return parsed;
}

// -- rendering --------------------------------------------------------------

function renderPageContent(page: NotionPageLike, connectionId: string | undefined, deleted: boolean): string {
  return JSON.stringify(
    {
      provider: NOTION_PROVIDER_NAME,
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

function renderDatabaseContent(database: NotionDatabaseLike, connectionId: string | undefined, deleted: boolean): string {
  return JSON.stringify(
    {
      provider: NOTION_PROVIDER_NAME,
      objectType: 'database',
      objectId: database.id,
      deleted,
      payload: database,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );
}

function renderUserContent(user: NotionUserLike, connectionId: string | undefined, deleted: boolean): string {
  return JSON.stringify(
    {
      provider: NOTION_PROVIDER_NAME,
      objectType: 'user',
      objectId: user.id,
      deleted,
      payload: user,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );
}

// -- index rows -------------------------------------------------------------

function buildPageIndexRow(id: string, state: PriorPageState, page: NotionPageLike): NotionIndexRow {
  return {
    id,
    title: state.title ?? '',
    updated: normalizeUpdated(page.last_edited_time, page.lastEditedTime, page.created_time, page.createdTime),
    parent_id: state.parentId ?? null,
    parent_type: state.parentType ?? 'workspace',
  };
}

function buildDatabaseIndexRow(id: string, title: string | undefined, database: NotionDatabaseLike): NotionIndexRow {
  return {
    id,
    title: title ?? '',
    updated: normalizeUpdated(
      database.last_edited_time,
      database.lastEditedTime,
      database.created_time,
      database.createdTime,
    ),
    parent_id: null,
    parent_type: 'workspace',
  };
}

function buildUserIndexRow(id: string, name: string | undefined, isBot: boolean, user: NotionUserLike): NotionUserIndexRow {
  return {
    id,
    title: name ?? '',
    updated: normalizeUpdated(user.last_edited_time, user.lastEditedTime, user.created_time, user.createdTime),
    is_bot: isBot,
  };
}

function compareIndexRows(left: { updated: string; id: string }, right: { updated: string; id: string }): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

function normalizeUpdated(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return '';
}

// -- misc -------------------------------------------------------------------

function isDeleteRecord(
  record: NotionPageEmitRecord | NotionDatabaseEmitRecord | NotionUserEmitRecord,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Skip by-title / by-name aliases for labels that slug to nothing. The
 * by-id alias still resolves those records. `slugifyAlias` returns the
 * literal string `'untitled'` as its empty-slug sentinel — never
 * hand-roll the check (AGENTS.md "NEVER write a new slugifier" rule).
 */
function slugifies(value: string): boolean {
  return slugifyAlias(value) !== 'untitled';
}

function accumulate(aggregate: EmitAuxiliaryFilesResult, partial: EmitAuxiliaryFilesResult): void {
  aggregate.written += partial.written;
  aggregate.deleted += partial.deleted;
  if (partial.errors.length > 0) {
    aggregate.errors.push(...partial.errors);
  }
}
