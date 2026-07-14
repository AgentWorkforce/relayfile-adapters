import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { GitHubAdapter } from '../../index.js';
import type { IngestResult } from '../event-map.js';
import { extractEventKey, extractRepoInfo } from '../event-map.js';
import { WebhookRouter } from '../router.js';
import { createMockProvider } from '../../__tests__/fixtures/mock-provider.ts';

function createResult(path: string): IngestResult {
  return {
    filesWritten: 1,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [path],
    errors: [],
  };
}

function createAdapterMocks() {
  const adapter = new GitHubAdapter(createMockProvider());

  return {
    adapter,
    ingestPullRequest: mock.method(adapter, 'ingestPullRequest', async () =>
      createResult('/github/repos/acme/widgets/pulls/7/meta.json'),
    ),
    updatePullRequest: mock.method(adapter, 'updatePullRequest', async () =>
      createResult('/github/repos/acme/widgets/pulls/7/diff.patch'),
    ),
    closePullRequest: mock.method(adapter, 'closePullRequest', async () =>
      createResult('/github/repos/acme/widgets/pulls/7/meta.json'),
    ),
    ingestReview: mock.method(adapter, 'ingestReview', async () =>
      createResult('/github/repos/acme/widgets/pulls/7/reviews/1.json'),
    ),
    ingestReviewComment: mock.method(adapter, 'ingestReviewComment', async () =>
      createResult('/github/repos/acme/widgets/pulls/7/comments/2.json'),
    ),
    ingestReviewThread: mock.method(adapter, 'ingestReviewThread', async () =>
      createResult('/github/repos/acme/widgets/pulls/7/review-threads/5.json'),
    ),
    ingestIssueComment: mock.method(adapter, 'ingestIssueComment', async () =>
      createResult('/github/repos/acme/widgets/issues/9/comments/3/meta.json'),
    ),
    ingestPushCommits: mock.method(adapter, 'ingestPushCommits', async () =>
      createResult('/github/repos/acme/widgets/commits/head.json'),
    ),
    ingestIssue: mock.method(adapter, 'ingestIssue', async () =>
      createResult('/github/repos/acme/widgets/issues/9/meta.json'),
    ),
    updateIssue: mock.method(adapter, 'updateIssue', async () =>
      createResult('/github/repos/acme/widgets/issues/9/meta.json'),
    ),
    closeIssue: mock.method(adapter, 'closeIssue', async () =>
      createResult('/github/repos/acme/widgets/issues/9/meta.json'),
    ),
    ingestCheckRun: mock.method(adapter, 'ingestCheckRun', async () =>
      createResult('/github/repos/acme/widgets/pulls/7/checks/4.json'),
    ),
    ingestCommitStatus: mock.method(adapter, 'ingestCommitStatus', async () =>
      createResult('/github/repos/acme/widgets/pulls/7/meta.json'),
    ),
    ingestDeploymentStatus: mock.method(adapter, 'ingestDeploymentStatus', async () =>
      createResult('/github/repos/acme/widgets/deployments/11/statuses/12.json'),
    ),
  };
}

describe('extractEventKey', () => {
  it('combines event and action correctly', () => {
    assert.strictEqual(
      extractEventKey(
        {
          'X-GitHub-Event': 'pull_request',
        },
        { action: 'opened' },
      ),
      'pull_request.opened',
    );
  });
});

describe('extractRepoInfo', () => {
  it('parses PR payload', () => {
    assert.deepStrictEqual(
      extractRepoInfo({
        repository: {
          full_name: 'acme/widgets',
        },
        pull_request: {
          number: 7,
        },
      }),
      {
        owner: 'acme',
        repo: 'widgets',
        number: 7,
      },
    );
  });

  it('parses issue payload', () => {
    assert.deepStrictEqual(
      extractRepoInfo({
        repository: {
          owner: { login: 'acme' },
          name: 'widgets',
        },
        issue: {
          number: 9,
        },
      }),
      {
        owner: 'acme',
        repo: 'widgets',
        number: 9,
      },
    );
  });
});

describe('WebhookRouter', () => {
  it('route calls correct handler for PR opened', async () => {
    const mocks = createAdapterMocks();
    const router = new WebhookRouter(mocks.adapter);
    const payload = {
      action: 'opened',
      repository: { full_name: 'acme/widgets' },
      pull_request: { number: 7 },
    };

    const result = await router.route({ 'x-github-event': 'pull_request' }, payload);
    assert.deepStrictEqual(result, createResult('/github/repos/acme/widgets/pulls/7/meta.json'));
    assert.strictEqual(mocks.ingestPullRequest.mock.calls.length, 1);
    assert.deepStrictEqual(mocks.ingestPullRequest.mock.calls[0].arguments, [payload]);
    assert.strictEqual(mocks.ingestIssue.mock.calls.length, 0);
    assert.strictEqual(mocks.ingestCheckRun.mock.calls.length, 0);
  });

  it('route calls correct handler for issue opened', async () => {
    const mocks = createAdapterMocks();
    const router = new WebhookRouter(mocks.adapter);
    const payload = {
      action: 'opened',
      repository: { full_name: 'acme/widgets' },
      issue: { number: 9 },
    };

    const result = await router.route({ 'x-github-event': 'issues' }, payload);
    assert.deepStrictEqual(result, createResult('/github/repos/acme/widgets/issues/9/meta.json'));
    assert.strictEqual(mocks.ingestIssue.mock.calls.length, 1);
    assert.deepStrictEqual(mocks.ingestIssue.mock.calls[0].arguments, [payload]);
    assert.strictEqual(mocks.ingestPullRequest.mock.calls.length, 0);
    assert.strictEqual(mocks.ingestCheckRun.mock.calls.length, 0);
  });

  it('route calls correct handler for issue labeled', async () => {
    const mocks = createAdapterMocks();
    const router = new WebhookRouter(mocks.adapter);
    const payload = {
      action: 'labeled',
      label: { name: 'small' },
      repository: { full_name: 'acme/widgets' },
      issue: { number: 9 },
    };

    const result = await router.route({ 'x-github-event': 'issues' }, payload);
    assert.deepStrictEqual(result, createResult('/github/repos/acme/widgets/issues/9/meta.json'));
    assert.strictEqual(mocks.updateIssue.mock.calls.length, 1);
    assert.deepStrictEqual(mocks.updateIssue.mock.calls[0].arguments, [payload]);
    assert.strictEqual(mocks.ingestIssue.mock.calls.length, 0);
    assert.strictEqual(mocks.ingestPullRequest.mock.calls.length, 0);
    assert.strictEqual(mocks.ingestCheckRun.mock.calls.length, 0);
  });

  it('route calls correct handler for check_run completed', async () => {
    const mocks = createAdapterMocks();
    const router = new WebhookRouter(mocks.adapter);
    const payload = {
      action: 'completed',
      repository: { full_name: 'acme/widgets' },
      check_run: { id: 4 },
    };

    const result = await router.route({ 'x-github-event': 'check_run' }, payload);
    assert.deepStrictEqual(result, createResult('/github/repos/acme/widgets/pulls/7/checks/4.json'));
    assert.strictEqual(mocks.ingestCheckRun.mock.calls.length, 1);
    assert.deepStrictEqual(mocks.ingestCheckRun.mock.calls[0].arguments, [payload]);
    assert.strictEqual(mocks.ingestPullRequest.mock.calls.length, 0);
    assert.strictEqual(mocks.ingestIssue.mock.calls.length, 0);
  });

  it('route calls correct handler for deployment_status created', async () => {
    const mocks = createAdapterMocks();
    const router = new WebhookRouter(mocks.adapter);
    const payload = {
      action: 'created',
      repository: { full_name: 'acme/widgets' },
      deployment: { id: 11 },
      deployment_status: { id: 12, state: 'success' },
    };

    const result = await router.route({ 'x-github-event': 'deployment_status' }, payload);
    assert.deepStrictEqual(
      result,
      createResult('/github/repos/acme/widgets/deployments/11/statuses/12.json'),
    );
    assert.strictEqual(mocks.ingestDeploymentStatus.mock.calls.length, 1);
    assert.deepStrictEqual(mocks.ingestDeploymentStatus.mock.calls[0].arguments, [payload]);
    assert.strictEqual(mocks.ingestPullRequest.mock.calls.length, 0);
    assert.strictEqual(mocks.ingestIssue.mock.calls.length, 0);
  });

  it('adapter routeWebhook maps deployment_status.created to a scoped path', async () => {
    const adapter = new GitHubAdapter(createMockProvider());

    const result = await adapter.routeWebhook(
      {
        id: 'delivery-level-id',
        action: 'created',
        repository: { full_name: 'acme/widgets' },
        deployment: { id: 11 },
        deployment_status: { id: 12, state: 'success' },
      },
      'deployment_status.created',
    );

    assert.deepStrictEqual(result.paths, [
      '/github/repos/acme/widgets/deployments/11/statuses/12.json',
    ]);
    assert.deepStrictEqual(result.errors, []);
  });

  it('route returns error for unsupported event', async () => {
    const mocks = createAdapterMocks();
    const router = new WebhookRouter(mocks.adapter);

    const result = await router.route(
      { 'x-github-event': 'repository' },
      {
        action: 'edited',
        repository: { full_name: 'acme/widgets' },
      },
    );
    assert.deepStrictEqual(result, {
      filesWritten: 0,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [],
      errors: [
        {
          path: '/github/repos/acme/widgets',
          error: 'unsupported event',
        },
      ],
    });

    assert.strictEqual(mocks.ingestPullRequest.mock.calls.length, 0);
    assert.strictEqual(mocks.ingestIssue.mock.calls.length, 0);
    assert.strictEqual(mocks.ingestCheckRun.mock.calls.length, 0);
  });

  it('isSupported returns true for known events', () => {
    const router = new WebhookRouter(createAdapterMocks().adapter);

    assert.strictEqual(router.isSupported('pull_request.opened'), true);
    assert.strictEqual(router.isSupported('pull_request.edited'), true);
    assert.strictEqual(router.isSupported('issue_comment.created'), true);
    assert.strictEqual(router.isSupported('issues.opened'), true);
    assert.strictEqual(router.isSupported('issues.edited'), true);
    assert.strictEqual(router.isSupported('issues.labeled'), true);
    assert.strictEqual(router.isSupported('check_run.completed'), true);
    assert.strictEqual(router.isSupported('deployment_status.created'), true);
  });

  it('getSupportedEvents lists all 21 events', () => {
    const router = new WebhookRouter(createAdapterMocks().adapter);

    assert.deepStrictEqual(router.getSupportedEvents(), [
      'pull_request.opened',
      'pull_request.synchronize',
      'pull_request.edited',
      'pull_request.reopened',
      'pull_request.closed',
      'pull_request_review.submitted',
      'pull_request_review.edited',
      'pull_request_review.dismissed',
      'pull_request_review_comment.created',
      'pull_request_review_thread.resolved',
      'issue_comment.created',
      'push',
      'issues.opened',
      'issues.edited',
      'issues.labeled',
      'issues.unlabeled',
      'issues.reopened',
      'issues.closed',
      'check_run.completed',
      'status',
      'deployment_status.created',
    ]);
    assert.strictEqual(router.getSupportedEvents().length, 21);
  });
});
