import { describe, expect, it, vi } from 'vitest';

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
    ingestPullRequest: vi
      .spyOn(adapter, 'ingestPullRequest')
      .mockResolvedValue(createResult('/github/repos/acme/widgets/pulls/7/meta.json')),
    updatePullRequest: vi
      .spyOn(adapter, 'updatePullRequest')
      .mockResolvedValue(createResult('/github/repos/acme/widgets/pulls/7/diff.patch')),
    closePullRequest: vi
      .spyOn(adapter, 'closePullRequest')
      .mockResolvedValue(createResult('/github/repos/acme/widgets/pulls/7/meta.json')),
    ingestReview: vi
      .spyOn(adapter, 'ingestReview')
      .mockResolvedValue(createResult('/github/repos/acme/widgets/pulls/7/reviews/1.json')),
    ingestReviewComment: vi
      .spyOn(adapter, 'ingestReviewComment')
      .mockResolvedValue(createResult('/github/repos/acme/widgets/pulls/7/comments/2.json')),
    ingestPushCommits: vi
      .spyOn(adapter, 'ingestPushCommits')
      .mockResolvedValue(createResult('/github/repos/acme/widgets/commits/head.json')),
    ingestIssue: vi
      .spyOn(adapter, 'ingestIssue')
      .mockResolvedValue(createResult('/github/repos/acme/widgets/issues/9/meta.json')),
    closeIssue: vi
      .spyOn(adapter, 'closeIssue')
      .mockResolvedValue(createResult('/github/repos/acme/widgets/issues/9/meta.json')),
    ingestCheckRun: vi
      .spyOn(adapter, 'ingestCheckRun')
      .mockResolvedValue(createResult('/github/repos/acme/widgets/pulls/7/checks/4.json')),
  };
}

describe('extractEventKey', () => {
  it('combines event and action correctly', () => {
    expect(
      extractEventKey(
        {
          'X-GitHub-Event': 'pull_request',
        },
        { action: 'opened' },
      ),
    ).toBe('pull_request.opened');
  });
});

describe('extractRepoInfo', () => {
  it('parses PR payload', () => {
    expect(
      extractRepoInfo({
        repository: {
          full_name: 'acme/widgets',
        },
        pull_request: {
          number: 7,
        },
      }),
    ).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 7,
    });
  });

  it('parses issue payload', () => {
    expect(
      extractRepoInfo({
        repository: {
          owner: { login: 'acme' },
          name: 'widgets',
        },
        issue: {
          number: 9,
        },
      }),
    ).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 9,
    });
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

    await expect(router.route({ 'x-github-event': 'pull_request' }, payload)).resolves.toEqual(
      createResult('/github/repos/acme/widgets/pulls/7/meta.json'),
    );
    expect(mocks.ingestPullRequest).toHaveBeenCalledTimes(1);
    expect(mocks.ingestPullRequest).toHaveBeenCalledWith(payload);
    expect(mocks.ingestIssue).not.toHaveBeenCalled();
    expect(mocks.ingestCheckRun).not.toHaveBeenCalled();
  });

  it('route calls correct handler for issue opened', async () => {
    const mocks = createAdapterMocks();
    const router = new WebhookRouter(mocks.adapter);
    const payload = {
      action: 'opened',
      repository: { full_name: 'acme/widgets' },
      issue: { number: 9 },
    };

    await expect(router.route({ 'x-github-event': 'issues' }, payload)).resolves.toEqual(
      createResult('/github/repos/acme/widgets/issues/9/meta.json'),
    );
    expect(mocks.ingestIssue).toHaveBeenCalledTimes(1);
    expect(mocks.ingestIssue).toHaveBeenCalledWith(payload);
    expect(mocks.ingestPullRequest).not.toHaveBeenCalled();
    expect(mocks.ingestCheckRun).not.toHaveBeenCalled();
  });

  it('route calls correct handler for check_run completed', async () => {
    const mocks = createAdapterMocks();
    const router = new WebhookRouter(mocks.adapter);
    const payload = {
      action: 'completed',
      repository: { full_name: 'acme/widgets' },
      check_run: { id: 4 },
    };

    await expect(router.route({ 'x-github-event': 'check_run' }, payload)).resolves.toEqual(
      createResult('/github/repos/acme/widgets/pulls/7/checks/4.json'),
    );
    expect(mocks.ingestCheckRun).toHaveBeenCalledTimes(1);
    expect(mocks.ingestCheckRun).toHaveBeenCalledWith(payload);
    expect(mocks.ingestPullRequest).not.toHaveBeenCalled();
    expect(mocks.ingestIssue).not.toHaveBeenCalled();
  });

  it('route returns error for unsupported event', async () => {
    const mocks = createAdapterMocks();
    const router = new WebhookRouter(mocks.adapter);

    await expect(
      router.route(
        { 'x-github-event': 'repository' },
        {
          action: 'edited',
          repository: { full_name: 'acme/widgets' },
        },
      ),
    ).resolves.toEqual({
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

    expect(mocks.ingestPullRequest).not.toHaveBeenCalled();
    expect(mocks.ingestIssue).not.toHaveBeenCalled();
    expect(mocks.ingestCheckRun).not.toHaveBeenCalled();
  });

  it('isSupported returns true for known events', () => {
    const router = new WebhookRouter(createAdapterMocks().adapter);

    expect(router.isSupported('pull_request.opened')).toBe(true);
    expect(router.isSupported('issues.opened')).toBe(true);
    expect(router.isSupported('check_run.completed')).toBe(true);
  });

  it('getSupportedEvents lists all 9 events', () => {
    const router = new WebhookRouter(createAdapterMocks().adapter);

    expect(router.getSupportedEvents()).toEqual([
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
    expect(router.getSupportedEvents()).toHaveLength(9);
  });
});
