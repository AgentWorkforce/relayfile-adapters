import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { githubIssuePath, githubPullRequestPath } from '../path-mapper.js';
import type {
  GitHubRequestProvider,
  JsonObject,
  ProxyRequest,
  ProxyResponse,
} from '../types.js';
import { GithubProactiveReviewAdapter } from './review-adapter.github.js';

class FakeProvider implements GitHubRequestProvider {
  readonly name = 'fake-nango';
  readonly requests: ProxyRequest[] = [];

  constructor(
    private readonly responseFactory: (request: ProxyRequest) => ProxyResponse = () => ({
      status: 201,
      headers: {},
      data: { id: 991 },
    }),
  ) {}

  async proxy(request: ProxyRequest): Promise<ProxyResponse> {
    this.requests.push(request);
    return this.responseFactory(request);
  }
}

function createAdapter(
  responseFactory?: (request: ProxyRequest) => ProxyResponse,
): { adapter: GithubProactiveReviewAdapter; provider: FakeProvider } {
  const provider = new FakeProvider(responseFactory);
  const adapter = new GithubProactiveReviewAdapter(provider, {
    defaultConnectionId: 'conn-default',
  });
  return { adapter, provider };
}

describe('GithubProactiveReviewAdapter', () => {
  it('derives stable work item keys from GitHub issue and pull request paths', () => {
    const { adapter } = createAdapter();

    assert.strictEqual(
      adapter.deriveWorkItemKey(githubIssuePath('acme', 'widgets', 42, 'Crash on login')),
      'github:acme/widgets#42',
    );
    assert.strictEqual(
      adapter.deriveWorkItemKey(githubPullRequestPath('acme', 'widgets', 7, 'Fix login')),
      'github-pr:acme/widgets#7',
    );
  });

  it('derives work item keys from GitHub issue webhook payloads', () => {
    const { adapter } = createAdapter();

    assert.strictEqual(
      adapter.deriveWorkItemKey({
        payload: {
          issue: { number: 13 },
          repository: { full_name: 'acme/widgets' },
        },
      }),
      'github:acme/widgets#13',
    );
  });

  it('classifies GitHub pull request payloads as change request contexts', () => {
    const { adapter } = createAdapter();

    const context = adapter.classifyChangeRequest({
      repository: { full_name: 'acme/widgets' },
      pull_request: {
        number: 9,
        title: 'Add proactive review adapter',
        html_url: 'https://github.com/acme/widgets/pull/9',
        head: { ref: 'feature/review-adapter', sha: 'head-sha' },
        base: { ref: 'main', sha: 'base-sha' },
      },
    });

    assert.deepStrictEqual(context, {
      provider: 'github',
      key: 'github-pr:acme/widgets#9',
      owner: 'acme',
      repo: 'widgets',
      number: 9,
      title: 'Add proactive review adapter',
      url: 'https://github.com/acme/widgets/pull/9',
      headRef: 'feature/review-adapter',
      headSha: 'head-sha',
      baseRef: 'main',
      baseSha: 'base-sha',
      payload: {
        repository: { full_name: 'acme/widgets' },
        pull_request: {
          number: 9,
          title: 'Add proactive review adapter',
          html_url: 'https://github.com/acme/widgets/pull/9',
          head: { ref: 'feature/review-adapter', sha: 'head-sha' },
          base: { ref: 'main', sha: 'base-sha' },
        },
      },
    });
  });

  it('normalizes GitHub mergeability states for proactive autofix', () => {
    const { adapter } = createAdapter();

    assert.strictEqual(adapter.classifyMergeState({ mergeable_state: 'clean' }), 'clean');
    assert.strictEqual(adapter.classifyMergeState({ mergeable_state: 'dirty' }), 'dirty');
    assert.strictEqual(adapter.classifyMergeState({ mergeable_state: 'behind' }), 'dirty');
    assert.strictEqual(adapter.classifyMergeState({ mergeable_state: 'blocked' }), 'blocked');
    assert.strictEqual(adapter.classifyMergeState({ mergeable: false }), 'dirty');
    assert.strictEqual(adapter.classifyMergeState({ mergeable: true }), 'clean');
    assert.strictEqual(adapter.classifyMergeState({ mergeable_state: 'unknown' }), 'unknown');
  });

  it('exposes GitHub scope globs and self-trigger identities', () => {
    const { adapter } = createAdapter();

    assert.deepStrictEqual(adapter.scopePaths(), {
      workItems: '/github/repos/**/issues/**',
      changeRequests: '/github/repos/**/pulls/**',
    });
    assert.deepStrictEqual(
      adapter.selfBotIdentity('review', {
        metadata: { app: { slug: 'agent-relay-bot' } },
      }),
      { login: 'agent-relay-bot[bot]' },
    );
    assert.deepStrictEqual(adapter.selfBotIdentity('autofix', {}), {
      login: 'relay-conflict-autofix[bot]',
    });
    assert.deepStrictEqual(adapter.selfTriggerEvents('review'), [
      'pull_request.synchronize',
      'pull_request_review.submitted',
      'pull_request_review_comment.created',
      'issue_comment.created',
    ]);
    assert.deepStrictEqual(adapter.selfTriggerEvents('autofix'), [
      'pull_request.synchronize',
    ]);
  });

  it('submits reviews through the existing GitHub writeback handler mapping', async () => {
    const { adapter, provider } = createAdapter();

    const result = await adapter.submitReview(
      {
        event: 'COMMENT',
        body: 'Review summary.',
        comments: [
          {
            path: 'src/index.ts',
            line: 14,
            body: 'Use the canonical adapter type here.',
            suggestion: 'const adapter = createGithubProactiveReviewAdapter(provider);',
          },
        ],
      },
      {
        changeRequest: {
          provider: 'github',
          key: 'github-pr:acme/widgets#7',
          owner: 'acme',
          repo: 'widgets',
          number: 7,
        },
        diffRefs: { headSha: 'abc123' },
        integration: { connectionId: 'conn-review', providerConfigKey: 'github-custom' },
      },
    );

    assert.strictEqual(result.status, 'complete');
    assert.strictEqual(provider.requests.length, 1);
    assert.strictEqual(provider.requests[0]?.method, 'POST');
    assert.strictEqual(provider.requests[0]?.endpoint, '/repos/acme/widgets/pulls/7/reviews');
    assert.strictEqual(provider.requests[0]?.connectionId, 'conn-review');
    assert.strictEqual(provider.requests[0]?.headers?.['Provider-Config-Key'], 'github-custom');

    const body = provider.requests[0]?.body as JsonObject;
    assert.strictEqual(body.commit_id, 'abc123');
    assert.strictEqual(body.event, 'COMMENT');
    const comments = body.comments as JsonObject[];
    assert.strictEqual(comments[0]?.side, 'RIGHT');
    assert.match(String(comments[0]?.body), /```suggestion/);
  });

  it('posts claim comments and opens/update-branches change requests via GitHub proxy calls', async () => {
    const { adapter, provider } = createAdapter(() => ({
      status: 200,
      headers: {},
      data: { ok: true },
    }));

    assert.deepStrictEqual(
      await adapter.postClaimComment({
        owner: 'acme',
        repo: 'widgets',
        workItemNumber: 42,
        body: 'Claiming this issue.',
        integration: { connectionId: 'conn-claim' },
      }),
      { success: true, providerRef: { ok: true } },
    );
    assert.deepStrictEqual(
      await adapter.openChangeRequest({
        owner: 'acme',
        repo: 'widgets',
        title: 'Fix issue',
        head: 'agent/fix-issue',
        base: 'main',
        body: 'Automated fix.',
        integration: { connectionId: 'conn-pr' },
      }),
      { success: true, providerRef: { ok: true } },
    );
    assert.deepStrictEqual(
      await adapter.rebaseChangeRequest({
        owner: 'acme',
        repo: 'widgets',
        number: 7,
        expectedHeadSha: 'head-sha',
        integration: { connectionId: 'conn-rebase' },
      }),
      { success: true, providerRef: { ok: true } },
    );

    assert.deepStrictEqual(
      provider.requests.map((request) => [request.method, request.endpoint, request.connectionId]),
      [
        ['POST', '/repos/acme/widgets/issues/42/comments', 'conn-claim'],
        ['POST', '/repos/acme/widgets/pulls', 'conn-pr'],
        ['PUT', '/repos/acme/widgets/pulls/7/update-branch', 'conn-rebase'],
      ],
    );
  });
});
