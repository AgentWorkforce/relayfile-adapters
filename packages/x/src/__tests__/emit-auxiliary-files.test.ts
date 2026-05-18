import assert from 'node:assert/strict';
import test from 'node:test';

import type { EmitReadInput, EmitReadResult } from '@relayfile/adapter-core';

import { emitXAuxiliaryFiles } from '../emit-auxiliary-files.js';
import {
  xLayoutPath,
  xPostByAuthorAliasPath,
  xPostByConversationAliasPath,
  xPostByIdAliasPath,
  xPostByQueryAliasPath,
  xPostPath,
  xPostsIndexPath,
  xRootIndexPath,
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
} from '../path-mapper.js';
import type { XPost, XSearchBundle, XSearchResult, XSearchRun, XUser } from '../types.js';

interface CapturingClient {
  writes: Array<{ workspaceId: string; path: string; content: string; contentType?: string }>;
  deletes: Array<{ workspaceId: string; path: string }>;
  reads: EmitReadInput[];
  files: Map<string, string>;
  writeFile(input: { workspaceId: string; path: string; content: string; contentType?: string }): Promise<{ created: true }>;
  deleteFile(input: { workspaceId: string; path: string }): Promise<void>;
  readFile(input: EmitReadInput): Promise<EmitReadResult | null>;
}

function createClient(initialFiles: Record<string, string> = {}): CapturingClient {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const client: CapturingClient = {
    writes: [],
    deletes: [],
    reads: [],
    files,
    async writeFile(input) {
      client.writes.push(input);
      files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input) {
      client.deletes.push(input);
      files.delete(input.path);
    },
    async readFile(input) {
      client.reads.push(input);
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    },
  };
  return client;
}

function makeRun(overrides: Partial<XSearchRun> = {}): XSearchRun {
  return {
    id: 's1',
    title: 'Agent workflow leads',
    query: '"agent workflow" lang:en -is:retweet',
    mode: 'recent',
    requestedAt: '2026-05-17T10:00:00Z',
    resultCount: 1,
    costEstimate: {
      posts: 1,
      users: 1,
      postReadUnitUsd: 0.005,
      userReadUnitUsd: 0.01,
      estimatedUsd: 0.015,
      cappedByBudget: false,
      cappedByMaxResults: false,
    },
    budgetUsd: 1,
    source: {
      provider: 'x',
      endpoint: '/2/tweets/search/recent',
      docs: 'https://docs.x.com/x-api/posts/search/introduction',
    },
    ...overrides,
  };
}

const post: XPost = {
  id: '1880001',
  text: 'Looking for an agent workflow automation tool',
  author_id: '2244994945',
  conversation_id: '1880000',
  created_at: '2026-05-17T09:59:00Z',
  lang: 'en',
  public_metrics: { like_count: 7, reply_count: 2, retweet_count: 1 },
};

const user: XUser = {
  id: '2244994945',
  username: 'xdevelopers',
  name: 'X Developers',
  verified: true,
};

function makeBundle(): XSearchBundle {
  const run = makeRun();
  return {
    run,
    posts: [post],
    users: [user],
    results: [{
      id: post.id,
      searchId: run.id,
      postId: post.id,
      rank: 1,
      matchedAt: run.requestedAt,
      canonicalPath: xPostPath(post.id, post.text),
      query: run.query,
    }],
    rawResponses: [],
  };
}

test('emitXAuxiliaryFiles writes layout, indexes, canonical records, aliases, and result pointers', async () => {
  const client = createClient();
  const result = await emitXAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    bundles: [makeBundle()],
    connectionId: 'conn_x',
  });

  assert.deepEqual(result.errors, []);
  const writtenPaths = client.writes.map((write) => write.path);
  for (const expected of [
    xRootIndexPath(),
    xLayoutPath(),
    xSearchMetaPath('s1', 'Agent workflow leads'),
    xSearchByIdAliasPath('s1'),
    xSearchByQueryAliasPath('"agent workflow" lang:en -is:retweet', 's1'),
    xPostPath(post.id, post.text),
    xPostByIdAliasPath(post.id),
    xPostByAuthorAliasPath('xdevelopers', post.id),
    xPostByConversationAliasPath('1880000', post.id),
    xPostByQueryAliasPath('s1', post.id),
    xUserPath(user.id, user.username),
    xUserByIdAliasPath(user.id),
    xUserByUsernameAliasPath(user.username!, user.id),
    xSearchResultPath('s1', 'Agent workflow leads', post.id),
    xSearchesIndexPath(),
    xPostsIndexPath(),
    xUsersIndexPath(),
    xSearchResultsIndexPath('s1', 'Agent workflow leads'),
  ]) {
    assert.ok(writtenPaths.includes(expected), `missing ${expected}`);
  }

  assert.ok((client.files.get(xLayoutPath()) ?? '').length > 1000);
  assert.ok((client.files.get(xLayoutPath()) ?? '').includes('Cost Controls'));

  const searchesIndex = JSON.parse(client.files.get(xSearchesIndexPath())!) as Array<{ id: string; estimatedUsd: number }>;
  assert.deepEqual(searchesIndex, [{ id: 's1', title: 'Agent workflow leads', updated: '2026-05-17T10:00:00Z', query: '"agent workflow" lang:en -is:retweet', mode: 'recent', resultCount: 1, estimatedUsd: 0.015 }]);

  const resultPointer = JSON.parse(client.files.get(xSearchResultPath('s1', 'Agent workflow leads', post.id))!) as { canonicalPath: string };
  assert.equal(resultPointer.canonicalPath, xPostPath(post.id, post.text));

  const canonicalPost = client.files.get(xPostPath(post.id, post.text));
  assert.equal(client.files.get(xPostByIdAliasPath(post.id)), canonicalPost);
  assert.equal(client.files.get(xPostByQueryAliasPath('s1', post.id)), canonicalPost);
});

test('emitXAuxiliaryFiles reconciles renamed searches and changed post alias fields', async () => {
  const oldSearch = JSON.stringify({
    canonicalPath: xSearchMetaPath('s1', 'Old query'),
    title: 'Old query',
    query: 'old query',
  });
  const oldResult: XSearchResult = {
    id: post.id,
    searchId: 's1',
    postId: post.id,
    rank: 1,
    matchedAt: '2026-05-16T10:00:00Z',
    canonicalPath: xPostPath(post.id, 'Old text'),
    query: 'old query',
  };
  const oldPost = JSON.stringify({
    canonicalPath: xPostPath(post.id, 'Old text'),
    authorKey: 'oldauthor',
    conversationId: 'old-convo',
    searchIds: ['old-search'],
    payload: { id: post.id, text: 'Old text' },
  });
  const client = createClient({
    [xSearchByIdAliasPath('s1')]: oldSearch,
    [xSearchResultsIndexPath('s1', 'Old query')]: JSON.stringify([oldResult]),
    [xSearchResultPath('s1', 'Old query', post.id)]: JSON.stringify(oldResult),
    [xPostByIdAliasPath(post.id)]: oldPost,
  });

  await emitXAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    bundles: [makeBundle()],
  });

  const deletes = client.deletes.map((deleteInput) => deleteInput.path);
  assert.ok(deletes.includes(xSearchMetaPath('s1', 'Old query')));
  assert.ok(deletes.includes(xSearchByQueryAliasPath('old query', 's1')));
  assert.ok(deletes.includes(xSearchResultsIndexPath('s1', 'Old query')));
  assert.ok(deletes.includes(xSearchResultPath('s1', 'Old query', post.id)));
  assert.ok(deletes.includes(xPostPath(post.id, 'Old text')));
  assert.ok(deletes.includes(xPostByAuthorAliasPath('oldauthor', post.id)));
  assert.ok(deletes.includes(xPostByConversationAliasPath('old-convo', post.id)));
  assert.ok(deletes.includes(xPostByQueryAliasPath('old-search', post.id)));
});

test('emitXAuxiliaryFiles writes collision-disambiguated aliases and removes stale ambiguous aliases', async () => {
  const firstRun = makeRun({
    id: 's-collide-1',
    title: 'First colliding search',
    query: 'Agent Workflow!',
  });
  const secondRun = makeRun({
    id: 's-collide-2',
    title: 'Second colliding search',
    query: 'agent workflow',
  });
  const firstPost: XPost = { ...post, id: '1880101', author_id: 'u1', text: 'First collision post' };
  const secondPost: XPost = { ...post, id: '1880102', author_id: 'u2', text: 'Second collision post' };
  const firstUser: XUser = { id: 'u1', username: 'X Developers', name: 'X Developers' };
  const secondUser: XUser = { id: 'u2', username: 'x-developers', name: 'X Developers alt' };
  const firstResult: XSearchResult = {
    id: firstPost.id,
    searchId: firstRun.id,
    postId: firstPost.id,
    rank: 1,
    matchedAt: firstRun.requestedAt,
    canonicalPath: xPostPath(firstPost.id, firstPost.text),
    query: firstRun.query,
  };
  const secondResult: XSearchResult = {
    id: secondPost.id,
    searchId: secondRun.id,
    postId: secondPost.id,
    rank: 1,
    matchedAt: secondRun.requestedAt,
    canonicalPath: xPostPath(secondPost.id, secondPost.text),
    query: secondRun.query,
  };
  const client = createClient({
    [xSearchByQueryAliasPath(firstRun.query, firstRun.id)]: '{}',
    [xSearchByQueryAliasPath(secondRun.query, secondRun.id)]: '{}',
    [xUserByUsernameAliasPath(firstUser.username!, firstUser.id)]: '{}',
    [xUserByUsernameAliasPath(secondUser.username!, secondUser.id)]: '{}',
  });

  await emitXAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    bundles: [
      { run: firstRun, posts: [firstPost], users: [firstUser], results: [firstResult], rawResponses: [] },
      { run: secondRun, posts: [secondPost], users: [secondUser], results: [secondResult], rawResponses: [] },
    ],
  });

  const writtenPaths = client.writes.map((write) => write.path);
  const deletedPaths = client.deletes.map((deleteInput) => deleteInput.path);
  for (const expected of [
    xSearchByQueryAliasPath(firstRun.query, firstRun.id, true),
    xSearchByQueryAliasPath(secondRun.query, secondRun.id, true),
    xUserByUsernameAliasPath(firstUser.username!, firstUser.id, true),
    xUserByUsernameAliasPath(secondUser.username!, secondUser.id, true),
    xPostByAuthorAliasPath(firstUser.username!, firstPost.id),
    xPostByAuthorAliasPath(secondUser.username!, secondPost.id),
  ]) {
    assert.ok(writtenPaths.includes(expected), `missing ${expected}`);
  }

  for (const stale of [
    xSearchByQueryAliasPath(firstRun.query, firstRun.id),
    xSearchByQueryAliasPath(secondRun.query, secondRun.id),
    xUserByUsernameAliasPath(firstUser.username!, firstUser.id),
    xUserByUsernameAliasPath(secondUser.username!, secondUser.id),
  ]) {
    assert.ok(deletedPaths.includes(stale), `missing stale delete ${stale}`);
    assert.equal(client.files.has(stale), false);
  }
});

test('emitXAuxiliaryFiles deletes by-query search aliases from index state when by-id prior is missing', async () => {
  const run = makeRun({
    id: 'search-delete',
    title: 'Workflow leads',
    query: 'agent workflow buyers',
  });
  const canonicalPath = xSearchMetaPath(run.id, run.title);
  const byQueryPath = xSearchByQueryAliasPath(run.query, run.id);
  const client = createClient({
    [xSearchesIndexPath()]: JSON.stringify([
      {
        id: run.id,
        title: run.title,
        updated: run.requestedAt,
        query: run.query,
        mode: run.mode,
        resultCount: run.resultCount,
        estimatedUsd: run.costEstimate.estimatedUsd,
      },
    ]),
    [canonicalPath]: JSON.stringify({ canonicalPath, title: run.title, query: run.query }),
    [byQueryPath]: JSON.stringify({ canonicalPath, title: run.title, query: run.query }),
  });

  await emitXAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    searches: [{ id: run.id, _deleted: true }],
  });

  const deletedPaths = client.deletes.map((deleteInput) => deleteInput.path);
  assert.ok(deletedPaths.includes(canonicalPath));
  assert.ok(deletedPaths.includes(byQueryPath));
  assert.ok(!deletedPaths.includes(xSearchByQueryAliasPath(run.id, run.id)));
});

test('emitXAuxiliaryFiles deletes reverse post query aliases when a search is deleted', async () => {
  const run = makeRun({
    id: 'search-delete',
    title: 'Workflow leads',
    query: 'agent workflow buyers',
  });
  const priorResult: XSearchResult = {
    id: `${post.id}:search-delete`,
    searchId: run.id,
    postId: post.id,
    rank: 1,
    matchedAt: run.requestedAt,
    canonicalPath: xPostPath(post.id, post.text),
    query: run.query,
  };
  const resultIndexPath = xSearchResultsIndexPath(run.id, run.title);
  const resultPointerPath = xSearchResultPath(run.id, run.title, post.id);
  const postByQueryPath = xPostByQueryAliasPath(run.id, post.id);
  const client = createClient({
    [xSearchByIdAliasPath(run.id)]: JSON.stringify({
      canonicalPath: xSearchMetaPath(run.id, run.title),
      title: run.title,
      query: run.query,
    }),
    [resultIndexPath]: JSON.stringify([priorResult]),
    [resultPointerPath]: JSON.stringify(priorResult),
    [postByQueryPath]: JSON.stringify({
      canonicalPath: xPostPath(post.id, post.text),
      searchIds: [run.id],
      payload: post,
    }),
  });

  await emitXAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    searches: [{ id: run.id, _deleted: true }],
  });

  const deletedPaths = client.deletes.map((deleteInput) => deleteInput.path);
  assert.ok(deletedPaths.includes(resultIndexPath));
  assert.ok(deletedPaths.includes(resultPointerPath));
  assert.ok(deletedPaths.includes(postByQueryPath));
  assert.equal(client.files.has(postByQueryPath), false);
});

test('emitXAuxiliaryFiles ignores untrusted prior canonical paths for search, post, and user cleanup', async () => {
  const run = makeRun({
    id: 'search-delete',
    title: 'Workflow leads',
    query: 'agent workflow buyers',
  });
  const safeSearchPath = xSearchMetaPath(run.id, run.title);
  const safePostPath = xPostPath(post.id, 'Old text');
  const safeUserPath = xUserPath(user.id, user.username);
  const foreignPath = '/github/repos/acme/api/pulls/1__fix/meta.json';
  const client = createClient({
    [xSearchByIdAliasPath(run.id)]: JSON.stringify({
      canonicalPath: foreignPath,
      title: run.title,
      query: run.query,
    }),
    [xPostByIdAliasPath(post.id)]: JSON.stringify({
      canonicalPath: foreignPath,
      authorKey: 'oldauthor',
      conversationId: 'old-convo',
      searchIds: ['old-search'],
      payload: { id: post.id, text: 'Old text' },
    }),
    [xUserByIdAliasPath(user.id)]: JSON.stringify({
      canonicalPath: foreignPath,
      username: user.username,
      payload: user,
    }),
  });

  await emitXAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    searches: [{ id: run.id, _deleted: true }],
    posts: [{ id: post.id, _deleted: true }],
    users: [{ id: user.id, _deleted: true }],
  });

  const deletedPaths = client.deletes.map((deleteInput) => deleteInput.path);
  assert.ok(!deletedPaths.includes(foreignPath));
  assert.ok(deletedPaths.includes(safeSearchPath));
  assert.ok(deletedPaths.includes(safePostPath));
  assert.ok(deletedPaths.includes(safeUserPath));
  assert.ok(deletedPaths.includes(xPostByAuthorAliasPath('oldauthor', post.id)));
  assert.ok(deletedPaths.includes(xPostByConversationAliasPath('old-convo', post.id)));
  assert.ok(deletedPaths.includes(xPostByQueryAliasPath('old-search', post.id)));
  assert.ok(deletedPaths.includes(xUserByUsernameAliasPath(user.username!, user.id)));
});

test('emitXAuxiliaryFiles recomputes stale canonical paths on rename when prior aliases are tampered', async () => {
  const foreignPath = '/github/repos/acme/api/issues/1__fix/meta.json';
  const oldSearch = makeRun({ id: 's-rename', title: 'Old search', query: 'old query' });
  const newSearch = makeRun({ id: oldSearch.id, title: 'New search', query: 'new query' });
  const oldPost: XPost = { ...post, text: 'Old text' };
  const newPost: XPost = { ...post, text: 'New text' };
  const oldUser: XUser = { ...user, username: 'olduser' };
  const newUser: XUser = { ...user, username: 'newuser' };
  const client = createClient({
    [xSearchByIdAliasPath(oldSearch.id)]: JSON.stringify({
      canonicalPath: foreignPath,
      title: oldSearch.title,
      query: oldSearch.query,
    }),
    [xPostByIdAliasPath(oldPost.id)]: JSON.stringify({
      canonicalPath: foreignPath,
      payload: oldPost,
    }),
    [xUserByIdAliasPath(oldUser.id)]: JSON.stringify({
      canonicalPath: foreignPath,
      username: oldUser.username,
      payload: oldUser,
    }),
  });

  await emitXAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    searches: [newSearch],
    posts: [newPost],
    users: [newUser],
  });

  const deletedPaths = client.deletes.map((deleteInput) => deleteInput.path);
  assert.ok(!deletedPaths.includes(foreignPath));
  assert.ok(deletedPaths.includes(xSearchMetaPath(oldSearch.id, oldSearch.title)));
  assert.ok(deletedPaths.includes(xSearchByQueryAliasPath(oldSearch.query, oldSearch.id)));
  assert.ok(deletedPaths.includes(xPostPath(oldPost.id, oldPost.text)));
  assert.ok(deletedPaths.includes(xUserPath(oldUser.id, oldUser.username)));
  assert.ok(deletedPaths.includes(xUserByUsernameAliasPath(oldUser.username!, oldUser.id)));
});

test('emitXAuxiliaryFiles groups post search aliases and reconciles stale aliases without scanning per post', async () => {
  const secondRun = makeRun({
    id: 's2',
    title: 'Agent workflow buyers',
    query: '"agent workflow" buyer',
  });
  const client = createClient({
    [xPostByIdAliasPath(post.id)]: JSON.stringify({
      canonicalPath: xPostPath(post.id, post.text),
      authorKey: user.username,
      conversationId: post.conversation_id,
      searchIds: ['s1', 'stale-search'],
      payload: post,
    }),
  });

  await emitXAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    searches: [makeRun(), secondRun],
    posts: [post],
    users: [user],
    results: [
      {
        id: `${post.id}:s1`,
        searchId: 's1',
        postId: post.id,
        rank: 1,
        matchedAt: '2026-05-17T10:00:00Z',
        canonicalPath: xPostPath(post.id, post.text),
        query: '"agent workflow" lang:en -is:retweet',
      },
      {
        id: `${post.id}:s2`,
        searchId: 's2',
        postId: post.id,
        rank: 1,
        matchedAt: '2026-05-17T10:00:00Z',
        canonicalPath: xPostPath(post.id, post.text),
        query: '"agent workflow" buyer',
      },
    ],
  });

  const writtenPaths = client.writes.map((write) => write.path);
  const deletedPaths = client.deletes.map((deleteInput) => deleteInput.path);
  assert.ok(writtenPaths.includes(xPostByQueryAliasPath('s1', post.id)));
  assert.ok(writtenPaths.includes(xPostByQueryAliasPath('s2', post.id)));
  assert.ok(deletedPaths.includes(xPostByQueryAliasPath('stale-search', post.id)));
});

test('emitXAuxiliaryFiles removes stale search result pointers for the same search run', async () => {
  const run = makeRun();
  const staleResult: XSearchResult = {
    id: '1880002',
    searchId: run.id,
    postId: '1880002',
    rank: 2,
    matchedAt: '2026-05-16T10:00:00Z',
    canonicalPath: xPostPath('1880002', 'Stale post'),
    query: run.query,
  };
  const currentResult: XSearchResult = {
    id: post.id,
    searchId: run.id,
    postId: post.id,
    rank: 1,
    matchedAt: run.requestedAt,
    canonicalPath: xPostPath(post.id, post.text),
    query: run.query,
  };
  const client = createClient({
    [xSearchResultsIndexPath(run.id, run.title)]: JSON.stringify([currentResult, staleResult]),
    [xSearchResultPath(run.id, run.title, post.id)]: JSON.stringify(currentResult),
    [xSearchResultPath(run.id, run.title, staleResult.postId)]: JSON.stringify(staleResult),
    [xPostByQueryAliasPath(run.id, staleResult.postId)]: JSON.stringify({
      canonicalPath: xPostPath(staleResult.postId, 'Stale post'),
      searchIds: [run.id],
    }),
  });

  await emitXAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    searches: [run],
    posts: [post],
    users: [user],
    results: [currentResult],
  });

  const deletedPaths = client.deletes.map((deleteInput) => deleteInput.path);
  assert.ok(deletedPaths.includes(xSearchResultPath(run.id, run.title, staleResult.postId)));
  assert.ok(deletedPaths.includes(xPostByQueryAliasPath(run.id, staleResult.postId)));
  assert.equal(client.files.has(xSearchResultPath(run.id, run.title, staleResult.postId)), false);
  assert.equal(client.files.has(xPostByQueryAliasPath(run.id, staleResult.postId)), false);

  const rewrittenIndex = JSON.parse(client.files.get(xSearchResultsIndexPath(run.id, run.title))!) as XSearchResult[];
  assert.deepEqual(rewrittenIndex.map((result) => result.postId), [post.id]);
});
