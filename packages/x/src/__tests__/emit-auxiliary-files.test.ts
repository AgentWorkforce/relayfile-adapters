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
import type { XPost, XSearchBundle, XSearchRun, XUser } from '../types.js';

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
  const oldPost = JSON.stringify({
    canonicalPath: xPostPath(post.id, 'Old text'),
    authorKey: 'oldauthor',
    conversationId: 'old-convo',
    searchIds: ['old-search'],
    payload: { id: post.id, text: 'Old text' },
  });
  const client = createClient({
    [xSearchByIdAliasPath('s1')]: oldSearch,
    [xPostByIdAliasPath(post.id)]: oldPost,
  });

  await emitXAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    bundles: [makeBundle()],
  });

  const deletes = client.deletes.map((deleteInput) => deleteInput.path);
  assert.ok(deletes.includes(xSearchMetaPath('s1', 'Old query')));
  assert.ok(deletes.includes(xSearchByQueryAliasPath('old query', 's1')));
  assert.ok(deletes.includes(xPostPath(post.id, 'Old text')));
  assert.ok(deletes.includes(xPostByAuthorAliasPath('oldauthor', post.id)));
  assert.ok(deletes.includes(xPostByConversationAliasPath('old-convo', post.id)));
  assert.ok(deletes.includes(xPostByQueryAliasPath('old-search', post.id)));
});
