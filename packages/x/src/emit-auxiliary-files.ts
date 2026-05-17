import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  PriorAliasReader,
  runEmitBatch,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import {
  buildXPostsIndexFile,
  buildXRootIndexFile,
  buildXSearchesIndexFile,
  buildXSearchResultsIndexFile,
  buildXUsersIndexFile,
  postTitle,
  xPostIndexRow,
  xSearchIndexRow,
  xUserIndexRow,
} from './index-emitter.js';
import { xLayoutPromptFile } from './layout-prompt.js';
import {
  xPostByAuthorAliasPath,
  xPostByConversationAliasPath,
  xPostByIdAliasPath,
  xPostByQueryAliasPath,
  xPostPath,
  xPostsIndexPath,
  xSearchByIdAliasPath,
  xSearchByQueryAliasPath,
  xSearchMetaPath,
  xSearchResultPath,
  xSearchResultsIndexPath,
  xSearchesIndexPath,
  xUserByIdAliasPath,
  xUserByUsernameAliasPath,
  xUserPath,
  xUsersIndexPath,
} from './path-mapper.js';
import type {
  XPost,
  XPostIndexRow,
  XSearchBundle,
  XSearchIndexRow,
  XSearchResult,
  XSearchRun,
  XUser,
  XUserIndexRow,
} from './types.js';

const X_PROVIDER_NAME = 'x';
const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export type XSearchEmitRecord = XSearchRun | { id: string; _deleted: true };
export type XPostEmitRecord = XPost | { id: string; _deleted: true };
export type XUserEmitRecord = XUser | { id: string; _deleted: true };

export interface XEmitAuxiliaryFilesInput {
  workspaceId: string;
  bundles?: readonly XSearchBundle[];
  searches?: readonly XSearchEmitRecord[];
  posts?: readonly XPostEmitRecord[];
  users?: readonly XUserEmitRecord[];
  results?: readonly XSearchResult[];
  connectionId?: string;
}

export async function emitXAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: XEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const workspaceId = input.workspaceId;
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };
  await writeStaticFiles(client, workspaceId, aggregate);

  const bundles = input.bundles ?? [];
  const searches = [...(input.searches ?? []), ...bundles.map((bundle) => bundle.run)];
  const posts = [...(input.posts ?? []), ...bundles.flatMap((bundle) => bundle.posts)];
  const users = [...(input.users ?? []), ...bundles.flatMap((bundle) => bundle.users)];
  const results = [...(input.results ?? []), ...bundles.flatMap((bundle) => bundle.results)];

  const priorReader = new PriorAliasReader(client, workspaceId);
  const searchIndex = new IndexFileReconciler<XSearchIndexRow>({
    client,
    workspaceId,
    path: xSearchesIndexPath(),
    builder: buildXSearchesIndexFile,
  });
  const postIndex = new IndexFileReconciler<XPostIndexRow>({
    client,
    workspaceId,
    path: xPostsIndexPath(),
    builder: buildXPostsIndexFile,
  });
  const userIndex = new IndexFileReconciler<XUserIndexRow>({
    client,
    workspaceId,
    path: xUsersIndexPath(),
    builder: buildXUsersIndexFile,
  });
  const resultIndexes = new Map<string, IndexFileReconciler<XSearchResult>>();
  const getResultIndex = (searchId: string, titleOrQuery: string | null | undefined) => {
    const key = `${searchId}\0${titleOrQuery ?? ''}`;
    let reconciler = resultIndexes.get(key);
    if (!reconciler) {
      reconciler = new IndexFileReconciler<XSearchResult>({
        client,
        workspaceId,
        path: xSearchResultsIndexPath(searchId, titleOrQuery),
        builder: (rows) => buildXSearchResultsIndexFile(searchId, titleOrQuery, rows),
      });
      resultIndexes.set(key, reconciler);
    }
    return reconciler;
  };

  accumulate(aggregate, await runEmitBatch(client, workspaceId, searches, (record) =>
    planSearchRecord(record, priorReader, searchIndex, input.connectionId),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, users, (record) =>
    planUserRecord(record, priorReader, userIndex, input.connectionId),
  ));
  const usersById = new Map(users.filter(isFullUser).map((user) => [user.id, user]));
  const postsById = new Map(posts.filter(isFullPost).map((post) => [post.id, post]));
  const resultSearchById = new Map(searches.filter(isFullSearch).map((search) => [search.id, search]));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, posts, (record) =>
    planPostRecord(record, priorReader, postIndex, usersById, resultSearchById, results, input.connectionId),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, results, (record) =>
    planSearchResultRecord(record, resultSearchById.get(record.searchId), postsById, getResultIndex),
  ));

  for (const flush of [
    await searchIndex.flush(),
    await postIndex.flush(),
    await userIndex.flush(),
  ]) {
    aggregate.written += flush.written;
    aggregate.errors.push(...flush.errors);
  }

  for (const reconciler of resultIndexes.values()) {
    const flush = await reconciler.flush();
    aggregate.written += flush.written;
    aggregate.errors.push(...flush.errors);
  }

  return aggregate;
}

async function writeStaticFiles(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  for (const file of [buildXRootIndexFile(), xLayoutPromptFile()]) {
    try {
      await client.writeFile({
        workspaceId,
        path: file.path,
        content: file.content,
        contentType: file.contentType,
      });
      aggregate.written += 1;
    } catch (error) {
      aggregate.errors.push({ path: file.path, error: stringifyError(error) });
    }
  }
}

async function planSearchRecord(
  record: XSearchEmitRecord,
  priorReader: PriorAliasReader,
  index: IndexFileReconciler<XSearchIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorSearchState>(xSearchByIdAliasPath(record.id), readPriorSearchState);
  if (isDeleted(record)) {
    index.remove(record.id);
    const title = prior?.title ?? record.id;
    const query = prior?.query ?? record.id;
    return {
      deletes: [
        { path: prior?.canonicalPath ?? xSearchMetaPath(record.id, title) },
        { path: xSearchByIdAliasPath(record.id) },
        { path: xSearchByQueryAliasPath(query, record.id) },
      ],
    };
  }

  const canonicalPath = xSearchMetaPath(record.id, record.title || record.query);
  const envelope = searchEnvelope(record, canonicalPath, connectionId);
  const content = json(envelope);
  const deletes = staleDeletes([
    prior?.canonicalPath && prior.canonicalPath !== canonicalPath ? prior.canonicalPath : undefined,
    prior?.query && prior.query !== record.query ? xSearchByQueryAliasPath(prior.query, record.id) : undefined,
  ]);
  index.upsert(xSearchIndexRow(record));
  return {
    deletes,
    writes: [
      mirrorWrite(canonicalPath, content, searchSemantics(record)),
      mirrorWrite(xSearchByIdAliasPath(record.id), content, searchSemantics(record)),
      mirrorWrite(xSearchByQueryAliasPath(record.query, record.id), content, searchSemantics(record)),
    ],
  };
}

async function planPostRecord(
  record: XPostEmitRecord,
  priorReader: PriorAliasReader,
  index: IndexFileReconciler<XPostIndexRow>,
  usersById: ReadonlyMap<string, XUser>,
  searchesById: ReadonlyMap<string, XSearchRun>,
  results: readonly XSearchResult[],
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorPostState>(xPostByIdAliasPath(record.id), readPriorPostState);
  if (isDeleted(record)) {
    index.remove(record.id);
    return {
      deletes: staleDeletes([
        prior?.canonicalPath ?? xPostPath(record.id),
        xPostByIdAliasPath(record.id),
        prior?.authorKey ? xPostByAuthorAliasPath(prior.authorKey, record.id) : undefined,
        prior?.conversationId ? xPostByConversationAliasPath(prior.conversationId, record.id) : undefined,
        ...(prior?.searchIds ?? []).map((searchId) => xPostByQueryAliasPath(searchId, record.id)),
      ]),
    };
  }

  const author = record.author_id ? usersById.get(record.author_id) : undefined;
  const authorKey = author?.username ?? record.author_id;
  const searchIds = results.filter((result) => result.postId === record.id).map((result) => result.searchId);
  const canonicalPath = xPostPath(record.id, postTitle(record));
  const envelope = postEnvelope(record, canonicalPath, searchIds, author, connectionId);
  const content = json(envelope);
  const deletes = staleDeletes([
    prior?.canonicalPath && prior.canonicalPath !== canonicalPath ? prior.canonicalPath : undefined,
    prior?.authorKey && prior.authorKey !== authorKey ? xPostByAuthorAliasPath(prior.authorKey, record.id) : undefined,
    prior?.conversationId && prior.conversationId !== record.conversation_id
      ? xPostByConversationAliasPath(prior.conversationId, record.id)
      : undefined,
    ...(prior?.searchIds ?? [])
      .filter((searchId) => !searchIds.includes(searchId))
      .map((searchId) => xPostByQueryAliasPath(searchId, record.id)),
  ]);
  index.upsert(xPostIndexRow(record, author?.username));

  const writes: EmitWrite[] = [
    mirrorWrite(canonicalPath, content, postSemantics(record, searchIds)),
    mirrorWrite(xPostByIdAliasPath(record.id), content, postSemantics(record, searchIds)),
  ];
  if (authorKey) writes.push(mirrorWrite(xPostByAuthorAliasPath(authorKey, record.id), content, postSemantics(record, searchIds)));
  if (record.conversation_id) {
    writes.push(mirrorWrite(xPostByConversationAliasPath(record.conversation_id, record.id), content, postSemantics(record, searchIds)));
  }
  for (const searchId of searchIds) {
    if (searchesById.has(searchId)) {
      writes.push(mirrorWrite(xPostByQueryAliasPath(searchId, record.id), content, postSemantics(record, searchIds)));
    }
  }
  return { deletes, writes };
}

async function planUserRecord(
  record: XUserEmitRecord,
  priorReader: PriorAliasReader,
  index: IndexFileReconciler<XUserIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorUserState>(xUserByIdAliasPath(record.id), readPriorUserState);
  if (isDeleted(record)) {
    index.remove(record.id);
    return {
      deletes: staleDeletes([
        prior?.canonicalPath ?? xUserPath(record.id),
        xUserByIdAliasPath(record.id),
        prior?.username ? xUserByUsernameAliasPath(prior.username, record.id) : undefined,
      ]),
    };
  }

  const label = record.username ?? record.name;
  const canonicalPath = xUserPath(record.id, label);
  const envelope = userEnvelope(record, canonicalPath, connectionId);
  const content = json(envelope);
  const deletes = staleDeletes([
    prior?.canonicalPath && prior.canonicalPath !== canonicalPath ? prior.canonicalPath : undefined,
    prior?.username && prior.username !== record.username ? xUserByUsernameAliasPath(prior.username, record.id) : undefined,
  ]);
  index.upsert(xUserIndexRow(record));
  const writes: EmitWrite[] = [
    mirrorWrite(canonicalPath, content, userSemantics(record)),
    mirrorWrite(xUserByIdAliasPath(record.id), content, userSemantics(record)),
  ];
  if (record.username) {
    writes.push(mirrorWrite(xUserByUsernameAliasPath(record.username, record.id), content, userSemantics(record)));
  }
  return { deletes, writes };
}

function planSearchResultRecord(
  record: XSearchResult,
  search: XSearchRun | undefined,
  postsById: ReadonlyMap<string, XPost>,
  getIndex: (searchId: string, titleOrQuery: string | null | undefined) => IndexFileReconciler<XSearchResult>,
): EmitPlan {
  const titleOrQuery = search?.title ?? search?.query ?? record.query;
  const canonicalPath = record.canonicalPath ?? xPostPath(record.postId, postsById.get(record.postId)?.text);
  getIndex(record.searchId, titleOrQuery).upsert(record);
  const path = xSearchResultPath(record.searchId, titleOrQuery, record.postId);
  return {
    writes: [
      mirrorWrite(path, json(record), {
        properties: {
          provider: X_PROVIDER_NAME,
          'x.search_id': record.searchId,
          'x.post_id': record.postId,
          'x.rank': String(record.rank),
        },
        relations: [canonicalPath],
      }),
    ],
  };
}

function searchEnvelope(record: XSearchRun, canonicalPath: string, connectionId: string | undefined) {
  return {
    provider: X_PROVIDER_NAME,
    objectType: 'search',
    objectId: record.id,
    canonicalPath,
    ...(connectionId ? { connectionId } : {}),
    query: record.query,
    title: record.title,
    mode: record.mode,
    costEstimate: record.costEstimate,
    budgetUsd: record.budgetUsd,
    payload: record,
  };
}

function postEnvelope(
  record: XPost,
  canonicalPath: string,
  searchIds: readonly string[],
  author: XUser | undefined,
  connectionId: string | undefined,
) {
  return {
    provider: X_PROVIDER_NAME,
    objectType: 'post',
    objectId: record.id,
    canonicalPath,
    ...(connectionId ? { connectionId } : {}),
    searchIds,
    authorKey: author?.username ?? record.author_id,
    conversationId: record.conversation_id,
    ...(author ? { author: { id: author.id, username: author.username, name: author.name } } : {}),
    payload: record,
  };
}

function userEnvelope(record: XUser, canonicalPath: string, connectionId: string | undefined) {
  return {
    provider: X_PROVIDER_NAME,
    objectType: 'user',
    objectId: record.id,
    canonicalPath,
    ...(connectionId ? { connectionId } : {}),
    username: record.username,
    payload: record,
  };
}

function searchSemantics(record: XSearchRun) {
  return {
    properties: {
      provider: X_PROVIDER_NAME,
      'x.search_id': record.id,
      'x.query': record.query,
      'x.mode': record.mode,
      'x.estimated_usd': String(record.costEstimate.estimatedUsd),
    },
  };
}

function postSemantics(record: XPost, searchIds: readonly string[]) {
  return {
    properties: {
      provider: X_PROVIDER_NAME,
      'x.post_id': record.id,
      ...(record.author_id ? { 'x.author_id': record.author_id } : {}),
      ...(record.conversation_id ? { 'x.conversation_id': record.conversation_id } : {}),
      ...(record.lang ? { 'x.lang': record.lang } : {}),
      ...(searchIds.length > 0 ? { 'x.search_ids': searchIds.join(',') } : {}),
    },
  };
}

function userSemantics(record: XUser) {
  return {
    properties: {
      provider: X_PROVIDER_NAME,
      'x.user_id': record.id,
      ...(record.username ? { 'x.username': record.username } : {}),
    },
  };
}

function mirrorWrite(path: string, content: string, semantics?: EmitWrite['semantics']): EmitWrite {
  return {
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
    ...(semantics ? { semantics } : {}),
  };
}

function staleDeletes(paths: readonly (string | undefined)[]) {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))].map((path) => ({ path }));
}

function readPriorSearchState(parsed: Record<string, unknown>): PriorSearchState | null {
  const canonicalPath = readString(parsed.canonicalPath);
  if (!canonicalPath) return null;
  const title = readString(parsed.title);
  const query = readString(parsed.query);
  return {
    canonicalPath,
    ...(title ? { title } : {}),
    ...(query ? { query } : {}),
  };
}

function readPriorPostState(parsed: Record<string, unknown>): PriorPostState | null {
  const canonicalPath = readString(parsed.canonicalPath);
  if (!canonicalPath) return null;
  const authorKey = readString(parsed.authorKey) ?? readStringPath(parsed, ['author', 'username']) ?? readStringPath(parsed, ['payload', 'author_id']);
  const conversationId = readString(parsed.conversationId) ?? readStringPath(parsed, ['payload', 'conversation_id']);
  return {
    canonicalPath,
    ...(authorKey ? { authorKey } : {}),
    ...(conversationId ? { conversationId } : {}),
    searchIds: Array.isArray(parsed.searchIds) ? parsed.searchIds.filter((item): item is string => typeof item === 'string') : [],
  };
}

function readPriorUserState(parsed: Record<string, unknown>): PriorUserState | null {
  const canonicalPath = readString(parsed.canonicalPath);
  if (!canonicalPath) return null;
  const username = readString(parsed.username) ?? readStringPath(parsed, ['payload', 'username']);
  return {
    canonicalPath,
    ...(username ? { username } : {}),
  };
}

function isDeleted(record: unknown): record is { id: string; _deleted: true } {
  return typeof record === 'object'
    && record !== null
    && !Array.isArray(record)
    && (record as { _deleted?: unknown })._deleted === true
    && typeof (record as { id?: unknown }).id === 'string';
}

function isFullSearch(record: XSearchEmitRecord): record is XSearchRun {
  return !isDeleted(record);
}

function isFullPost(record: XPostEmitRecord): record is XPost {
  return !isDeleted(record);
}

function isFullUser(record: XUserEmitRecord): record is XUser {
  return !isDeleted(record);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readStringPath(record: Record<string, unknown>, path: readonly string[]): string | undefined {
  let current: unknown = record;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return readString(current);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function accumulate(target: EmitAuxiliaryFilesResult, next: EmitAuxiliaryFilesResult): void {
  target.written += next.written;
  target.deleted += next.deleted;
  target.errors.push(...next.errors);
}

interface PriorSearchState {
  canonicalPath: string;
  title?: string;
  query?: string;
}

interface PriorPostState {
  canonicalPath: string;
  authorKey?: string;
  conversationId?: string;
  searchIds: string[];
}

interface PriorUserState {
  canonicalPath: string;
  username?: string;
}
