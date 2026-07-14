import assert from 'node:assert/strict';
import test from 'node:test';

import { GitHubAdapter } from '../index.js';
import { githubByIdAliasPath, githubCommitPath, githubPullRequestPath } from '../path-mapper.js';
import type { GitHubRequestProvider, ProxyRequest, ProxyResponse } from '../types.js';
import { mockDiff, mockPRFiles, mockPRPayload, mockRepoContext } from './fixtures/index.js';

const owner = mockRepoContext.owner;
const repo = mockRepoContext.repo;
const number = mockPRPayload.number;
const canonical = githubPullRequestPath(owner, repo, number, mockPRPayload.title);
const byId = githubByIdAliasPath(owner, repo, 'pulls', number);

function memoryProvider(exposeConnectionId = true) {
  const files = new Map<string, string>();
  const requests: ProxyRequest[] = [];
  let reviewState = 'CHANGES_REQUESTED';
  let checkStatus = 'in_progress';
  let checkConclusion: string | null = null;
  let classicState = 'pending';
  let mergeableState = 'blocked';
  let malformedPull = false;
  let statusPullPages: Array<Array<{ number: number }>> | undefined;

  const provider: GitHubRequestProvider & {
    writeFile(path: string, content: string): Promise<void>;
    readFile(path: string): Promise<string | undefined>;
    exists(path: string): boolean;
    deleteFile(path: string): Promise<void>;
  } = {
    name: 'gate-webhook-fixture',
    async proxy(request: ProxyRequest): Promise<ProxyResponse> {
      requests.push(request);
      const pullPrefix = `/repos/${owner}/${repo}/pulls/${number}`;
      if (request.endpoint === pullPrefix && request.headers?.Accept === 'application/vnd.github.diff') {
        return { status: 200, headers: {}, data: mockDiff };
      }
      if (request.endpoint === pullPrefix) {
        return {
          status: 200,
          headers: {},
          data: malformedPull ? { number } : {
            ...mockPRPayload,
            head: {
              ...mockPRPayload.head,
              repo: { ...mockPRPayload.head.repo, html_url: `https://github.com/${owner}/${repo}` },
            },
            base: {
              ...mockPRPayload.base,
              repo: { ...mockPRPayload.base.repo, html_url: `https://github.com/${owner}/${repo}` },
            },
            merged: false,
            mergeable: true,
            mergeable_state: mergeableState,
          },
        };
      }
      if (request.endpoint === `${pullPrefix}/files`) {
        return { status: 200, headers: {}, data: mockPRFiles };
      }
      if (request.endpoint === `${pullPrefix}/reviews`) {
        return { status: 200, headers: {}, data: [{ id: 1, state: reviewState, user: { login: 'reviewer' } }] };
      }
      if (request.endpoint === `/repos/${owner}/${repo}/commits/${mockRepoContext.headSha}/check-runs`) {
        return {
          status: 200,
          headers: {},
          data: { total_count: 1, check_runs: [{ id: 2, name: 'ci', status: checkStatus, conclusion: checkConclusion, details_url: null }] },
        };
      }
      if (request.endpoint === `/repos/${owner}/${repo}/commits/${mockRepoContext.headSha}/status`) {
        return { status: 200, headers: {}, data: { state: classicState, statuses: [{ context: 'legacy-ci', state: classicState, target_url: null }] } };
      }
      if (request.endpoint === `/repos/${owner}/${repo}/commits/${mockRepoContext.headSha}/pulls`) {
        const page = Number(request.query?.page ?? '1');
        const data = statusPullPages?.[page - 1] ?? [{ number }];
        const headers = statusPullPages && page < statusPullPages.length
          ? { link: `<https://api.github.com${request.endpoint}?page=${page + 1}>; rel="next"` }
          : {};
        return { status: 200, headers, data };
      }
      throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
    },
    async writeFile(path, content) { files.set(path, content); },
    async readFile(path) { return files.get(path); },
    exists(path) { return files.has(path); },
    async deleteFile(path) { files.delete(path); },
  };

  if (exposeConnectionId) provider.connectionId = 'conn-gate';

  return {
    provider,
    files,
    requests,
    ready() {
      reviewState = 'APPROVED';
      checkStatus = 'completed';
      checkConclusion = 'success';
      classicState = 'success';
      mergeableState = 'clean';
    },
    failPullRefresh() { malformedPull = true; },
    setStatusPullPages(pages: Array<Array<{ number: number }>>) { statusPullPages = pages; },
  };
}

function parseMeta(files: Map<string, string>) {
  const record = JSON.parse(files.get(byId) ?? '{}') as Record<string, unknown>;
  const payload = record.payload;
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : record;
}

test('review, check-run, and classic-status webhooks refresh the mounted parent gate metadata', async () => {
  const fixture = memoryProvider();
  const adapter = new GitHubAdapter(fixture.provider, { connectionId: 'conn-gate' });
  const repository = { name: repo, owner: { login: owner }, full_name: `${owner}/${repo}` };

  const blockedResult = await adapter.routeWebhook({
    action: 'submitted', repository, pull_request: { number },
    review: { id: 10, state: 'changes_requested', user: { login: 'reviewer' } },
  }, 'pull_request_review.submitted');
  assert.deepEqual(blockedResult.errors, []);
  let meta = parseMeta(fixture.files);
  assert.equal(meta.mergeStateStatus, 'BLOCKED');
  assert.equal(meta.reviewDecision, 'CHANGES_REQUESTED');

  fixture.ready();
  await adapter.routeWebhook({
    action: 'completed', repository,
    check_run: { id: 11, head_sha: mockRepoContext.headSha, pull_requests: [{ number }] },
  }, 'check_run.completed');
  meta = parseMeta(fixture.files);
  assert.equal(meta.mergeable, 'MERGEABLE');
  assert.equal(meta.mergeStateStatus, 'CLEAN');
  assert.equal(meta.reviewDecision, 'APPROVED');
  assert.deepEqual(
    (meta.statusCheckRollup as Array<Record<string, unknown>>).map((check) => check.conclusion),
    ['SUCCESS', 'SUCCESS'],
  );

  const statusResult = await adapter.routeWebhook({
    repository, sha: mockRepoContext.headSha, state: 'success', context: 'legacy-ci',
  }, 'status');
  assert.ok(statusResult.paths.includes(canonical));
  assert.ok(!statusResult.paths.includes(githubCommitPath(owner, repo, mockRepoContext.headSha)));
});

test('webhook gate reconciliation uses the adapter-configured connection id', async () => {
  const fixture = memoryProvider(false);
  const adapter = new GitHubAdapter(fixture.provider, { connectionId: 'conn-config-only' });

  const result = await adapter.routeWebhook({
    action: 'submitted',
    repository: { name: repo, owner: { login: owner }, full_name: `${owner}/${repo}` },
    pull_request: { number },
    review: { id: 10, state: 'approved', user: { login: 'reviewer' } },
  }, 'pull_request_review.submitted');

  assert.deepEqual(result.errors, []);
  assert.ok(fixture.requests.length > 0);
  assert.ok(fixture.requests.every((request) => request.connectionId === 'conn-config-only'));
});

test('classic-status reconciliation follows every pull-request lookup page', async () => {
  const fixture = memoryProvider();
  fixture.setStatusPullPages([
    Array.from({ length: 30 }, (_, index) => ({ number: index + 1 })),
    [{ number: 31 }],
  ]);
  const adapter = new GitHubAdapter(fixture.provider, { connectionId: 'conn-gate' });

  const result = await adapter.routeWebhook({
    repository: { name: repo, owner: { login: owner }, full_name: `${owner}/${repo}` },
    sha: mockRepoContext.headSha,
    state: 'success',
    context: 'legacy-ci',
  }, 'status');

  const lookupRequests = fixture.requests.filter(
    (request) => request.endpoint === `/repos/${owner}/${repo}/commits/${mockRepoContext.headSha}/pulls`,
  );
  assert.deepEqual(lookupRequests.map((request) => request.query), [
    { page: '1', per_page: '100' },
    { page: '2', per_page: '100' },
  ]);
  assert.ok(result.errors.some((error) => error.path === githubPullRequestPath(owner, repo, 31)));
});

test('a failed gate refresh invalidates flat and wrapped previously-ready parents', async (t) => {
  for (const wrapped of [false, true]) {
    await t.test(wrapped ? 'wrapped' : 'flat', async () => {
      const fixture = memoryProvider();
      fixture.ready();
      const readyPayload = {
        ...mockPRPayload,
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      };
      const ready = JSON.stringify(wrapped
        ? { provider: 'github', objectType: 'pull_request', payload: readyPayload }
        : readyPayload);
      fixture.files.set(byId, ready);
      fixture.files.set(canonical, ready);
      fixture.failPullRefresh();
      const adapter = new GitHubAdapter(fixture.provider, { connectionId: 'conn-gate' });

      const result = await adapter.routeWebhook({
        action: 'completed',
        repository: { name: repo, owner: { login: owner }, full_name: `${owner}/${repo}` },
        check_run: { id: 12, head_sha: mockRepoContext.headSha, conclusion: 'failure', pull_requests: [{ number }] },
      }, 'check_run.completed');

      assert.ok(result.errors.length > 0);
      const meta = parseMeta(fixture.files);
      assert.equal(meta.mergeable, 'UNKNOWN');
      assert.equal(meta.mergeStateStatus, 'UNKNOWN');
      assert.equal(meta.reviewDecision, 'REVIEW_REQUIRED');
      assert.deepEqual(meta.statusCheckRollup, [
        { name: 'relayfile/gate-refresh', status: 'PENDING', conclusion: null, detailsUrl: null },
      ]);
    });
  }
});
