import assert from 'node:assert/strict';
import test from 'node:test';

import {
  X_ABSOLUTE_MAX_PAGES,
  X_ABSOLUTE_MAX_POST_READS,
  X_ARCHIVE_QUERY_MAX_LENGTH,
  X_DEFAULT_REQUEST_TIMEOUT_MS,
  X_RECENT_QUERY_MAX_LENGTH,
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
  const signals: AbortSignal[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    urls.push(url);
    assert.equal(init?.headers?.Authorization, 'Bearer token');
    assert.ok(init?.signal instanceof AbortSignal);
    signals.push(init.signal);
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
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.aborted, false);
  assert.equal(bundle.posts.length, 10);
  assert.equal(bundle.users.length, 10);
  assert.equal(bundle.run.costEstimate.estimatedUsd, 0.15);
  assert.equal(bundle.run.nextToken, 'next-page');
  assert.equal(new URL(urls[0]!).pathname, '/2/tweets/search/recent');
  assert.equal(new URL(urls[0]!).searchParams.get('query'), 'agent workflows lang:en -is:retweet');
  assert.equal(bundle.results[0]?.canonicalPath, '/x/posts/post-0__1000.json');
});

test('XSearchClient rejects non-X base URLs before sending bearer tokens', async () => {
  let fetchCalls = 0;
  assert.throws(
    () => new XSearchClient({
      bearerToken: 'secret',
      baseUrl: 'https://attacker.example',
      fetch: async () => {
        fetchCalls += 1;
        throw new Error('fetch should not be called');
      },
    }),
    /https:\/\/api\.x\.com/u,
  );
  assert.equal(fetchCalls, 0);
});

test('XSearchClient passes an abort signal to each request and validates timeout configuration', async () => {
  const signals: AbortSignal[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    signals.push(init.signal);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { data: [], meta: { result_count: 0 } };
      },
    };
  };
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl, requestTimeoutMs: X_DEFAULT_REQUEST_TIMEOUT_MS });

  await client.search({ query: 'agent workflows', maxResults: 10 });

  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.aborted, false);
  assert.throws(
    () => new XSearchClient({ bearerToken: 'token', fetch: fetchImpl, requestTimeoutMs: 0 }),
    /requestTimeoutMs/u,
  );
});

test('XSearchClient redacts oversized provider error bodies', async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    async json() {
      return {
        title: 'Rate limit exceeded',
        detail: 'x'.repeat(1_000),
        ignored: 'y'.repeat(1_000),
      };
    },
  });
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  await assert.rejects(
    () => client.search({ query: 'agent workflows', maxResults: 10 }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /429 Too Many Requests: Rate limit exceeded/u);
      assert.ok(error.message.length < 380, `error message was not capped: ${error.message.length}`);
      assert.doesNotMatch(error.message, /ignored/u);
      return true;
    },
  );
});

test('XSearchClient surfaces HTTP status when provider error body is not JSON', async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    async json() {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  });
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  await assert.rejects(
    () => client.search({ query: 'agent workflows', maxResults: 10 }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /429 Too Many Requests/u);
      assert.doesNotMatch(error.message, /Unexpected token/u);
      return true;
    },
  );
});

test('XSearchClient surfaces HTTP status when provider error body is empty', async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    async json() {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  });
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  await assert.rejects(
    () => client.search({ query: 'agent workflows', maxResults: 10 }),
    /503 Service Unavailable/u,
  );
});

test('XSearchClient honors explicit maxResults above the default cap without policy override', async () => {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    const base = urls.length * 1000;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return {
          data: Array.from({ length: 100 }, (_, index) => ({
            id: String(base + index),
            text: `post ${base + index}`,
          })),
          meta: { result_count: 100, next_token: 'next-page' },
        };
      },
    };
  };
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  const bundle = await client.search({ query: 'agent workflows', maxResults: 1_000 });

  assert.equal(urls.length, 10);
  assert.equal(bundle.posts.length, 1_000);
  assert.equal(new URL(urls[0]!).searchParams.get('max_results'), '100');
});

test('XSearchClient clamps explicit maxResults to a lower policy maxPostReads', async () => {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return {
          data: Array.from({ length: 100 }, (_, index) => ({
            id: `${urls.length}-${index}`,
            text: `post ${urls.length}-${index}`,
          })),
          meta: { result_count: 100, next_token: 'next-page' },
        };
      },
    };
  };
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  const bundle = await client.search({
    query: 'agent workflows',
    maxResults: 1_000,
    costPolicy: { maxPostReads: 250 },
  });

  assert.equal(urls.length, 3);
  assert.equal(bundle.posts.length, 250);
  assert.equal(new URL(urls[0]!).searchParams.get('max_results'), '100');
  assert.equal(new URL(urls[2]!).searchParams.get('max_results'), '50');
});

test('XSearchClient honors explicit maxPostReads as the caller-reviewed cap', async () => {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    const start = urls.length * 100;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return {
          data: Array.from({ length: 100 }, (_, index) => ({
            id: String(start + index),
            text: `post ${start + index}`,
          })),
          meta: { result_count: 100, next_token: urls.length === 1 ? 'next-page' : undefined },
        };
      },
    };
  };
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  const bundle = await client.search({
    query: 'agent workflows',
    maxResults: 150,
    costPolicy: { maxPostReads: 150 },
  });

  assert.equal(urls.length, 2);
  assert.equal(bundle.posts.length, 150);
  assert.equal(new URL(urls[0]!).searchParams.get('max_results'), '100');
  assert.equal(new URL(urls[1]!).searchParams.get('max_results'), '50');
});

test('XSearchClient times out stalled response body parsing', async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => new Promise(() => {}),
  });
  const client = new XSearchClient({
    bearerToken: 'token',
    fetch: fetchImpl,
    requestTimeoutMs: 20,
  });

  await assert.rejects(
    () => client.search({ query: 'agent workflows', maxResults: 10 }),
    /timed out after 20ms/u,
  );
});

test('XSearchClient clamps oversized maxPostReads and bounds retained raw responses', async () => {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    const start = (urls.length - 1) * 100;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return {
          data: Array.from({ length: 100 }, (_, index) => ({
            id: String(start + index),
            text: `post ${start + index}`,
          })),
          meta: { result_count: 100, next_token: 'next-page' },
        };
      },
    };
  };
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  const bundle = await client.search({
    query: 'agent workflows',
    maxResults: 5_000,
    costPolicy: { maxPostReads: 5_000 },
  });

  assert.equal(bundle.posts.length, X_ABSOLUTE_MAX_POST_READS);
  assert.equal(bundle.rawResponses.length, X_ABSOLUTE_MAX_PAGES);
  assert.equal(urls.length, X_ABSOLUTE_MAX_PAGES);
});

test('XSearchClient rejects invalid max and budget values before fetching', async () => {
  const client = new XSearchClient({
    bearerToken: 'token',
    fetch: async () => {
      throw new Error('fetch should not be called');
    },
  });

  await assert.rejects(() => client.search({ query: 'bad', maxResults: Number.POSITIVE_INFINITY }), /maxResults/u);
  await assert.rejects(() => client.search({ query: 'bad', maxResults: Number.NaN }), /maxResults/u);
  await assert.rejects(() => client.search({ query: 'bad', maxResults: -1 }), /maxResults/u);
  await assert.rejects(() => client.search({ query: 'bad', costPolicy: { maxPostReads: Number.NaN } }), /maxPostReads/u);
  await assert.rejects(() => client.search({ query: 'bad', costPolicy: { maxUserReads: -1 } }), /maxUserReads/u);
  await assert.rejects(() => client.search({ query: 'bad', costPolicy: { budgetUsd: Number.POSITIVE_INFINITY } }), /budgetUsd/u);
});

test('XSearchClient rejects oversized query and field arrays before fetching', async () => {
  let fetchCalls = 0;
  const client = new XSearchClient({
    bearerToken: 'token',
    fetch: async () => {
      fetchCalls += 1;
      throw new Error('fetch should not be called');
    },
  });

  await assert.rejects(
    () => client.search({ query: 'x'.repeat(X_RECENT_QUERY_MAX_LENGTH + 1), maxResults: 10 }),
    /query/u,
  );
  await assert.rejects(
    () => client.search({ query: 'agent workflows', tweetFields: Array.from({ length: 33 }, () => 'id'), maxResults: 10 }),
    /tweetFields/u,
  );
  await assert.rejects(
    () => client.search({ query: 'agent workflows', nextToken: '../bad-token', maxResults: 10 }),
    /nextToken/u,
  );
  assert.equal(fetchCalls, 0);
});

test('XSearchClient accepts boundary-size archive queries and validated field lists', async () => {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { data: [], meta: { result_count: 0 } };
      },
    };
  };
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });
  const query = 'x'.repeat(X_ARCHIVE_QUERY_MAX_LENGTH);

  await client.search({
    query,
    mode: 'archive',
    maxResults: 10,
    tweetFields: ['id', 'author_id', 'public_metrics'],
    expansions: ['author_id'],
  });

  const params = new URL(urls[0]!).searchParams;
  assert.equal(params.get('query'), query);
  assert.equal(params.get('tweet.fields'), 'id,author_id,public_metrics');
});

test('XSearchClient validates mode at runtime before fetching', async () => {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { data: [], meta: { result_count: 0 } };
      },
    };
  };
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  await assert.rejects(
    () => client.search({ query: 'agent workflows', mode: 'invalid' as never, maxResults: 10 }),
    /mode/u,
  );
  assert.equal(urls.length, 0);

  await client.search({ query: 'agent workflows', mode: 'recent', maxResults: 10 });
  await client.search({ query: 'agent workflows', mode: 'archive', maxResults: 10 });
  assert.equal(new URL(urls[0]!).pathname, '/2/tweets/search/recent');
  assert.equal(new URL(urls[1]!).pathname, '/2/tweets/search/all');
});

test('XSearchClient never sends provider-invalid max_results below the search minimum', async () => {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        const count = urls.length === 1 ? 100 : 10;
        return {
          data: Array.from({ length: count }, (_, index) => ({
            id: String((urls.length - 1) * 100 + index),
            text: `post ${(urls.length - 1) * 100 + index}`,
          })),
          meta: { result_count: count, next_token: urls.length === 1 ? 'next-page' : undefined },
        };
      },
    };
  };
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  await assert.rejects(() => client.search({ query: 'too small', maxResults: 5 }), /at least 10/u);
  const bundle = await client.search({
    query: 'partial final page',
    maxResults: 105,
    costPolicy: { maxPostReads: 105 },
  });

  assert.equal(bundle.posts.length, 105);
  assert.equal(new URL(urls[0]!).searchParams.get('max_results'), '100');
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]!).searchParams.get('max_results'), '10');
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

test('XSearchClient does not charge user reads or send user fields when user expansion is disabled', async () => {
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
          })),
          meta: { result_count: 10 },
        };
      },
    };
  };
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  const bundle = await client.search({
    query: 'post only',
    expansions: [],
    maxResults: 10,
    costPolicy: { budgetUsd: 0.05, maxPostReads: 10 },
  });

  assert.equal(urls.length, 1);
  assert.equal(bundle.posts.length, 10);
  assert.equal(bundle.run.costEstimate.estimatedUsd, 0.05);
  const params = new URL(urls[0]!).searchParams;
  assert.equal(params.has('expansions'), false);
  assert.equal(params.has('user.fields'), false);
});

test('XSearchClient treats dotted user expansions as user-hydrating for fields and budget guards', async () => {
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
            id: String(2000 + index),
            text: `referenced post ${index}`,
          })),
          includes: {
            users: Array.from({ length: 10 }, (_, index) => ({ id: `u${index}` })),
          },
          meta: { result_count: 10 },
        };
      },
    };
  };
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  const bundle = await client.search({
    query: 'conversation:1880000',
    expansions: ['referenced_tweets.id.author_id', 'entities.mentions.username'],
    maxResults: 10,
    costPolicy: { budgetUsd: 0.20, maxPostReads: 10, maxUserReads: 10 },
  });

  assert.equal(bundle.posts.length, 10);
  assert.equal(bundle.users.length, 10);
  const params = new URL(urls[0]!).searchParams;
  assert.equal(params.get('user.fields'), 'id,name,username,verified,verified_type');
  assert.equal(params.get('expansions'), 'referenced_tweets.id.author_id,entities.mentions.username');

  const budgetClient = new XSearchClient({
    bearerToken: 'token',
    fetch: async () => {
      throw new Error('fetch should not be called when dotted user expansions exceed budget');
    },
  });
  const capped = await budgetClient.search({
    query: 'too expensive with mentions',
    expansions: ['entities.mentions.username'],
    maxResults: 10,
    costPolicy: { budgetUsd: 0.05, maxPostReads: 10, maxUserReads: 10 },
  });

  assert.equal(capped.posts.length, 0);
  assert.equal(capped.users.length, 0);
});

test('XSearchClient preserves supported non-user includes in raw responses', async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() {
      return {
        data: [{ id: '1000', text: 'post with media' }],
        includes: {
          media: [{ media_key: 'm1', type: 'photo' }, null],
          places: [{ id: 'p1', full_name: 'Oslo' }],
          polls: [{ id: 'poll1', options: [] }],
        },
        meta: { result_count: 1 },
      };
    },
  });
  const client = new XSearchClient({ bearerToken: 'token', fetch: fetchImpl });

  const bundle = await client.search({
    query: 'has:media',
    maxResults: 10,
    expansions: ['attachments.media_keys', 'geo.place_id', 'attachments.poll_ids'],
    mediaFields: ['type'],
    costPolicy: { budgetUsd: 0.05, maxPostReads: 10 },
  });

  assert.deepEqual(bundle.rawResponses[0]?.includes?.media, [{ media_key: 'm1', type: 'photo' }]);
  assert.deepEqual(bundle.rawResponses[0]?.includes?.places, [{ id: 'p1', full_name: 'Oslo' }]);
  assert.deepEqual(bundle.rawResponses[0]?.includes?.polls, [{ id: 'poll1', options: [] }]);
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

// Regression: security-performance-001 — the X bearer token must never be
// sent to a non-x origin. baseUrl is restricted to https://api.x.com and
// rejected at construction (before any fetch) for anything else.
test('security-performance-001: XSearchClient rejects non-x baseUrl origins before any fetch', () => {
  const fetchSpy: FetchLike = () => {
    throw new Error('fetch must not be called when baseUrl is invalid');
  };
  assert.throws(
    () => new XSearchClient({ bearerToken: 'secret', baseUrl: 'https://attacker.example', fetch: fetchSpy }),
    /api\.x\.com/,
  );
  assert.throws(
    () => new XSearchClient({ bearerToken: 'secret', baseUrl: 'http://api.x.com', fetch: fetchSpy }),
    /api\.x\.com/,
  );
  assert.doesNotThrow(() => new XSearchClient({ bearerToken: 'secret' }));
  assert.doesNotThrow(
    () => new XSearchClient({ bearerToken: 'secret', baseUrl: 'https://api.x.com' }),
  );
});

test('security-performance-001: bearer token is only ever sent to the api.x.com origin', async () => {
  const seenOrigins: string[] = [];
  const seenAuth: Array<string | undefined> = [];
  const fetchSpy: FetchLike = async (url, init) => {
    seenOrigins.push(new URL(url).origin);
    seenAuth.push(init?.headers?.Authorization);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: [], meta: { result_count: 0 } }),
    };
  };
  const client = new XSearchClient({ bearerToken: 'secret-token', fetch: fetchSpy });
  await client.search({ query: 'hello world', maxResults: 10 });
  assert.ok(seenOrigins.length > 0, 'expected at least one fetch');
  for (const origin of seenOrigins) {
    assert.equal(origin, 'https://api.x.com');
  }
  for (const auth of seenAuth) {
    assert.equal(auth, 'Bearer secret-token');
  }
});
