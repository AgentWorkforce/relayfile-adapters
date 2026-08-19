import assert from 'node:assert/strict';
import test from 'node:test';

import { GitHubAdapter } from '../index.js';
import type { IngestResult } from './event-map.js';
import { extractEventKey, extractRepoInfo } from './event-map.js';
import { WebhookRouter } from './router.js';
import type { ConnectionProvider } from '../types.js';

function createResult(path: string): IngestResult {
  return {
    filesWritten: 1,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [path],
    errors: [],
  };
}

class RecordingAdapter extends GitHubAdapter {
  public calls: string[] = [];

  constructor() {
    super(unusedProvider, { connectionId: 'conn-fixture' });
  }

  override async ingestPullRequest(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`ingestPullRequest:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/pulls/7/meta.json');
  }

  override async updatePullRequest(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`updatePullRequest:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/pulls/7/diff.patch');
  }

  override async closePullRequest(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`closePullRequest:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/pulls/7/meta.json');
  }

  override async ingestReview(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`ingestReview:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/pulls/7/reviews/1.json');
  }

  override async ingestReviewComment(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`ingestReviewComment:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/pulls/7/comments/2.json');
  }

  override async ingestReviewThread(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`ingestReviewThread:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/pulls/7/review-threads/5.json');
  }

  override async ingestIssueComment(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`ingestIssueComment:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/issues/9/comments/3/meta.json');
  }

  override async ingestPushCommits(_payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push('ingestPushCommits');
    return createResult('/github/repos/acme/widgets/commits/head.json');
  }

  override async ingestIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`ingestIssue:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/issues/9/meta.json');
  }

  override async updateIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`updateIssue:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/issues/9/meta.json');
  }

  override async closeIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`closeIssue:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/issues/9/meta.json');
  }

  override async ingestCheckRun(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`ingestCheckRun:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/pulls/7/checks/4.json');
  }

  override async ingestCommitStatus(_payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push('ingestCommitStatus');
    return createResult('/github/repos/acme/widgets/pulls/7/meta.json');
  }

  override async ingestDeploymentStatus(payload: Record<string, unknown>): Promise<IngestResult> {
    this.calls.push(`ingestDeploymentStatus:${String(payload.action ?? '')}`);
    return createResult('/github/repos/acme/widgets/deployments/11/statuses/12.json');
  }
}

const unusedProvider: ConnectionProvider = {
  name: 'recording-provider',
  async proxy() {
    throw new Error('proxy should not be called in webhook router tests');
  },
};

test('extractEventKey combines the GitHub event header with payload action', () => {
  const eventKey = extractEventKey(
    {
      'X-GitHub-Event': 'pull_request',
    },
    { action: 'opened' },
  );

  assert.equal(eventKey, 'pull_request.opened');
});

test('extractRepoInfo parses repository and pull request metadata', () => {
  const repoInfo = extractRepoInfo({
    repository: {
      full_name: 'acme/widgets',
    },
    pull_request: {
      number: 7,
    },
  });

  assert.deepEqual(repoInfo, {
    owner: 'acme',
    repo: 'widgets',
    number: 7,
  });
});

test('extractRepoInfo parses repository and issue metadata', () => {
  const repoInfo = extractRepoInfo({
    repository: {
      owner: { login: 'acme' },
      name: 'widgets',
    },
    issue: {
      number: 9,
    },
  });

  assert.deepEqual(repoInfo, {
    owner: 'acme',
    repo: 'widgets',
    number: 9,
  });
});

test('WebhookRouter routes pull_request.opened to ingestPullRequest', async () => {
  const adapter = new RecordingAdapter();
  const router = new WebhookRouter(adapter);

  const result = await router.route(
    { 'x-github-event': 'pull_request' },
    {
      action: 'opened',
      repository: { full_name: 'acme/widgets' },
      pull_request: { number: 7 },
    },
  );

  assert.deepEqual(adapter.calls, ['ingestPullRequest:opened']);
  assert.deepEqual(result.paths, ['/github/repos/acme/widgets/pulls/7/meta.json']);
});

test('WebhookRouter routes issues.opened to ingestIssue', async () => {
  const adapter = new RecordingAdapter();
  const router = new WebhookRouter(adapter);

  const result = await router.route(
    { 'x-github-event': 'issues' },
    {
      action: 'opened',
      repository: { full_name: 'acme/widgets' },
      issue: { number: 9 },
    },
  );

  assert.deepEqual(adapter.calls, ['ingestIssue:opened']);
  assert.deepEqual(result.paths, ['/github/repos/acme/widgets/issues/9/meta.json']);
});

test('WebhookRouter routes issue_comment.created to ingestIssueComment', async () => {
  const adapter = new RecordingAdapter();
  const router = new WebhookRouter(adapter);

  const result = await router.route(
    { 'x-github-event': 'issue_comment' },
    {
      action: 'created',
      repository: { full_name: 'acme/widgets' },
      issue: { number: 9 },
      comment: { id: 3 },
    },
  );

  assert.deepEqual(adapter.calls, ['ingestIssueComment:created']);
  assert.deepEqual(result.paths, ['/github/repos/acme/widgets/issues/9/comments/3/meta.json']);
});

test('WebhookRouter routes issues.labeled to updateIssue', async () => {
  const adapter = new RecordingAdapter();
  const router = new WebhookRouter(adapter);

  const result = await router.route(
    { 'x-github-event': 'issues' },
    {
      action: 'labeled',
      label: { name: 'small' },
      repository: { full_name: 'acme/widgets' },
      issue: { number: 9 },
    },
  );

  assert.deepEqual(adapter.calls, ['updateIssue:labeled']);
  assert.deepEqual(result.paths, ['/github/repos/acme/widgets/issues/9/meta.json']);
});

test('WebhookRouter routes issues.unlabeled to updateIssue', async () => {
  const adapter = new RecordingAdapter();
  const router = new WebhookRouter(adapter);

  const result = await router.route(
    { 'x-github-event': 'issues' },
    {
      action: 'unlabeled',
      label: { name: 'small' },
      repository: { full_name: 'acme/widgets' },
      issue: { number: 9 },
    },
  );

  assert.deepEqual(adapter.calls, ['updateIssue:unlabeled']);
  assert.deepEqual(result.paths, ['/github/repos/acme/widgets/issues/9/meta.json']);
});

test('WebhookRouter routes check_run.completed to ingestCheckRun', async () => {
  const adapter = new RecordingAdapter();
  const router = new WebhookRouter(adapter);

  const result = await router.route(
    { 'x-github-event': 'check_run' },
    {
      action: 'completed',
      repository: { full_name: 'acme/widgets' },
      check_run: { id: 4 },
    },
  );

  assert.deepEqual(adapter.calls, ['ingestCheckRun:completed']);
  assert.deepEqual(result.paths, ['/github/repos/acme/widgets/pulls/7/checks/4.json']);
});

test('WebhookRouter routes deployment_status.created to ingestDeploymentStatus', async () => {
  const adapter = new RecordingAdapter();
  const router = new WebhookRouter(adapter);

  const result = await router.route(
    { 'x-github-event': 'deployment_status' },
    {
      id: 'delivery-level-id',
      action: 'created',
      repository: { full_name: 'acme/widgets' },
      deployment: { id: 11 },
      deployment_status: { id: 12, state: 'success' },
    },
  );

  assert.deepEqual(adapter.calls, ['ingestDeploymentStatus:created']);
  assert.deepEqual(result.paths, ['/github/repos/acme/widgets/deployments/11/statuses/12.json']);
});

test('GitHubAdapter routes deployment_status.created to the deployment status path', async () => {
  const adapter = new GitHubAdapter(unusedProvider, { connectionId: 'conn-fixture' });

  const result = await adapter.routeWebhook(
    {
      action: 'created',
      repository: { full_name: 'acme/widgets' },
      deployment: { id: 11 },
      deployment_status: { id: 12, state: 'success' },
    },
    'deployment_status.created',
  );

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, [
    '/github/repos/acme/widgets/deployments/11/statuses/12.json',
  ]);
  assert.deepEqual(result.errors, []);
});

test('WebhookRouter returns a typed error for unsupported events', async () => {
  const adapter = new RecordingAdapter();
  const router = new WebhookRouter(adapter);

  const result = await router.route(
    { 'x-github-event': 'repository' },
    {
      action: 'edited',
      repository: { full_name: 'acme/widgets' },
    },
  );

  assert.equal(result.filesWritten, 0);
  assert.equal(result.filesUpdated, 0);
  assert.equal(result.filesDeleted, 0);
  assert.deepEqual(result.paths, []);
  assert.deepEqual(result.errors, [
    {
      path: '/github/repos/acme/widgets',
      error: 'unsupported event',
    },
  ]);
});

test('WebhookRouter.isSupported reports known events', () => {
  const router = new WebhookRouter(new RecordingAdapter());

  assert.equal(router.isSupported('pull_request.opened'), true);
  assert.equal(router.isSupported('repository.edited'), false);
});

test('WebhookRouter.getSupportedEvents returns all mapped events', () => {
  const router = new WebhookRouter(new RecordingAdapter());
  const events = router.getSupportedEvents();

  assert.equal(events.length, 21);
  assert.deepEqual(events, [
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
});

test('GitHubAdapter.routeWebhook delegates to the router', async () => {
  const adapter = new RecordingAdapter();
  const result = await adapter.routeWebhook(
    {
      action: 'opened',
      repository: { full_name: 'acme/widgets' },
      issue: { number: 9 },
    },
    undefined,
    { 'x-github-event': 'issues' },
  );

  assert.deepEqual(adapter.calls, ['ingestIssue:opened']);
  assert.deepEqual(result.paths, ['/github/repos/acme/widgets/issues/9/meta.json']);
});
