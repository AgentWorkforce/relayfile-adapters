import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  mockRepoContext,
  mockReviewComments,
  mockReviews,
} from '../../__tests__/fixtures/index.js';
import { type ProxyRequest, type ProxyResponse } from '../../types.js';
import { fetchReviewComments, fetchReviews } from '../fetcher.js';
import { ingestReviewComments, mapReviewComment } from '../comment-mapper.js';
import { ingestReviews, mapReview } from '../review-mapper.js';

function createFixtureProvider(options?: {
  reviews?: readonly (typeof mockReviews)[number][];
  reviewComments?: readonly (typeof mockReviewComments)[number][];
}) {
  const reviews = options?.reviews ?? mockReviews;
  const reviewComments = options?.reviewComments ?? mockReviewComments;
  const proxy = mock.fn(async (request: ProxyRequest): Promise<ProxyResponse> => {
    if (
      request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/reviews`
    ) {
      return jsonResponse(
        reviews.map((review) => ({
          ...review,
          user: { ...review.user },
        })),
      );
    }

    if (
      request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/comments`
    ) {
      return jsonResponse(
        reviewComments.map((comment) => ({
          ...comment,
          user: { ...comment.user },
        })),
      );
    }

    throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
  });

  const provider = {
    name: 'fixture-github',
    connectionId: 'conn-fixture',
    proxy,
  };

  return { provider, proxy };
}

function createMemoryVfs() {
  const writes = new Map<string, string>();
  const writeFile = mock.fn(async (path: string, content: string) => {
    writes.set(path, content);
    return { created: true as const };
  });

  return {
    writes,
    vfs: { writeFile },
    writeFile,
  };
}

function jsonResponse(data: ProxyResponse['data']): ProxyResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    data,
  };
}

describe('review mapping', () => {
  it('fetchReviews returns review list', async () => {
    const { provider, proxy } = createFixtureProvider();

    const response = await fetchReviews(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.deepStrictEqual(
      response,
      mockReviews.map((review) => ({
        ...review,
        user: { ...review.user },
      })),
    );
    assert.strictEqual(proxy.mock.calls.length, 1);
    assert.deepStrictEqual(proxy.mock.calls[0].arguments, [{
      method: 'GET',
      baseUrl: 'https://api.github.com',
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/reviews`,
      connectionId: 'conn-fixture',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      query: {
        page: '1',
        per_page: '100',
      },
    }]);
  });

  it('mapReview produces correct JSON shape', () => {
    const mapped = mapReview(
      mockReviews[0],
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.deepStrictEqual(JSON.parse(mapped.content), {
      id: 9001,
      state: 'APPROVED',
      body: 'Looks good. The fixture coverage is focused and realistic.',
      author: {
        login: 'monalisa',
        avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
      },
      submitted_at: '2026-03-28T08:10:00Z',
      commit_id: mockRepoContext.headSha,
      htmlUrl: 'https://github.com/octocat/hello-world/pull/42#pullrequestreview-9001',
    });
  });

  it('mapReview builds correct VFS path', () => {
    const mapped = mapReview(
      mockReviews[0],
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.strictEqual(mapped.vfsPath, 'reviews/9001.json');
  });

  it('fetchReviewComments returns comment list', async () => {
    const { provider, proxy } = createFixtureProvider();

    const response = await fetchReviewComments(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.deepStrictEqual(
      response,
      mockReviewComments.map((comment) => ({
        ...comment,
        user: { ...comment.user },
      })),
    );
    assert.strictEqual(proxy.mock.calls.length, 1);
    assert.deepStrictEqual(proxy.mock.calls[0].arguments, [{
      method: 'GET',
      baseUrl: 'https://api.github.com',
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/comments`,
      connectionId: 'conn-fixture',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      query: {
        page: '1',
        per_page: '100',
      },
    }]);
  });

  it('mapReviewComment includes diff_hunk and line info', () => {
    const mapped = mapReviewComment(
      mockReviewComments[0],
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.deepStrictEqual(JSON.parse(mapped.content), {
      id: 9101,
      body: 'Nice improvement. This wording is clearer.',
      path: 'src/index.ts',
      line: 2,
      side: 'RIGHT',
      original_line: 2,
      author: {
        login: 'monalisa',
      },
      created_at: '2026-03-28T08:11:00Z',
      updated_at: '2026-03-28T08:11:00Z',
      in_reply_to_id: null,
      review_id: 9001,
      diff_hunk:
        '@@ -1,3 +1,3 @@\n export function greet(name) {\n-  return `Hi, ${name}.`;\n+  return `Hello, ${name}!`;\n }\n',
    });
  });

  it('mapReviewComment links to parent review', () => {
    const mapped = mapReviewComment(
      mockReviewComments[1],
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.strictEqual(JSON.parse(mapped.content).review_id, mockReviews[0].id);
    assert.strictEqual(mapped.vfsPath, 'comments/9102.json');
  });

  it('ingestReviews writes all review files', async () => {
    const { provider } = createFixtureProvider();
    const { writes, vfs, writeFile } = createMemoryVfs();

    const result = await ingestReviews(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
      vfs,
    );

    assert.strictEqual(writeFile.mock.calls.length, 1);
    assert.deepStrictEqual(Array.from(writes.keys()), ['reviews/9001.json']);
    const review9001 = JSON.parse(writes.get('reviews/9001.json') ?? '');
    assert.strictEqual(review9001.id, 9001);
    assert.strictEqual(review9001.state, 'APPROVED');
    assert.strictEqual(review9001.author.login, 'monalisa');
    assert.deepStrictEqual(result, {
      filesWritten: 1,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: ['reviews/9001.json'],
      errors: [],
    });
  });

  it('ingestReviewComments writes all comment files', async () => {
    const { provider } = createFixtureProvider();
    const { writes, vfs, writeFile } = createMemoryVfs();

    const result = await ingestReviewComments(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
      vfs,
    );

    assert.strictEqual(writeFile.mock.calls.length, 2);
    assert.deepStrictEqual(Array.from(writes.keys()), [
      'comments/9101.json',
      'comments/9102.json',
    ]);
    const comment9101 = JSON.parse(writes.get('comments/9101.json') ?? '');
    assert.strictEqual(comment9101.id, 9101);
    assert.strictEqual(comment9101.review_id, 9001);
    assert.strictEqual(comment9101.path, 'src/index.ts');
    const comment9102 = JSON.parse(writes.get('comments/9102.json') ?? '');
    assert.strictEqual(comment9102.id, 9102);
    assert.strictEqual(comment9102.review_id, 9001);
    assert.strictEqual(comment9102.path, 'src/utils/math.ts');
    assert.deepStrictEqual(result, {
      filesWritten: 2,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: ['comments/9101.json', 'comments/9102.json'],
      errors: [],
    });
  });
});
