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

  it('writeBack creates PR review comment replies through the adapter pipeline', async () => {
    const { handler, provider } = createHandler(() => ({
      status: 201,
      headers: {},
      data: { id: 1001 } satisfies JsonObject,
    }));

    const result = await handler.writeBack(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/12/review-comments/991/replies/reply-draft.json',
      JSON.stringify({ body: 'Thanks, updated this branch.' }),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.externalId, '1001');
    assert.strictEqual(provider.requests.length, 1);
    assert.strictEqual(provider.requests[0]?.method, 'POST');
    assert.strictEqual(
      provider.requests[0]?.endpoint,
      '/repos/acme/widgets/pulls/12/comments/991/replies',
    );
    assert.strictEqual(provider.requests[0]?.connectionId, 'conn-default');
    assert.strictEqual(provider.requests[0]?.headers?.['Provider-Config-Key'], 'github-app-oauth');
    assert.deepStrictEqual(provider.requests[0]?.body, {
      body: 'Thanks, updated this branch.',
    });
  });

  it('handleWriteback merges pull requests through the GitHub merge endpoint', async () => {
    const { handler, provider } = createHandler(() => ({
      status: 200,
      headers: {},
      data: { merged: true, sha: 'abc123' } satisfies JsonObject,
    }));

    const result = await handler.handleWriteback(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/7/merge.json',
      JSON.stringify({
        method: 'rebase',
        commitTitle: 'Merge PR #7',
        commitMessage: 'Ship it.',
        sha: 'reviewed-head',
        metadata: {
          connectionId: 'conn-merge',
          providerConfigKey: 'github-custom',
        },
      }),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.externalId, 'abc123');
    assert.strictEqual(provider.requests.length, 1);
    assert.strictEqual(provider.requests[0]?.method, 'PUT');
    assert.strictEqual(provider.requests[0]?.endpoint, '/repos/acme/widgets/pulls/7/merge');
    assert.strictEqual(provider.requests[0]?.connectionId, 'conn-merge');
    assert.strictEqual(provider.requests[0]?.headers?.['Provider-Config-Key'], 'github-custom');
    assert.deepStrictEqual(provider.requests[0]?.body, {
      merge_method: 'rebase',
      commit_title: 'Merge PR #7',
      commit_message: 'Ship it.',
      sha: 'reviewed-head',
    });
  });

  it('handleWriteback omits merge method when the payload does not specify one', async () => {
    const { handler, provider } = createHandler(() => ({
      status: 200,
      headers: {},
      data: { merged: true, sha: 'def456' } satisfies JsonObject,
    }));

    const result = await handler.handleWriteback(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/7__finish-feature/merge.json',
      JSON.stringify({}),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(provider.requests[0]?.endpoint, '/repos/acme/widgets/pulls/7/merge');
    assert.deepStrictEqual(provider.requests[0]?.body, {});
  });

  it('handleWriteback treats a 2xx merge response without a JSON object body as success', async () => {
    const { handler } = createHandler(() => ({
      status: 204,
      headers: {},
      data: null,
    }));

    const result = await handler.handleWriteback(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/7/merge.json',
      JSON.stringify({ method: 'squash' }),
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.externalId, undefined);
  });

  it('handleWriteback rejects invalid pull request merge payloads', async () => {
    const { handler, provider } = createHandler();

    const result = await handler.handleWriteback(
      'workspace-1',
      '/github/repos/acme/widgets/pulls/7/merge.json',
      JSON.stringify({ merge_method: null, commit_title: 42 }),
    );

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? '', /merge payload\.method must be one of merge, squash, rebase/);
    assert.strictEqual(provider.requests.length, 0);
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

  it('resolves directory-record issue comment updates (comments/<id>/meta.json)', () => {
    // Canonical comment records are directory records; editing the meta.json
    // must patch the same comment the legacy flat path addressed.
    const update = resolveWritebackRequest(
      '/github/repos/acme/widgets/issues/42/comments/123/meta.json',
      JSON.stringify({ body: 'Updated via directory record.' }),
    );

    assert.strictEqual(update.method, 'PATCH');
    assert.strictEqual(update.endpoint, '/repos/acme/widgets/issues/comments/123');
    assert.deepStrictEqual(update.body, { body: 'Updated via directory record.' });
  });

  it('resolves pull request merge writebacks to GitHub merge requests', () => {
    const request = resolveWritebackRequest(
      '/github/repos/acme/widgets/pulls/42/merge.json',
      JSON.stringify({
        method: 'merge',
        commitTitle: 'Merge pull request #42',
        commitMessage: 'Approved by automation.',
      }),
    );

    assert.strictEqual(request.method, 'PUT');
    assert.strictEqual(request.baseUrl, 'https://api.github.com');
    assert.strictEqual(request.endpoint, '/repos/acme/widgets/pulls/42/merge');
    assert.strictEqual(request.connectionId, '');
    assert.deepStrictEqual(request.body, {
      merge_method: 'merge',
      commit_title: 'Merge pull request #42',
      commit_message: 'Approved by automation.',
    });
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

  it('resolves PR review comment reply writebacks to GitHub replies endpoint', () => {
    const request = resolveWritebackRequest(
      '/github/repos/acme/widgets/pulls/42/review-comments/999/replies/reply-draft.json',
      JSON.stringify({ body: 'Thanks for the feedback!' }),
    );

    assert.strictEqual(request.method, 'POST');
    assert.strictEqual(request.baseUrl, 'https://api.github.com');
    assert.strictEqual(request.endpoint, '/repos/acme/widgets/pulls/42/comments/999/replies');
    assert.strictEqual(request.connectionId, '');
    assert.deepStrictEqual(request.body, { body: 'Thanks for the feedback!' });
  });

  it('resolves PR review comment reply with plain-text body', () => {
    const request = resolveWritebackRequest(
      '/github/repos/acme/widgets/pulls/7/review-comments/123/replies/new-reply.json',
      'Acknowledged, will update.',
    );

    assert.strictEqual(request.method, 'POST');
    assert.strictEqual(request.endpoint, '/repos/acme/widgets/pulls/7/comments/123/replies');
    assert.deepStrictEqual(request.body, { body: 'Acknowledged, will update.' });
  });

  it('resolves PR review comment reply on PR with slug segment', () => {
    const request = resolveWritebackRequest(
      '/github/repos/acme/widgets/pulls/42__fix-bug/review-comments/999/replies/draft.json',
      JSON.stringify({ body: 'Reply to slugged PR comment.' }),
    );

    assert.strictEqual(request.method, 'POST');
    assert.strictEqual(request.endpoint, '/repos/acme/widgets/pulls/42/comments/999/replies');
  });

  it('rejects PR review comment reply with empty body', () => {
    assert.throws(
      () =>
        resolveWritebackRequest(
          '/github/repos/acme/widgets/pulls/42/review-comments/999/replies/draft.json',
          JSON.stringify({ body: '   ' }),
        ),
      /body must be a non-empty string/,
    );
  });

  it('does not route replies through the synced flat PR comments namespace', () => {
    assert.throws(
      () =>
        resolveWritebackRequest(
          '/github/repos/acme/widgets/pulls/42/comments/999/replies/draft.json',
          JSON.stringify({ body: 'This path would collide with comments/999.json.' }),
        ),
      /Unsupported GitHub writeback path/,
    );
  });
});
