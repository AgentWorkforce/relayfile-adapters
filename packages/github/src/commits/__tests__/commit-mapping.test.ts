import { describe, expect, it, vi } from 'vitest';

import { mockCommits, mockPRFiles, mockRepoContext } from '../../__tests__/fixtures/index.js';
import {
  fetchCommitDetail,
  fetchPRCommits,
  type GitHubCommitDetail,
  type GitHubPullRequestCommit,
} from '../fetcher.js';
import { ingestCommits, mapCommitToVFS } from '../mapper.js';
import type { ProxyRequest, ProxyResponse } from '../../types.js';

const PULL_REQUEST_NUMBER = 42;
const GITHUB_API_BASE_URL = 'https://api.github.com';
const DEFAULT_HEADERS = {
  Accept: 'application/vnd.github+json',
  'Provider-Config-Key': 'github-app-oauth',
  'X-GitHub-Api-Version': '2022-11-28',
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildCommitDetails(): Record<string, GitHubCommitDetail> {
  const firstCommit = cloneJson(mockCommits[0]) as GitHubCommitDetail;
  firstCommit.stats = {
    additions: 1,
    deletions: 1,
    total: 2,
  };
  firstCommit.files = [
    {
      filename: 'src/index.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      changes: 2,
    },
  ];

  const secondCommit = cloneJson(mockCommits[1]) as GitHubCommitDetail;
  secondCommit.stats = {
    additions: 2,
    deletions: 1,
    total: 3,
  };
  secondCommit.files = [
    cloneJson(mockPRFiles[1]) as GitHubCommitDetail['files'][number],
    {
      filename: 'README.md',
      previous_filename: 'docs/README.md',
      status: 'renamed',
      additions: 1,
      deletions: 0,
      changes: 1,
    } as GitHubCommitDetail['files'][number],
  ];

  return {
    [firstCommit.sha]: firstCommit,
    [secondCommit.sha]: secondCommit,
  };
}

function createFixtureProvider(options?: {
  pages?: GitHubPullRequestCommit[][];
  details?: Record<string, GitHubCommitDetail>;
}) {
  const pages = options?.pages ?? [mockCommits.map((commit) => cloneJson(commit))];
  const details = options?.details ?? buildCommitDetails();

  const proxy = vi.fn(async (request: ProxyRequest): Promise<ProxyResponse> => {
    const basePullRequestEndpoint = `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/${PULL_REQUEST_NUMBER}/commits`;

    if (request.endpoint.startsWith(basePullRequestEndpoint)) {
      const url = new URL(`${GITHUB_API_BASE_URL}${request.endpoint}`);
      const page = Number(url.searchParams.get('page') ?? '1');
      const data = pages[page - 1] ?? [];
      const headers: Record<string, string> = {
        'content-type': 'application/json; charset=utf-8',
      };

      if (page < pages.length) {
        headers.link = `<${GITHUB_API_BASE_URL}${basePullRequestEndpoint}?page=${page + 1}&per_page=100>; rel="next"`;
      }

      return {
        status: 200,
        headers,
        data: cloneJson(data),
      };
    }

    const commitMatch = request.endpoint.match(
      new RegExp(
        `^/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/commits/([^/?]+)$`,
      ),
    );

    if (commitMatch) {
      const sha = decodeURIComponent(commitMatch[1]);
      const detail = details[sha];

      if (!detail) {
        throw new Error(`No detail fixture for ${sha}`);
      }

      return {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        data: cloneJson(detail),
      };
    }

    throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
  });

  return {
    provider: {
      name: 'fixture-github',
      connectionId: 'conn-fixture',
      proxy,
    },
    proxy,
  };
}

function createMemoryVfs() {
  const writes = new Map<string, string>();
  const writeFile = vi.fn(async (path: string, content: string) => {
    writes.set(path, content);
  });

  return {
    writes,
    writeFile,
    vfs: {
      writeFile,
    },
  };
}

describe('commit mapping', () => {
  it('fetchPRCommits returns paginated commits', async () => {
    const pages = [[cloneJson(mockCommits[0])], [cloneJson(mockCommits[1])]];
    const { provider, proxy } = createFixtureProvider({ pages });

    const commits = await fetchPRCommits(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      PULL_REQUEST_NUMBER,
    );

    expect(commits).toEqual([cloneJson(mockCommits[0]), cloneJson(mockCommits[1])]);
    expect(proxy).toHaveBeenCalledTimes(2);
    expect(proxy).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/${PULL_REQUEST_NUMBER}/commits?page=1&per_page=100`,
      connectionId: 'conn-fixture',
      headers: DEFAULT_HEADERS,
    });
    expect(proxy).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/${PULL_REQUEST_NUMBER}/commits?page=2&per_page=100`,
      connectionId: 'conn-fixture',
      headers: DEFAULT_HEADERS,
    });
  });

  it('fetchCommitDetail returns full commit data', async () => {
    const details = buildCommitDetails();
    const { provider, proxy } = createFixtureProvider({ details });

    const detail = await fetchCommitDetail(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      mockRepoContext.headSha,
    );

    expect(detail).toEqual(details[mockRepoContext.headSha]);
    expect(proxy).toHaveBeenCalledOnce();
    expect(proxy).toHaveBeenCalledWith({
      method: 'GET',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/commits/${mockRepoContext.headSha}`,
      connectionId: 'conn-fixture',
      headers: DEFAULT_HEADERS,
    });
  });

  it('mapCommitToVFS produces correct JSON structure', () => {
    const details = buildCommitDetails();

    const mapped = mapCommitToVFS(
      details[mockRepoContext.headSha],
      mockRepoContext.owner,
      mockRepoContext.repo,
      PULL_REQUEST_NUMBER,
    );

    expect(JSON.parse(mapped.content)).toEqual({
      sha: mockRepoContext.headSha,
      message: 'test: add README and math fixture updates',
      author: {
        login: 'octocat',
        email: 'octocat@example.com',
        date: '2026-03-28T07:30:00Z',
      },
      committer: {
        login: 'octocat',
        email: 'octocat@example.com',
        date: '2026-03-28T07:30:00Z',
      },
      parents: [mockCommits[0].sha],
      stats: {
        additions: 2,
        deletions: 1,
        total: 3,
      },
      filesChanged: [
        {
          path: 'src/utils/math.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          changes: 2,
        },
        {
          path: 'README.md',
          status: 'renamed',
          additions: 1,
          deletions: 0,
          changes: 1,
          previousPath: 'docs/README.md',
        },
      ],
    });
  });

  it('mapCommitToVFS builds correct VFS path', () => {
    const details = buildCommitDetails();

    const mapped = mapCommitToVFS(
      details[mockRepoContext.headSha],
      mockRepoContext.owner,
      mockRepoContext.repo,
      PULL_REQUEST_NUMBER,
    );

    expect(mapped.vfsPath).toBe(
      `/pulls/${PULL_REQUEST_NUMBER}/commits/${mockRepoContext.headSha}.json`,
    );
  });

  it('ingestCommits writes all commit files', async () => {
    const details = buildCommitDetails();
    const { provider } = createFixtureProvider({
      pages: [mockCommits.map((commit) => cloneJson(commit))],
      details,
    });
    const { writes, writeFile, vfs } = createMemoryVfs();

    const result = await ingestCommits(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      PULL_REQUEST_NUMBER,
      vfs,
    );

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(Array.from(writes.keys())).toEqual([
      `/pulls/${PULL_REQUEST_NUMBER}/commits/${mockCommits[0].sha}.json`,
      `/pulls/${PULL_REQUEST_NUMBER}/commits/${mockCommits[1].sha}.json`,
    ]);
    expect(JSON.parse(writes.get(`/pulls/${PULL_REQUEST_NUMBER}/commits/${mockCommits[0].sha}.json`) ?? '')).toMatchObject({
      sha: mockCommits[0].sha,
      message: 'refactor: normalize greeting output',
    });
    expect(JSON.parse(writes.get(`/pulls/${PULL_REQUEST_NUMBER}/commits/${mockCommits[1].sha}.json`) ?? '')).toMatchObject({
      sha: mockCommits[1].sha,
      message: 'test: add README and math fixture updates',
    });
    expect(result).toEqual({
      filesWritten: 2,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [
        `/pulls/${PULL_REQUEST_NUMBER}/commits/${mockCommits[0].sha}.json`,
        `/pulls/${PULL_REQUEST_NUMBER}/commits/${mockCommits[1].sha}.json`,
      ],
      errors: [],
    });
  });

  it('ingestCommits handles empty commit list', async () => {
    const { provider, proxy } = createFixtureProvider({
      pages: [[]],
      details: {},
    });
    const { writeFile, vfs } = createMemoryVfs();

    const result = await ingestCommits(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      PULL_REQUEST_NUMBER,
      vfs,
    );

    expect(writeFile).not.toHaveBeenCalled();
    expect(proxy).toHaveBeenCalledOnce();
    expect(result).toEqual({
      filesWritten: 0,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [],
      errors: [],
    });
  });

  it('Pagination fetches all pages', async () => {
    const pages = [
      [cloneJson(mockCommits[0])],
      [cloneJson(mockCommits[1])],
      [cloneJson(mockCommits[0])],
    ];
    const { provider, proxy } = createFixtureProvider({ pages });

    const commits = await fetchPRCommits(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      PULL_REQUEST_NUMBER,
    );

    expect(commits.map((commit) => commit.sha)).toEqual([
      mockCommits[0].sha,
      mockCommits[1].sha,
      mockCommits[0].sha,
    ]);
    expect(proxy).toHaveBeenCalledTimes(3);
    expect(proxy.mock.calls.map(([request]) => request.endpoint)).toEqual([
      `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/${PULL_REQUEST_NUMBER}/commits?page=1&per_page=100`,
      `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/${PULL_REQUEST_NUMBER}/commits?page=2&per_page=100`,
      `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/${PULL_REQUEST_NUMBER}/commits?page=3&per_page=100`,
    ]);
  });
});
