import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { mockCheckRuns, mockRepoContext } from '../../__tests__/fixtures/index.js';
import { fetchCheckRuns, type GitHubCheckRunProvider } from '../fetcher.js';
import { aggregateCheckStatus, ingestCheckRuns, mapCheckRun } from '../mapper.js';
import type { ProxyRequest, ProxyResponse } from '../../types.js';

function createFixtureProvider(checkRuns = mockCheckRuns) {
  const proxy = mock.fn(async (request: ProxyRequest): Promise<ProxyResponse> => {
    if (
      request.endpoint ===
      `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/commits/${mockRepoContext.headSha}/check-runs`
    ) {
      return {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        data: {
          total_count: checkRuns.length,
          check_runs: checkRuns.map((checkRun) => ({
            ...checkRun,
            output: { ...checkRun.output },
          })),
        },
      };
    }

    throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
  });

  const provider: GitHubCheckRunProvider = {
    name: 'fixture-github',
    connectionId: 'conn-fixture',
    proxy,
  };

  return { provider, proxy };
}

function createMemoryVfs() {
  const writes = new Map<string, string>();
  const writeFile = mock.fn(async (path: string, content: string) => {
    writes.set(path, content);
    return { created: true as const };
  });

  return {
    writes,
    vfs: {
      writeFile,
    },
    writeFile,
  };
}

describe('check runs', () => {
  it('fetchCheckRuns returns check list', async () => {
    const { provider, proxy } = createFixtureProvider();

    const response = await fetchCheckRuns(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      mockRepoContext.headSha,
    );

    assert.deepStrictEqual(response, {
      total_count: mockCheckRuns.length,
      check_runs: mockCheckRuns.map((checkRun) => ({
        ...checkRun,
        output: { ...checkRun.output },
      })),
    });
    assert.strictEqual(proxy.mock.calls.length, 1);
    assert.deepStrictEqual(proxy.mock.calls[0].arguments, [{
      method: 'GET',
      baseUrl: 'https://api.github.com',
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/commits/${mockRepoContext.headSha}/check-runs`,
      connectionId: 'conn-fixture',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      query: {
        page: '1',
        per_page: '100',
      },
    }]);
  });

  it('mapCheckRun produces correct JSON shape', () => {
    const mapped = mapCheckRun(
      mockCheckRuns[0],
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.deepStrictEqual(JSON.parse(mapped.content), {
      id: 9201,
      name: 'Typecheck',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-03-28T08:00:00Z',
      completed_at: '2026-03-28T08:04:30Z',
      output: {
        title: 'Typecheck passed',
        summary: 'No TypeScript errors were found.',
      },
      html_url: 'https://github.com/octocat/hello-world/actions/runs/9201',
      app: {
        name: '',
        slug: null,
      },
    });
  });

  it('mapCheckRun builds correct VFS path', () => {
    const mapped = mapCheckRun(
      mockCheckRuns[0],
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.strictEqual(mapped.vfsPath, 'checks/9201.json');
  });

  it('aggregateCheckStatus counts correctly', () => {
    const aggregated = aggregateCheckStatus([
      mockCheckRuns[0],
      mockCheckRuns[1],
      {
        id: 9203,
        name: 'Lint',
        status: 'queued',
        conclusion: null,
      },
    ]);

    assert.deepStrictEqual(aggregated, {
      total: 3,
      passed: 1,
      failed: 1,
      pending: 1,
      conclusion: 'failure',
    });
  });

  it("aggregateCheckStatus returns 'failure' if any failed", () => {
    const aggregated = aggregateCheckStatus(mockCheckRuns);

    assert.strictEqual(aggregated.conclusion, 'failure');
  });

  it("aggregateCheckStatus returns 'pending' if any in_progress", () => {
    const aggregated = aggregateCheckStatus([
      mockCheckRuns[0],
      {
        id: 9204,
        name: 'Integration Tests',
        status: 'in_progress',
        conclusion: null,
      },
    ]);

    assert.deepStrictEqual(aggregated, {
      total: 2,
      passed: 1,
      failed: 0,
      pending: 1,
      conclusion: 'pending',
    });
  });

  it('ingestCheckRuns writes all check files', async () => {
    const { provider } = createFixtureProvider();
    const { writes, vfs, writeFile } = createMemoryVfs();

    const result = await ingestCheckRuns(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
      mockRepoContext.headSha,
      vfs,
    );

    assert.strictEqual(writeFile.mock.calls.length, 3);
    assert.deepStrictEqual(Array.from(writes.keys()), [
      'checks/9201.json',
      'checks/9202.json',
      'checks/_summary.json',
    ]);
    const check9201 = JSON.parse(writes.get('checks/9201.json') ?? '');
    assert.strictEqual(check9201.id, 9201);
    assert.strictEqual(check9201.name, 'Typecheck');
    const check9202 = JSON.parse(writes.get('checks/9202.json') ?? '');
    assert.strictEqual(check9202.id, 9202);
    assert.strictEqual(check9202.name, 'Unit Tests');
    assert.deepStrictEqual(result, {
      filesWritten: 3,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: ['checks/9201.json', 'checks/9202.json', 'checks/_summary.json'],
      errors: [],
    });
  });

  it('ingestCheckRuns writes _summary.json', async () => {
    const { provider } = createFixtureProvider();
    const { writes, vfs } = createMemoryVfs();

    await ingestCheckRuns(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
      mockRepoContext.headSha,
      vfs,
    );

    assert.deepStrictEqual(
      JSON.parse(writes.get('checks/_summary.json') ?? ''),
      aggregateCheckStatus(mockCheckRuns),
    );
  });
});
