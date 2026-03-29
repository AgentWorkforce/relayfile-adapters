import { describe, expect, it } from 'vitest';

import {
  GitHubAdapter,
  IntegrationAdapter,
  type IngestResult,
  type NormalizedWebhook,
} from '../index.js';
import { DEFAULT_CONFIG, validateConfig } from '../config.js';
import { createMockProvider } from './fixtures/mock-provider.ts';

const REPO_PAYLOAD = {
  repository: {
    full_name: 'octocat/hello-world',
    name: 'hello-world',
    owner: { login: 'octocat' },
  },
} satisfies Record<string, unknown>;

function createAdapter(): GitHubAdapter {
  return new GitHubAdapter(createMockProvider(), {
    owner: 'octocat',
    repo: 'hello-world',
  });
}

function expectIngestResultShape(result: IngestResult): void {
  expect(result).toEqual(
    expect.objectContaining({
      filesWritten: expect.any(Number),
      filesUpdated: expect.any(Number),
      filesDeleted: expect.any(Number),
      paths: expect.any(Array),
      errors: expect.any(Array),
    }),
  );

  expect(result.paths.every((path) => typeof path === 'string')).toBe(true);
  expect(
    result.errors.every(
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        typeof error.path === 'string' &&
        typeof error.error === 'string',
    ),
  ).toBe(true);
}

describe('GitHubAdapter scaffold', () => {
  it('can be instantiated with a mock provider', () => {
    const adapter = createAdapter();

    expect(adapter).toBeInstanceOf(GitHubAdapter);
    expect(adapter.version).toBe('0.1.0');
  });

  it('extends IntegrationAdapter', () => {
    const adapter = createAdapter();

    expect(adapter).toBeInstanceOf(IntegrationAdapter);
  });

  it("adapter.name returns 'github'", () => {
    const adapter = createAdapter();

    expect(adapter.name).toBe('github');
  });

  it('validateConfig applies defaults correctly', () => {
    const config = validateConfig({
      owner: 'octocat',
      repo: 'hello-world',
    });

    expect(config).toMatchObject({
      owner: 'octocat',
      repo: 'hello-world',
      baseUrl: DEFAULT_CONFIG.baseUrl,
      defaultBranch: DEFAULT_CONFIG.defaultBranch,
      fetchFileContents: DEFAULT_CONFIG.fetchFileContents,
      maxFileSizeBytes: DEFAULT_CONFIG.maxFileSizeBytes,
      supportedEvents: DEFAULT_CONFIG.supportedEvents,
    });
    expect(config.supportedEvents).not.toBe(DEFAULT_CONFIG.supportedEvents);
  });

  it('validateConfig rejects invalid config', () => {
    expect(() => validateConfig({ baseUrl: '   ' })).toThrow('baseUrl must be a non-empty string');
    expect(() => validateConfig({ defaultBranch: '' })).toThrow(
      'defaultBranch must be a non-empty string',
    );
    expect(() => validateConfig({ fetchFileContents: 'yes' as never })).toThrow(
      'fetchFileContents must be a boolean',
    );
    expect(() => validateConfig({ maxFileSizeBytes: 0 })).toThrow(
      'maxFileSizeBytes must be a positive integer',
    );
    expect(() => validateConfig({ supportedEvents: 'pull_request.opened' as never })).toThrow(
      'supportedEvents must be an array of strings',
    );
  });

  it('all stub methods return IngestResult shape', async () => {
    const adapter = createAdapter();
    const webhookEvent: NormalizedWebhook = {
      provider: 'github',
      connectionId: 'mock-connection',
      eventType: 'pull_request.opened',
      objectType: 'pull_request',
      objectId: '42',
      payload: {
        ...REPO_PAYLOAD,
        action: 'opened',
        number: 42,
        pull_request: { number: 42 },
      },
    };

    const cases: Array<[string, Promise<IngestResult>]> = [
      [
        'ingestWebhook',
        adapter.ingestWebhook('workspace-1', webhookEvent),
      ],
      [
        'ingestPullRequest',
        adapter.ingestPullRequest({
          ...REPO_PAYLOAD,
          number: 42,
          pull_request: { number: 42 },
        }),
      ],
      [
        'updatePullRequest',
        adapter.updatePullRequest({
          ...REPO_PAYLOAD,
          number: 42,
          pull_request: { number: 42 },
        }),
      ],
      [
        'closePullRequest',
        adapter.closePullRequest({
          ...REPO_PAYLOAD,
          action: 'closed',
          number: 42,
          pull_request: { number: 42 },
        }),
      ],
      [
        'ingestReview',
        adapter.ingestReview({
          ...REPO_PAYLOAD,
          action: 'submitted',
          pull_request: { number: 42 },
          review: { id: 101 },
        }),
      ],
      [
        'ingestReviewComment',
        adapter.ingestReviewComment({
          ...REPO_PAYLOAD,
          id: 102,
          pull_request: { number: 42 },
        }),
      ],
      [
        'ingestPushCommits',
        adapter.ingestPushCommits({
          ...REPO_PAYLOAD,
          after: 'abc123',
          head_commit: { id: 'abc123' },
        }),
      ],
      [
        'ingestIssue',
        adapter.ingestIssue({
          ...REPO_PAYLOAD,
          issue: { number: 10 },
        }),
      ],
      [
        'closeIssue',
        adapter.closeIssue({
          ...REPO_PAYLOAD,
          action: 'closed',
          issue: { number: 10 },
        }),
      ],
      [
        'ingestCheckRun',
        adapter.ingestCheckRun({
          ...REPO_PAYLOAD,
          check_run: { id: 7 },
        }),
      ],
    ];

    for (const [name, resultPromise] of cases) {
      expectIngestResultShape(await resultPromise);
      expect(name).toBeTypeOf('string');
    }
  });
});
