import assert from 'node:assert/strict';
import test from 'node:test';

import { GitHubAdapter } from '../index.js';
import type { IngestResult } from '../types.js';
import { extractRepoInfo } from '../webhook/event-map.js';
import { WebhookRouter } from '../webhook/router.js';
import { createMockProvider } from './fixtures/mock-provider.ts';
import { mockIssuePayload, mockPRPayload, mockRepoContext, mockWebhookPayload } from './fixtures/index.ts';

interface RecordedCall {
  method: string;
  owner: string;
  repo: string;
  number?: number;
}

interface EventCase {
  readonly eventKey: string;
  readonly headers: Record<string, string>;
  readonly payload: Record<string, unknown>;
  readonly expectedMethod: string;
  readonly expectedRepoInfo: {
    owner: string;
    repo: string;
    number?: number;
  };
}

function createResult(path: string): IngestResult {
  return {
    filesWritten: 1,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [path],
    errors: [],
  };
}

class RecordingGitHubAdapter extends GitHubAdapter {
  public readonly calls: RecordedCall[] = [];

  constructor() {
    super(createMockProvider());
  }

  override async ingestPullRequest(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.record('ingestPullRequest', payload);
  }

  override async updatePullRequest(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.record('updatePullRequest', payload);
  }

  override async closePullRequest(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.record('closePullRequest', payload);
  }

  override async ingestReview(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.record('ingestReview', payload);
  }

  override async ingestReviewComment(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.record('ingestReviewComment', payload);
  }

  override async ingestPushCommits(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.record('ingestPushCommits', payload);
  }

  override async ingestIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.record('ingestIssue', payload);
  }

  override async closeIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.record('closeIssue', payload);
  }

  override async ingestCheckRun(payload: Record<string, unknown>): Promise<IngestResult> {
    return this.record('ingestCheckRun', payload);
  }

  private async record(method: string, payload: Record<string, unknown>): Promise<IngestResult> {
    const repoInfo = extractRepoInfo(payload);
    this.calls.push({ method, ...repoInfo });

    const numberSegment = repoInfo.number === undefined ? 'none' : String(repoInfo.number);
    return createResult(`/github/repos/${repoInfo.owner}/${repoInfo.repo}/${method}/${numberSegment}`);
  }
}

const repository = {
  ...mockWebhookPayload.repository,
  owner: { ...mockWebhookPayload.repository.owner },
};

const supportedEventCases: readonly EventCase[] = [
  {
    eventKey: 'pull_request.opened',
    headers: { 'x-github-event': 'pull_request' },
    payload: {
      ...mockWebhookPayload,
      action: 'opened',
      repository,
      pull_request: { ...mockPRPayload },
    },
    expectedMethod: 'ingestPullRequest',
    expectedRepoInfo: {
      owner: mockRepoContext.owner,
      repo: mockRepoContext.repo,
      number: mockPRPayload.number,
    },
  },
  {
    eventKey: 'pull_request.synchronize',
    headers: { 'x-github-event': 'pull_request' },
    payload: {
      ...mockWebhookPayload,
      action: 'synchronize',
      repository,
      pull_request: { ...mockPRPayload },
    },
    expectedMethod: 'updatePullRequest',
    expectedRepoInfo: {
      owner: mockRepoContext.owner,
      repo: mockRepoContext.repo,
      number: mockPRPayload.number,
    },
  },
  {
    eventKey: 'pull_request.closed',
    headers: { 'x-github-event': 'pull_request' },
    payload: {
      ...mockWebhookPayload,
      action: 'closed',
      repository,
      pull_request: { ...mockPRPayload, state: 'closed', closed_at: '2026-03-28T09:00:00Z' },
    },
    expectedMethod: 'closePullRequest',
    expectedRepoInfo: {
      owner: mockRepoContext.owner,
      repo: mockRepoContext.repo,
      number: mockPRPayload.number,
    },
  },
  {
    eventKey: 'pull_request_review.submitted',
    headers: { 'x-github-event': 'pull_request_review' },
    payload: {
      action: 'submitted',
      repository,
      pull_request: { ...mockPRPayload },
      review: {
        id: 7001,
        state: 'approved',
        body: 'Looks good.',
      },
    },
    expectedMethod: 'ingestReview',
    expectedRepoInfo: {
      owner: mockRepoContext.owner,
      repo: mockRepoContext.repo,
      number: mockPRPayload.number,
    },
  },
  {
    eventKey: 'pull_request_review_comment.created',
    headers: { 'x-github-event': 'pull_request_review_comment' },
    payload: {
      action: 'created',
      repository,
      pull_request: { ...mockPRPayload },
      comment: {
        id: 8101,
        path: 'src/index.ts',
        line: 2,
        body: 'Please keep this aligned with fixture expectations.',
      },
    },
    expectedMethod: 'ingestReviewComment',
    expectedRepoInfo: {
      owner: mockRepoContext.owner,
      repo: mockRepoContext.repo,
      number: mockPRPayload.number,
    },
  },
  {
    eventKey: 'push',
    headers: { 'x-github-event': 'push' },
    payload: {
      ref: 'refs/heads/main',
      before: mockRepoContext.baseSha,
      after: mockRepoContext.headSha,
      repository,
      commits: [
        {
          id: mockRepoContext.headSha,
          message: 'Refresh webhook fixtures',
        },
      ],
    },
    expectedMethod: 'ingestPushCommits',
    expectedRepoInfo: {
      owner: mockRepoContext.owner,
      repo: mockRepoContext.repo,
    },
  },
  {
    eventKey: 'issues.opened',
    headers: { 'x-github-event': 'issues' },
    payload: {
      action: 'opened',
      repository,
      issue: { ...mockIssuePayload },
    },
    expectedMethod: 'ingestIssue',
    expectedRepoInfo: {
      owner: mockRepoContext.owner,
      repo: mockRepoContext.repo,
      number: mockIssuePayload.number,
    },
  },
  {
    eventKey: 'issues.closed',
    headers: { 'x-github-event': 'issues' },
    payload: {
      action: 'closed',
      repository,
      issue: { ...mockIssuePayload, state: 'closed', closed_at: '2026-03-28T07:45:00Z' },
    },
    expectedMethod: 'closeIssue',
    expectedRepoInfo: {
      owner: mockRepoContext.owner,
      repo: mockRepoContext.repo,
      number: mockIssuePayload.number,
    },
  },
  {
    eventKey: 'check_run.completed',
    headers: { 'x-github-event': 'check_run' },
    payload: {
      action: 'completed',
      repository,
      check_run: {
        id: 9201,
        head_sha: mockRepoContext.headSha,
        conclusion: 'success',
        status: 'completed',
      },
    },
    expectedMethod: 'ingestCheckRun',
    expectedRepoInfo: {
      owner: mockRepoContext.owner,
      repo: mockRepoContext.repo,
    },
  },
] as const;

test('WebhookRouter routes every supported GitHub event to the correct adapter handler', async (t) => {
  for (const eventCase of supportedEventCases) {
    await t.test(eventCase.eventKey, async () => {
      const adapter = new RecordingGitHubAdapter();
      const router = new WebhookRouter(adapter);

      const result = await router.route(eventCase.headers, eventCase.payload);

      assert.deepEqual(adapter.calls, [
        {
          method: eventCase.expectedMethod,
          ...eventCase.expectedRepoInfo,
        },
      ]);
      assert.deepEqual(result, {
        filesWritten: 1,
        filesUpdated: 0,
        filesDeleted: 0,
        paths: [
          `/github/repos/${eventCase.expectedRepoInfo.owner}/${eventCase.expectedRepoInfo.repo}/${eventCase.expectedMethod}/${eventCase.expectedRepoInfo.number === undefined ? 'none' : String(eventCase.expectedRepoInfo.number)}`,
        ],
        errors: [],
      });
    });
  }
});

test('GitHubAdapter.routeWebhook routes with an explicit event type end to end', async () => {
  const adapter = new RecordingGitHubAdapter();
  const result = await adapter.routeWebhook(
    {
      ...mockWebhookPayload,
      action: 'opened',
      repository,
      pull_request: { ...mockPRPayload },
    },
    'pull_request.opened',
  );

  assert.deepEqual(adapter.calls, [
    {
      method: 'ingestPullRequest',
      owner: mockRepoContext.owner,
      repo: mockRepoContext.repo,
      number: mockPRPayload.number,
    },
  ]);
  assert.deepEqual(result.errors, []);
});

test('WebhookRouter returns an error IngestResult for unsupported events', async () => {
  const adapter = new RecordingGitHubAdapter();
  const router = new WebhookRouter(adapter);

  const result = await router.route(
    { 'x-github-event': 'repository' },
    {
      action: 'edited',
      repository,
    },
  );

  assert.deepEqual(adapter.calls, []);
  assert.deepEqual(result, {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [
      {
        path: `/github/repos/${mockRepoContext.owner}/${mockRepoContext.repo}`,
        error: 'unsupported event',
      },
    ],
  });
});

test('WebhookRouter handles malformed payloads without throwing and returns a typed error', async () => {
  const adapter = new RecordingGitHubAdapter();
  const router = new WebhookRouter(adapter);

  const result = await router.route(
    { 'x-github-event': 'pull_request' },
    {
      repository: 'octocat/hello-world',
      pull_request: null,
    } as unknown as Record<string, unknown>,
  );

  assert.deepEqual(adapter.calls, []);
  assert.deepEqual(result, {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [
      {
        path: '/github',
        error: 'unsupported event',
      },
    ],
  });
});
