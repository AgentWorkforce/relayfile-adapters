import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GitHubWritebackHandler,
  ReadOnlyFieldError,
  resolveDeleteRequest,
  resolveWritebackRequest,
} from './writeback.js';
import type {
  GitHubRequestProvider,
  JsonObject,
  ProxyRequest,
  ProxyResponse,
} from './types.js';

class FakeProvider implements GitHubRequestProvider {
  readonly name = 'fake-nango';
  readonly requests: ProxyRequest[] = [];
  private readonly responseFactory: (request: ProxyRequest) => Promise<ProxyResponse> | ProxyResponse;

  constructor(responseFactory: (request: ProxyRequest) => Promise<ProxyResponse> | ProxyResponse) {
    this.responseFactory = responseFactory;
  }

  async proxy(request: ProxyRequest): Promise<ProxyResponse> {
    this.requests.push(request);
    return this.responseFactory(request);
  }
}

function createHandler(
  responseFactory?: (request: ProxyRequest) => Promise<ProxyResponse> | ProxyResponse,
) {
  const provider = new FakeProvider(
    responseFactory ??
      (() => ({
        status: 201,
        headers: {},
        data: { id: 991 } satisfies JsonObject,
      })),
  );

  const handler = new GitHubWritebackHandler(provider, {
    defaultConnectionId: 'conn-default',
  });

  return { handler, provider };
}

describe('writeback', () => {
  it('parseReviewPayload maps agent review JSON into typed GitHub review input', () => {
    const { handler } = createHandler();
    const content = JSON.stringify({
      event: 'REQUEST_CHANGES',
      body: 'Please address the findings below.',
      comments: [
        {
          path: 'src/index.ts',
          line: 14,
          side: 'RIGHT',
          body: 'Null check is missing here.',
          suggestion: 'if (!value) {\n  return;\n}',
        },
      ],
      metadata: {
        commitSha: 'abc123',
        connectionId: 'conn-metadata',
      },
    });

    const parsed = handler.parseReviewPayload(content);
    const mapped = handler.toGitHubReview(parsed);

    assert.strictEqual(parsed.event, 'REQUEST_CHANGES');
    assert.strictEqual(parsed.comments[0]?.line, 14);
    assert.strictEqual(mapped.comments[0]?.line, 14);
    assert.strictEqual(
      mapped.comments[0]?.body,
      'Null check is missing here.\n\n```suggestion\nif (!value) {\n  return;\n}\n```',
    );
  });

  it('extractWritebackTarget parses owner, repo, and pull request number from relayfile path', () => {
    const { handler } = createHandler();
    const target = handler.extractWritebackTarget(
      '/github/repos/openai/relayfile/pulls/42/reviews/draft@review.json',
    );

    assert.deepStrictEqual(target, {
      owner: 'openai',
      repo: 'relayfile',
      prNumber: 42,
    });
  });

  it('handleWriteback submits mapped review comments to the GitHub reviews endpoint', async () => {
    const { handler, provider } = createHandler();
    const result = await handler.handleWriteback(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/7/reviews/draft@review.json',
      JSON.stringify({
        event: 'COMMENT',
        body: 'Automated review summary.',
        comments: [
          {
            path: 'src/writeback.ts',
            line: 88,
            side: 'RIGHT',
            body: 'This line is still doing redundant work.',
          },
        ],
      }),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.externalId, '991');
    assert.strictEqual(provider.requests.length, 1);
    assert.strictEqual(provider.requests[0]?.endpoint, '/repos/acme/widgets/pulls/7/reviews');
    assert.strictEqual(provider.requests[0]?.connectionId, 'conn-default');

    const body = provider.requests[0]?.body as JsonObject;
    const comments = body.comments;
    assert.strictEqual(Array.isArray(comments), true);
    const firstComment = comments[0];
    assert.strictEqual(typeof firstComment, 'object');
    assert.strictEqual((firstComment as JsonObject).line, 88);
  });

  it('writeBack delegates to the GitHub review writeback pipeline', async () => {
    const { handler, provider } = createHandler();
    const result = await handler.writeBack(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/12/reviews/draft@review.json',
      JSON.stringify({
        event: 'COMMENT',
        body: 'Adapter-level writeBack submission.',
        comments: [
          {
            path: 'src/types.ts',
            line: 21,
            body: 'The public adapter method should remain aligned with the spec.',
          },
        ],
      }),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.externalId, '991');
    assert.strictEqual(provider.requests.length, 1);
    assert.strictEqual(provider.requests[0]?.endpoint, '/repos/acme/widgets/pulls/12/reviews');
  });

  it('handleWriteback returns a typed error for invalid JSON', async () => {
    const { handler } = createHandler();
    const result = await handler.handleWriteback(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/7/reviews/draft@review.json',
      '{not valid json',
    );

    assert.strictEqual(result.success, false);
    assert.ok((result.error ?? '').match(/Invalid review JSON/));
  });

  it('parseReviewPayload rejects missing required fields', () => {
    const { handler } = createHandler();

    assert.throws(
      () =>
        handler.parseReviewPayload(
          JSON.stringify({
            event: 'COMMENT',
            body: 'summary',
            comments: [{ path: 'src/file.ts', side: 'RIGHT', body: 'Missing line number' }],
          }),
        ),
      /positive integer/,
    );
  });

  it('handleWriteback surfaces provider-side API failures', async () => {
    const { handler } = createHandler(() => ({
      status: 422,
      headers: {},
      data: { message: 'Review comments are invalid because the diff is outdated.' } satisfies JsonObject,
    }));

    const result = await handler.handleWriteback(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/7/reviews/draft@review.json',
      JSON.stringify({
        event: 'COMMENT',
        body: 'summary',
        comments: [{ path: 'src/file.ts', line: 4, side: 'RIGHT', body: 'Outdated diff' }],
      }),
    );

    assert.strictEqual(result.success, false);
    assert.ok((result.error ?? '').match(/422/));
    assert.ok((result.error ?? '').match(/outdated/));
  });

  it('updates and deletes canonical review ids', async () => {
    const { handler, provider } = createHandler((request) => ({
      status: request.method === 'PATCH' ? 200 : 204,
      headers: {},
      data: { id: 991 } satisfies JsonObject,
    }));

    const update = await handler.handleWriteback(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/7/reviews/991.json',
      JSON.stringify({ body: 'Updated review body.' }),
    );

    assert.strictEqual(update.success, true);
    assert.strictEqual(provider.requests[0]?.method, 'PATCH');
    assert.strictEqual(provider.requests[0]?.endpoint, '/repos/acme/widgets/pulls/7/reviews/991');
    assert.equal(
      handler.extractWritebackTarget('/github/repos/acme/widgets/pulls/7/reviews/draft@review.json').reviewId,
      undefined,
    );
    const readOnly = await handler.handleWriteback(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/7/reviews/991.json',
      JSON.stringify({ id: 991, body: 'Nope' }),
    );
    assert.strictEqual(readOnly.success, false);
    assert.match(readOnly.error ?? '', /read-only/);
    assert.deepStrictEqual(resolveDeleteRequest('/github/repos/acme/widgets/pulls/7/reviews/991.json'), {
      method: 'DELETE',
      baseUrl: 'https://api.github.com',
      endpoint: '/repos/acme/widgets/pulls/7/reviews/991',
      connectionId: '',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    assert.throws(
      () => resolveDeleteRequest('/github/repos/acme/widgets/pulls/7/reviews/draft@review.json'),
      /Unsupported GitHub delete writeback path/,
    );
  });

  it('resolves issue create writebacks to GitHub issue creation requests', () => {
    const request = resolveWritebackRequest(
      '/github/repos/acme/widgets/issues/create request.json',
      JSON.stringify({
        title: 'Ship writeback support',
        body: 'Wire issue create through file-native writeback.',
        labels: ['deploy-v1'],
        assignees: ['octocat'],
      }),
    );

    assert.strictEqual(request.method, 'POST');
    assert.strictEqual(request.baseUrl, 'https://api.github.com');
    assert.strictEqual(request.endpoint, '/repos/acme/widgets/issues');
    assert.strictEqual(request.connectionId, '');
    assert.deepStrictEqual(request.body, {
      title: 'Ship writeback support',
      body: 'Wire issue create through file-native writeback.',
      labels: ['deploy-v1'],
      assignees: ['octocat'],
    });
  });

  it('resolves canonical issue updates to GitHub issue patch requests', () => {
    const request = resolveWritebackRequest(
      '/github/repos/acme/widgets/issues/42.json',
      JSON.stringify({ state: 'closed' }),
    );

    assert.strictEqual(request.method, 'PATCH');
    assert.strictEqual(request.endpoint, '/repos/acme/widgets/issues/42');
    assert.deepStrictEqual(request.body, { state: 'closed' });
  });

  it('resolves issue comment create and update writebacks', () => {
    const create = resolveWritebackRequest(
      '/github/repos/acme/widgets/issues/42/comments/create comment.json',
      'Looks good to me.',
    );
    const update = resolveWritebackRequest(
      '/github/repos/acme/widgets/issues/42/comments/123.json',
      JSON.stringify({ body: 'Updated comment body.' }),
    );

    assert.strictEqual(create.method, 'POST');
    assert.strictEqual(create.endpoint, '/repos/acme/widgets/issues/42/comments');
    assert.deepStrictEqual(create.body, { body: 'Looks good to me.' });
    assert.strictEqual(update.method, 'PATCH');
    assert.strictEqual(update.endpoint, '/repos/acme/widgets/issues/comments/123');
    assert.deepStrictEqual(update.body, { body: 'Updated comment body.' });
  });

  it('rejects read-only fields in issue writebacks', () => {
    assert.throws(
      () =>
        resolveWritebackRequest(
          '/github/repos/acme/widgets/issues/create request.json',
          JSON.stringify({ id: 123, title: 'Nope' }),
        ),
      (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'id',
    );
  });
});
