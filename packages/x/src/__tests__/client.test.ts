import assert from 'node:assert/strict';
import test from 'node:test';

import {
  XSearchClient,
  deriveXSearchId,
  estimateXSearchCost,
  type FetchLike,
} from '../client.js';

test('estimateXSearchCost applies post and user caps before pricing', () => {
  assert.deepEqual(estimateXSearchCost({
    posts: 500,
    users: 200,
    policy: { maxPostReads: 100, maxUserReads: 25, budgetUsd: 2 },
  }), {
    posts: 100,
    users: 25,
    postReadUnitUsd: 0.005,
    userReadUnitUsd: 0.01,
    estimatedUsd: 0.75,
    cappedByBudget: false,
    cappedByMaxResults: true,
  });
});

test('XSearchClient fetches a capped page and materializes search results', async () => {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return {
          data: Array.from({ length: 10 }, (_, index) => ({
            id: String(1000 + index),
            text: `post ${index}`,
            author_id: `u${index}`,
          })),
          includes: {
            users: Array.from({ length: 10 }, (_, index) => ({
              id: `u${index}`,
              username: `user${index}`,
            })),
          },
          meta: { result_count: 10, next_token: urls.length === 1 ? 'next-page' : undefined },
        };
      },
    };
  };
  const client = new XSearchClient({
    bearerToken: 'token',
    fetch: fetchImpl,
    now: () => new Date('2026-05-17T10:00:00Z'),
  });

  const bundle = await client.search({
    query: 'agent workflows lang:en -is:retweet',
    maxResults: 10,
    costPolicy: { budgetUsd: 0.15, maxPostReads: 20, maxUserReads: 20 },
  });

  assert.equal(urls.length, 1);
  assert.equal(bundle.posts.length, 10);
  assert.equal(bundle.users.length, 10);
  assert.equal(bundle.run.costEstimate.estimatedUsd, 0.15);
  assert.equal(bundle.run.nextToken, 'next-page');
  assert.equal(new URL(urls[0]!).pathname, '/2/tweets/search/recent');
  assert.equal(new URL(urls[0]!).searchParams.get('query'), 'agent workflows lang:en -is:retweet');
  assert.equal(bundle.results[0]?.canonicalPath, '/x/posts/post-0__1000.json');
});

test('XSearchClient does not fetch when the next page estimate exceeds budget', async () => {
  const client = new XSearchClient({
    bearerToken: 'token',
    fetch: async () => {
      throw new Error('fetch should not be called');
    },
  });

  const bundle = await client.search({
    query: 'expensive query',
    maxResults: 20,
    costPolicy: { budgetUsd: 0.10, maxPostReads: 20, maxUserReads: 20 },
  });

  assert.equal(bundle.posts.length, 0);
  assert.equal(bundle.run.costEstimate.estimatedUsd, 0);
});

test('deriveXSearchId is deterministic across runs', () => {
  assert.equal(
    deriveXSearchId('agent workflows lang:en', 'recent'),
    deriveXSearchId('agent workflows lang:en', 'recent'),
  );
  assert.notEqual(
    deriveXSearchId('agent workflows lang:en', 'recent'),
    deriveXSearchId('agent workflows lang:en', 'archive'),
  );
});
