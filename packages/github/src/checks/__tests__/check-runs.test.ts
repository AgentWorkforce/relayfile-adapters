import { describe, expect, it, vi } from 'vitest';

import { mockCheckRuns, mockRepoContext } from '../../__tests__/fixtures/index.js';
import { fetchCheckRuns, type GitHubCheckRunProvider } from '../fetcher.js';
import { aggregateCheckStatus, ingestCheckRuns, mapCheckRun } from '../mapper.js';
import type { ProxyRequest, ProxyResponse } from '../../types.js';

function createFixtureProvider(checkRuns = mockCheckRuns) {
  const proxy = vi.fn(async (request: ProxyRequest): Promise<ProxyResponse> => {
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
  const writeFile = vi.fn(async (path: string, content: string) => {
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

    expect(response).toEqual({
      total_count: mockCheckRuns.length,
      check_runs: mockCheckRuns.map((checkRun) => ({
        ...checkRun,
        output: { ...checkRun.output },
      })),
    });
    expect(proxy).toHaveBeenCalledOnce();
    expect(proxy).toHaveBeenCalledWith({
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
    });
  });

  it('mapCheckRun produces correct JSON shape', () => {
    const mapped = mapCheckRun(
      mockCheckRuns[0],
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    expect(JSON.parse(mapped.content)).toEqual({
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

    expect(mapped.vfsPath).toBe('checks/9201.json');
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

    expect(aggregated).toEqual({
      total: 3,
      passed: 1,
      failed: 1,
      pending: 1,
      conclusion: 'failure',
    });
  });

  it("aggregateCheckStatus returns 'failure' if any failed", () => {
    const aggregated = aggregateCheckStatus(mockCheckRuns);

    expect(aggregated.conclusion).toBe('failure');
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

    expect(aggregated).toEqual({
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

    expect(writeFile).toHaveBeenCalledTimes(3);
    expect(Array.from(writes.keys())).toEqual([
      'checks/9201.json',
      'checks/9202.json',
      'checks/_summary.json',
    ]);
    expect(JSON.parse(writes.get('checks/9201.json') ?? '')).toMatchObject({
      id: 9201,
      name: 'Typecheck',
    });
    expect(JSON.parse(writes.get('checks/9202.json') ?? '')).toMatchObject({
      id: 9202,
      name: 'Unit Tests',
    });
    expect(result).toEqual({
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

    expect(JSON.parse(writes.get('checks/_summary.json') ?? '')).toEqual(
      aggregateCheckStatus(mockCheckRuns),
    );
  });
});
