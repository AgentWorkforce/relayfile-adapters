import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  PriorAliasReader,
  runEmitBatch,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitPlan,
  type EmitReadResult,
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
  extractXObjectIdFromPath,
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
import { slugifyAlias } from './alias-slug.js';
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
  const resultSearchIdsByPostId = groupResultSearchIdsByPostId(results);
  const resultPostIdsBySearchId = groupResultPostIdsBySearchId(results);
  const collidingSearchQueryIds = aliasCollisionIds(searches.filter(isFullSearch), (search) => search.id, (search) => search.query);
  const collidingUserUsernameIds = aliasCollisionIds(users.filter(isFullUser), (user) => user.id, (user) => user.username);

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
    planSearchRecord(
      record,
      priorReader,
      searchIndex,
      input.connectionId,
      client,
      workspaceId,
      resultPostIdsBySearchId,
      getResultIndex,
      collidingSearchQueryIds,
    ),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, users, (record) =>
    planUserRecord(record, priorReader, userIndex, input.connectionId, collidingUserUsernameIds),
  ));
  const usersById = new Map(users.filter(isFullUser).map((user) => [user.id, user]));
  const postsById = new Map(posts.filter(isFullPost).map((post) => [post.id, post]));
  const resultSearchById = new Map(searches.filter(isFullSearch).map((search) => [search.id, search]));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, posts, (record) =>
    planPostRecord(record, priorReader, postIndex, usersById, resultSearchById, resultSearchIdsByPostId, input.connectionId),
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
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  resultPostIdsBySearchId: ReadonlyMap<string, ReadonlySet<string>>,
  getResultIndex: (searchId: string, titleOrQuery: string | null | undefined) => IndexFileReconciler<XSearchResult>,
  collidingSearchQueryIds: ReadonlySet<string>,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorSearchState>(xSearchByIdAliasPath(record.id), (parsed) =>
    readPriorSearchState(parsed, record.id),
  );
  if (isDeleted(record)) {
    const indexedPrior = prior ?? await readSearchIndexPrior(client, workspaceId, record.id);
    const priorResultDeletes = await staleSearchResultDeletes(record.id, indexedPrior, client, workspaceId, {
      includePostQueryAliases: true,
    });
    index.remove(record.id);
    const title = indexedPrior?.title ?? indexedPrior?.query ?? record.id;
    const query = indexedPrior?.query ?? record.id;
    return {
      deletes: [
        { path: indexedPrior?.canonicalPath ?? xSearchMetaPath(record.id, title) },
        { path: xSearchByIdAliasPath(record.id) },
        ...searchQueryAliasDeletePaths(query, record.id).map((path) => ({ path })),
        ...priorResultDeletes,
      ],
    };
  }

  const queryAliasColliding = collidingSearchQueryIds.has(record.id);
  const priorResultDeletes = await staleSearchResultDeletes(record.id, prior, client, workspaceId);
  const canonicalPath = xSearchMetaPath(record.id, record.title || record.query);
  const titleOrQuery = record.title || record.query;
  const currentResultDeletes = await staleCurrentSearchResultDeletes(
    record.id,
    titleOrQuery,
    resultPostIdsBySearchId.get(record.id) ?? new Set<string>(),
    getResultIndex(record.id, titleOrQuery),
    client,
    workspaceId,
  );
  const envelope = searchEnvelope(record, canonicalPath, connectionId);
  const content = json(envelope);
  const priorCanonicalPath = prior
    ? prior.canonicalPath ?? xSearchMetaPath(record.id, prior.title ?? prior.query ?? record.id)
    : undefined;
  const deletes = staleDeletes([
    priorCanonicalPath && priorCanonicalPath !== canonicalPath ? priorCanonicalPath : undefined,
    ...searchQueryAliasStalePaths(prior?.query, record.query, record.id, queryAliasColliding),
    ...(priorCanonicalPath && priorCanonicalPath !== canonicalPath ? priorResultDeletes.map((deleteInput) => deleteInput.path) : []),
    ...currentResultDeletes.map((deleteInput) => deleteInput.path),
  ]);
  index.upsert(xSearchIndexRow(record));
  return {
    deletes,
    writes: [
      mirrorWrite(canonicalPath, content, searchSemantics(record)),
      mirrorWrite(xSearchByIdAliasPath(record.id), content, searchSemantics(record)),
      mirrorWrite(xSearchByQueryAliasPath(record.query, record.id, queryAliasColliding), content, searchSemantics(record)),
    ],
  };
}

async function planPostRecord(
  record: XPostEmitRecord,
  priorReader: PriorAliasReader,
  index: IndexFileReconciler<XPostIndexRow>,
  usersById: ReadonlyMap<string, XUser>,
  searchesById: ReadonlyMap<string, XSearchRun>,
  resultSearchIdsByPostId: ReadonlyMap<string, readonly string[]>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorPostState>(xPostByIdAliasPath(record.id), (parsed) =>
    readPriorPostState(parsed, record.id),
  );
  if (isDeleted(record)) {
    index.remove(record.id);
    return {
      deletes: staleDeletes([
        prior?.canonicalPath ?? xPostPath(record.id, prior?.text),
        xPostByIdAliasPath(record.id),
        prior?.authorKey ? xPostByAuthorAliasPath(prior.authorKey, record.id) : undefined,
        prior?.conversationId ? xPostByConversationAliasPath(prior.conversationId, record.id) : undefined,
        ...(prior?.searchIds ?? []).map((searchId) => xPostByQueryAliasPath(searchId, record.id)),
      ]),
    };
  }

  const author = record.author_id ? usersById.get(record.author_id) : undefined;
  const authorKey = author?.username ?? record.author_id;
  const searchIds = resultSearchIdsByPostId.get(record.id) ?? [];
  const searchIdSet = new Set(searchIds);
  const canonicalPath = xPostPath(record.id, postTitle(record));
  const envelope = postEnvelope(record, canonicalPath, searchIds, author, connectionId);
  const content = json(envelope);
  const priorCanonicalPath = prior
    ? prior.canonicalPath ?? xPostPath(record.id, prior.text)
    : undefined;
  const deletes = staleDeletes([
    priorCanonicalPath && priorCanonicalPath !== canonicalPath ? priorCanonicalPath : undefined,
    prior?.authorKey && prior.authorKey !== authorKey ? xPostByAuthorAliasPath(prior.authorKey, record.id) : undefined,
    prior?.conversationId && prior.conversationId !== record.conversation_id
      ? xPostByConversationAliasPath(prior.conversationId, record.id)
      : undefined,
    ...(prior?.searchIds ?? [])
      .filter((searchId) => !searchIdSet.has(searchId))
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
  collidingUserUsernameIds: ReadonlySet<string>,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorUserState>(xUserByIdAliasPath(record.id), (parsed) =>
    readPriorUserState(parsed, record.id),
  );
  if (isDeleted(record)) {
    index.remove(record.id);
    return {
      deletes: staleDeletes([
        prior?.canonicalPath ?? xUserPath(record.id, prior?.username ?? prior?.name),
        xUserByIdAliasPath(record.id),
        ...(prior?.username ? userUsernameAliasDeletePaths(prior.username, record.id) : []),
      ]),
    };
  }

  const usernameAliasColliding = record.username ? collidingUserUsernameIds.has(record.id) : false;
  const label = record.username ?? record.name;
  const canonicalPath = xUserPath(record.id, label);
  const envelope = userEnvelope(record, canonicalPath, connectionId);
  const content = json(envelope);
  const priorCanonicalPath = prior
    ? prior.canonicalPath ?? xUserPath(record.id, prior.username ?? prior.name)
    : undefined;
  const deletes = staleDeletes([
    priorCanonicalPath && priorCanonicalPath !== canonicalPath ? priorCanonicalPath : undefined,
    ...userUsernameAliasStalePaths(prior?.username, record.username, record.id, usernameAliasColliding),
  ]);
  index.upsert(xUserIndexRow(record));
  const writes: EmitWrite[] = [
    mirrorWrite(canonicalPath, content, userSemantics(record)),
    mirrorWrite(xUserByIdAliasPath(record.id), content, userSemantics(record)),
  ];
  if (record.username) {
    writes.push(mirrorWrite(xUserByUsernameAliasPath(record.username, record.id, usernameAliasColliding), content, userSemantics(record)));
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

function aliasCollisionIds<T>(
  records: readonly T[],
  getId: (record: T) => string,
  getAliasKey: (record: T) => string | null | undefined,
): ReadonlySet<string> {
  const buckets = new Map<string, string[]>();
  for (const record of records) {
    const aliasKey = getAliasKey(record);
    if (!aliasKey) continue;
    const slug = slugifyAlias(aliasKey);
    const ids = buckets.get(slug) ?? [];
    const id = getId(record);
    if (!ids.includes(id)) ids.push(id);
    buckets.set(slug, ids);
  }
  const colliding = new Set<string>();
  for (const ids of buckets.values()) {
    if (ids.length > 1) {
      for (const id of ids) colliding.add(id);
    }
  }
  return colliding;
}

function searchQueryAliasDeletePaths(query: string, searchId: string): string[] {
  return [...new Set([
    xSearchByQueryAliasPath(query, searchId),
    xSearchByQueryAliasPath(query, searchId, true),
  ])];
}

function searchQueryAliasStalePaths(
  priorQuery: string | undefined,
  currentQuery: string,
  searchId: string,
  currentColliding: boolean,
): string[] {
  const paths = new Set<string>();
  if (priorQuery && priorQuery !== currentQuery) {
    for (const path of searchQueryAliasDeletePaths(priorQuery, searchId)) paths.add(path);
  }
  paths.add(xSearchByQueryAliasPath(currentQuery, searchId, !currentColliding));
  return [...paths];
}

function userUsernameAliasDeletePaths(username: string, userId: string): string[] {
  return [...new Set([
    xUserByUsernameAliasPath(username, userId),
    xUserByUsernameAliasPath(username, userId, true),
  ])];
}

function userUsernameAliasStalePaths(
  priorUsername: string | undefined,
  currentUsername: string | undefined,
  userId: string,
  currentColliding: boolean,
): string[] {
  const paths = new Set<string>();
  if (priorUsername && priorUsername !== currentUsername) {
    for (const path of userUsernameAliasDeletePaths(priorUsername, userId)) paths.add(path);
  }
  if (currentUsername) {
    paths.add(xUserByUsernameAliasPath(currentUsername, userId, !currentColliding));
  }
  return [...paths];
}

function groupResultSearchIdsByPostId(results: readonly XSearchResult[]): Map<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const result of results) {
    const searchIds = grouped.get(result.postId) ?? [];
    if (!searchIds.includes(result.searchId)) {
      searchIds.push(result.searchId);
      grouped.set(result.postId, searchIds);
    }
  }
  return grouped;
}

function groupResultPostIdsBySearchId(results: readonly XSearchResult[]): Map<string, ReadonlySet<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const result of results) {
    const postIds = grouped.get(result.searchId) ?? new Set<string>();
    postIds.add(result.postId);
    grouped.set(result.searchId, postIds);
  }
  return grouped;
}

async function staleSearchResultDeletes(
  searchId: string,
  prior: PriorSearchState | null,
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  options: { includePostQueryAliases?: boolean } = {},
): Promise<Array<{ path: string }>> {
  const titleOrQuery = prior?.title ?? prior?.query;
  if (!titleOrQuery) return [];
  const indexPath = xSearchResultsIndexPath(searchId, titleOrQuery);
  const priorResults = await readPriorSearchResultsIndex(client, workspaceId, indexPath);
  return staleDeletes([
    indexPath,
    ...(priorResults ?? []).map((result) => xSearchResultPath(searchId, titleOrQuery, result.postId)),
    ...(options.includePostQueryAliases
      ? (priorResults ?? []).map((result) => xPostByQueryAliasPath(searchId, result.postId))
      : []),
  ]);
}

async function staleCurrentSearchResultDeletes(
  searchId: string,
  titleOrQuery: string,
  currentPostIds: ReadonlySet<string>,
  resultIndex: IndexFileReconciler<XSearchResult>,
  client: AuxiliaryEmitterClient,
  workspaceId: string,
): Promise<Array<{ path: string }>> {
  const priorResults = await readPriorSearchResultsIndex(client, workspaceId, xSearchResultsIndexPath(searchId, titleOrQuery));
  if (!priorResults) return [];
  const staleResults = priorResults.filter((result) => !currentPostIds.has(result.postId));
  resultIndex.remove(...staleResults.map((result) => result.id));
  return staleDeletes(staleResults.map((result) => xSearchResultPath(searchId, titleOrQuery, result.postId)));
}

async function readPriorSearchResultsIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): Promise<readonly XSearchResult[] | null> {
  if (!client.readFile) return null;
  let raw: EmitReadResult | null | undefined;
  try {
    raw = await client.readFile({ workspaceId, path });
  } catch {
    return null;
  }
  if (!raw || typeof raw.content !== 'string' || raw.content.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.content);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.filter((item): item is XSearchResult => {
    return typeof item === 'object'
      && item !== null
      && typeof (item as { postId?: unknown }).postId === 'string'
      && typeof (item as { searchId?: unknown }).searchId === 'string';
  });
}

function readPriorSearchState(parsed: Record<string, unknown>, searchId: string): PriorSearchState | null {
  const canonicalPath = trustedPriorCanonicalPath(readString(parsed.canonicalPath), 'search', searchId);
  const title = readString(parsed.title);
  const query = readString(parsed.query);
  if (!canonicalPath && !title && !query) return null;
  return {
    ...(canonicalPath ? { canonicalPath } : {}),
    ...(title ? { title } : {}),
    ...(query ? { query } : {}),
  };
}

async function readSearchIndexPrior(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  searchId: string,
): Promise<PriorSearchState | null> {
  try {
    const raw = await client.readFile?.({ workspaceId, path: xSearchesIndexPath() });
    if (!raw || typeof raw.content !== 'string') return null;
    const parsed = JSON.parse(raw.content) as unknown;
    if (!Array.isArray(parsed)) return null;
    const row = parsed.find((entry) => (
      typeof entry === 'object'
      && entry !== null
      && !Array.isArray(entry)
      && (entry as { id?: unknown }).id === searchId
    ));
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    const title = readString(record.title);
    const query = readString(record.query);
    return {
      canonicalPath: xSearchMetaPath(searchId, title ?? query ?? searchId),
      ...(title ? { title } : {}),
      ...(query ? { query } : {}),
    };
  } catch {
    return null;
  }
}

function readPriorPostState(parsed: Record<string, unknown>, postId: string): PriorPostState | null {
  const canonicalPath = trustedPriorCanonicalPath(readString(parsed.canonicalPath), 'post', postId);
  const authorKey = readString(parsed.authorKey) ?? readStringPath(parsed, ['author', 'username']) ?? readStringPath(parsed, ['payload', 'author_id']);
  const conversationId = readString(parsed.conversationId) ?? readStringPath(parsed, ['payload', 'conversation_id']);
  const text = readStringPath(parsed, ['payload', 'text']);
  const searchIds = Array.isArray(parsed.searchIds) ? parsed.searchIds.filter((item): item is string => typeof item === 'string') : [];
  if (!canonicalPath && !authorKey && !conversationId && !text && searchIds.length === 0) return null;
  return {
    ...(canonicalPath ? { canonicalPath } : {}),
    ...(authorKey ? { authorKey } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(text ? { text } : {}),
    searchIds,
  };
}

function readPriorUserState(parsed: Record<string, unknown>, userId: string): PriorUserState | null {
  const canonicalPath = trustedPriorCanonicalPath(readString(parsed.canonicalPath), 'user', userId);
  const username = readString(parsed.username) ?? readStringPath(parsed, ['payload', 'username']);
  const name = readStringPath(parsed, ['payload', 'name']);
  if (!canonicalPath && !username && !name) return null;
  return {
    ...(canonicalPath ? { canonicalPath } : {}),
    ...(username ? { username } : {}),
    ...(name ? { name } : {}),
  };
}

function trustedPriorCanonicalPath(
  canonicalPath: string | undefined,
  objectType: 'search' | 'post' | 'user',
  objectId: string,
): string | undefined {
  if (!canonicalPath || !isXCanonicalPathForType(canonicalPath, objectType)) return undefined;
  try {
    return extractXObjectIdFromPath(canonicalPath) === objectId ? canonicalPath : undefined;
  } catch {
    return undefined;
  }
}

function isXCanonicalPathForType(path: string, objectType: 'search' | 'post' | 'user'): boolean {
  switch (objectType) {
    case 'search':
      return /^\/x\/searches\/(?!by-[^/]+\/)[^/]+\/meta\.json$/u.test(path);
    case 'post':
      return /^\/x\/posts\/(?!by-[^/]+\/)[^/]+\.json$/u.test(path);
    case 'user':
      return /^\/x\/users\/(?!by-[^/]+\/)[^/]+\.json$/u.test(path);
  }
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
  canonicalPath?: string;
  title?: string;
  query?: string;
}

interface PriorPostState {
  canonicalPath?: string;
  authorKey?: string;
  conversationId?: string;
  text?: string;
  searchIds: string[];
}

interface PriorUserState {
  canonicalPath?: string;
  username?: string;
  name?: string;
}
