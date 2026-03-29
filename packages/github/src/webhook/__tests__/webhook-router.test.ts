import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { GitHubAdapter } from '../../index.js';
import type { IngestResult } from '../event-map.js';
import { extractEventKey, extractRepoInfo } from '../event-map.js';
import { WebhookRouter } from '../router.js';

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
  const adapter = new GitHubAdapter();

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
    ingestPushCommits: mock.method(adapter, 'ingestPushCommits', async () =>
      createResult('/github/repos/acme/widgets/commits/head.json'),
    ),
    ingestIssue: mock.method(adapter, 'ingestIssue', async () =>
      createResult('/github/repos/acme/widgets/issues/9/meta.json'),
    ),
    closeIssue: mock.method(adapter, 'closeIssue', async () =>
      createResult('/github/repos/acme/widgets/issues/9/meta.json'),
    ),
    ingestCheckRun: mock.method(adapter, 'ingestCheckRun', async () =>
      createResult('/github/repos/acme/widgets/pulls/7/checks/4.json'),
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
    assert.strictEqual(router.isSupported('issues.opened'), true);
    assert.strictEqual(router.isSupported('check_run.completed'), true);
  });

  it('getSupportedEvents lists all 9 events', () => {
    const router = new WebhookRouter(createAdapterMocks().adapter);

    assert.deepStrictEqual(router.getSupportedEvents(), [
      'pull_request.opened',
      'pull_request.synchronize',
      'pull_request.closed',
      'pull_request_review.submitted',
      'pull_request_review_comment.created',
      'push',
      'issues.opened',
      'issues.closed',
      'check_run.completed',
    ]);
    assert.strictEqual(router.getSupportedEvents().length, 9);
  });
});
