import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
  assert.strictEqual(typeof result.filesWritten, 'number');
  assert.strictEqual(typeof result.filesUpdated, 'number');
  assert.strictEqual(typeof result.filesDeleted, 'number');
  assert.ok(Array.isArray(result.paths));
  assert.ok(Array.isArray(result.errors));

  assert.strictEqual(result.paths.every((path) => typeof path === 'string'), true);
  assert.strictEqual(
    result.errors.every(
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        typeof error.path === 'string' &&
        typeof error.error === 'string',
    ),
    true,
  );
}

describe('GitHubAdapter scaffold', () => {
  it('can be instantiated with a mock provider', () => {
    const adapter = createAdapter();

    assert.ok(adapter instanceof GitHubAdapter);
    assert.strictEqual(adapter.version, '0.1.0');
  });

  it('extends IntegrationAdapter', () => {
    const adapter = createAdapter();

    assert.ok(adapter instanceof IntegrationAdapter);
  });

  it("adapter.name returns 'github'", () => {
    const adapter = createAdapter();

    assert.strictEqual(adapter.name, 'github');
  });

  it('validateConfig applies defaults correctly', () => {
    const config = validateConfig({
      owner: 'octocat',
      repo: 'hello-world',
    });

    assert.strictEqual(config.owner, 'octocat');
    assert.strictEqual(config.repo, 'hello-world');
    assert.strictEqual(config.baseUrl, DEFAULT_CONFIG.baseUrl);
    assert.strictEqual(config.defaultBranch, DEFAULT_CONFIG.defaultBranch);
    assert.strictEqual(config.fetchFileContents, DEFAULT_CONFIG.fetchFileContents);
    assert.strictEqual(config.maxFileSizeBytes, DEFAULT_CONFIG.maxFileSizeBytes);
    assert.deepStrictEqual(config.supportedEvents, DEFAULT_CONFIG.supportedEvents);
    assert.notStrictEqual(config.supportedEvents, DEFAULT_CONFIG.supportedEvents);
  });

  it('validateConfig rejects invalid config', () => {
    assert.throws(() => validateConfig({ baseUrl: '   ' }), /baseUrl must be a non-empty string/);
    assert.throws(
      () => validateConfig({ defaultBranch: '' }),
      /defaultBranch must be a non-empty string/,
    );
    assert.throws(
      () => validateConfig({ fetchFileContents: 'yes' as never }),
      /fetchFileContents must be a boolean/,
    );
    assert.throws(
      () => validateConfig({ maxFileSizeBytes: 0 }),
      /maxFileSizeBytes must be a positive integer/,
    );
    assert.throws(
      () => validateConfig({ supportedEvents: 'pull_request.opened' as never }),
      /supportedEvents must be an array of strings/,
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
      assert.strictEqual(typeof name, 'string');
    }
  });
});
