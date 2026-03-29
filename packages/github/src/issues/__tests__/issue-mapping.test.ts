import { describe, expect, it, vi } from 'vitest';

import {
  mockIssueComments,
  mockIssuePayload,
  mockRepoContext,
} from '../../__tests__/fixtures/index.js';
import type { JsonObject, ProxyRequest, ProxyResponse } from '../../types.js';
import { ingestIssueComments, mapIssueComment } from '../comment-mapper.js';
import { fetchIssue, fetchIssueComments, isActualIssue } from '../fetcher.js';
import { ingestIssue, mapIssue } from '../issue-mapper.js';

function cloneFixture<T>(value: T): T {
  return structuredClone(value);
}

function jsonResponse(
  data: ProxyResponse['data'],
  headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' },
): ProxyResponse {
  return {
    status: 200,
    headers,
    data,
  };
}

function createFixtureProvider(options?: {
  issue?: JsonObject;
  paginatedCommentPages?: readonly JsonObject[][];
  issueComments?: readonly JsonObject[];
}) {
  const issue = cloneFixture((options?.issue ?? mockIssuePayload) as JsonObject);
  const paginatedCommentPages = options?.paginatedCommentPages;
  const issueComments = options?.issueComments?.map((comment) => cloneFixture(comment)) ??
    mockIssueComments.map((comment) => cloneFixture(comment as JsonObject));

  const issueEndpoint =
    `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/issues/${issue.number}`;
  const commentsBaseEndpoint = `${issueEndpoint}/comments`;
  const proxy = vi.fn(async (request: ProxyRequest): Promise<ProxyResponse> => {
    if (request.endpoint === issueEndpoint) {
      return jsonResponse(issue);
    }

    if (paginatedCommentPages) {
      if (request.endpoint === `${commentsBaseEndpoint}?per_page=100`) {
        return jsonResponse(paginatedCommentPages[0] ?? [], {
          'content-type': 'application/json; charset=utf-8',
          link: `<https://api.github.com${commentsBaseEndpoint}?page=2&per_page=100>; rel="next"`,
        });
      }

      if (request.endpoint === `${commentsBaseEndpoint}?page=2&per_page=100`) {
        return jsonResponse(paginatedCommentPages[1] ?? []);
      }
    }

    if (
      request.endpoint === commentsBaseEndpoint ||
      request.endpoint === `${commentsBaseEndpoint}?per_page=100`
    ) {
      return jsonResponse(issueComments);
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
    return { created: true as const };
  });

  return {
    writes,
    writeFile,
    vfs: {
      writeFile,
    },
  };
}

describe('issue mapping', () => {
  it('fetchIssue returns issue data', async () => {
    const { provider, proxy } = createFixtureProvider();

    const issue = await fetchIssue(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      mockIssuePayload.number,
    );

    expect(issue).toEqual(cloneFixture(mockIssuePayload));
    expect(proxy).toHaveBeenCalledOnce();
    expect(proxy).toHaveBeenCalledWith({
      method: 'GET',
      baseUrl: 'https://api.github.com',
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/issues/10`,
      connectionId: 'conn-fixture',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  });

  it('isActualIssue filters out PRs', () => {
    expect(isActualIssue(cloneFixture(mockIssuePayload) as JsonObject)).toBe(true);
    expect(
      isActualIssue({
        ...(cloneFixture(mockIssuePayload) as JsonObject),
        pull_request: {},
      }),
    ).toBe(false);
  });

  it('mapIssue produces correct JSON shape', () => {
    const mapped = mapIssue(
      cloneFixture(mockIssuePayload) as JsonObject,
      mockRepoContext.owner,
      mockRepoContext.repo,
    );

    expect(JSON.parse(mapped.content)).toEqual({
      assignees: ['monalisa'],
      author: {
        avatarUrl: 'https://avatars.githubusercontent.com/u/3?v=4',
        login: 'hubot',
      },
      body: 'We need E2E coverage for issue ingestion and webhook routing.',
      closed_at: null,
      created_at: '2026-03-25T10:00:00Z',
      html_url: 'https://github.com/octocat/hello-world/issues/10',
      labels: ['bug'],
      milestone: null,
      number: 10,
      state: 'open',
      title: 'Track adapter issue ingestion coverage',
      updated_at: '2026-03-28T07:45:00Z',
    });
    expect(mapped.vfsPath).toBe('issues/10/meta.json');
  });

  it('mapIssue handles missing optional fields (milestone, closed_at)', () => {
    const issue = {
      ...cloneFixture(mockIssuePayload),
      closed_at: undefined,
      milestone: undefined,
    } as unknown as JsonObject;

    const mapped = mapIssue(issue, mockRepoContext.owner, mockRepoContext.repo);

    expect(JSON.parse(mapped.content)).toMatchObject({
      milestone: null,
      closed_at: null,
    });
  });

  it('fetchIssueComments handles pagination', async () => {
    const pages = [
      [cloneFixture(mockIssueComments[0]) as JsonObject],
      [cloneFixture(mockIssueComments[1]) as JsonObject],
    ] as const;
    const { provider, proxy } = createFixtureProvider({
      paginatedCommentPages: pages,
    });

    const comments = await fetchIssueComments(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      mockIssuePayload.number,
    );

    expect(comments).toEqual([
      cloneFixture(mockIssueComments[0]),
      cloneFixture(mockIssueComments[1]),
    ]);
    expect(proxy).toHaveBeenCalledTimes(2);
    expect(proxy).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      baseUrl: 'https://api.github.com',
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/issues/10/comments?per_page=100`,
      connectionId: 'conn-fixture',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    expect(proxy).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      baseUrl: 'https://api.github.com',
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/issues/10/comments?page=2&per_page=100`,
      connectionId: 'conn-fixture',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  });

  it('mapIssueComment preserves reactions', () => {
    const mapped = mapIssueComment(
      cloneFixture(mockIssueComments[1]) as JsonObject,
      mockRepoContext.owner,
      mockRepoContext.repo,
      mockIssuePayload.number,
    );

    expect(JSON.parse(mapped.content)).toEqual({
      id: 7002,
      body: 'Issue ingest should keep labels and timestamps intact.',
      author: {
        login: 'octocat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
      },
      created_at: '2026-03-27T11:20:00Z',
      updated_at: '2026-03-27T11:50:00Z',
      reactions: {
        total_count: 2,
        '+1': 1,
        '-1': 0,
        laugh: 0,
        confused: 0,
        eyes: 0,
        heart: 0,
        hooray: 1,
        rocket: 0,
      },
    });
  });

  it('ingestIssue writes meta.json and comments', async () => {
    const { provider } = createFixtureProvider();
    const { writes, writeFile, vfs } = createMemoryVfs();
    const originalFunction = globalThis.Function;
    vi.stubGlobal(
      'Function',
      function MockFunction() {
        return async () => ingestIssueComments;
      } as unknown as FunctionConstructor,
    );

    let result;
    try {
      result = await ingestIssue(
        provider,
        mockRepoContext.owner,
        mockRepoContext.repo,
        mockIssuePayload.number,
        vfs,
      );
    } finally {
      vi.stubGlobal('Function', originalFunction);
    }

    expect(writeFile).toHaveBeenCalledTimes(3);
    expect(Array.from(writes.keys())).toEqual([
      '/github/repos/octocat/hello-world/issues/10/meta.json',
      '/github/repos/octocat/hello-world/issues/10/comments/7001.json',
      '/github/repos/octocat/hello-world/issues/10/comments/7002.json',
    ]);
    expect(JSON.parse(writes.get('/github/repos/octocat/hello-world/issues/10/meta.json') ?? ''))
      .toMatchObject({
        number: 10,
        title: 'Track adapter issue ingestion coverage',
        labels: ['bug'],
      });
    expect(JSON.parse(writes.get('/github/repos/octocat/hello-world/issues/10/comments/7001.json') ?? ''))
      .toMatchObject({
        id: 7001,
        author: {
          login: 'monalisa',
        },
      });
    expect(result).toEqual({
      filesWritten: 3,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [
        '/github/repos/octocat/hello-world/issues/10/meta.json',
        '/github/repos/octocat/hello-world/issues/10/comments/7001.json',
        '/github/repos/octocat/hello-world/issues/10/comments/7002.json',
      ],
      errors: [],
    });
  });

  it('ingestIssueComments writes all comment files', async () => {
    const { provider } = createFixtureProvider();
    const { writes, writeFile, vfs } = createMemoryVfs();

    const result = await ingestIssueComments(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      mockIssuePayload.number,
      vfs,
    );

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(Array.from(writes.keys())).toEqual(result.paths);
    expect(JSON.parse(writes.get(result.paths[0]) ?? '')).toMatchObject({
      id: 7001,
      reactions: {
        total_count: 1,
        '+1': 1,
      },
    });
    expect(JSON.parse(writes.get(result.paths[1]) ?? '')).toMatchObject({
      id: 7002,
      reactions: {
        total_count: 2,
        hooray: 1,
      },
    });
    expect(result).toEqual({
      filesWritten: 2,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [
        '/github/repos/octocat/hello-world/issues/10/comments/7001.json',
        '/github/repos/octocat/hello-world/issues/10/comments/7002.json',
      ],
      errors: [],
    });
  });

  it('VFS paths are correct', () => {
    const issueMapping = mapIssue(
      cloneFixture(mockIssuePayload) as JsonObject,
      mockRepoContext.owner,
      mockRepoContext.repo,
    );
    const commentMapping = mapIssueComment(
      cloneFixture(mockIssueComments[0]) as JsonObject,
      mockRepoContext.owner,
      mockRepoContext.repo,
      mockIssuePayload.number,
    );

    expect(issueMapping.vfsPath).toBe('issues/10/meta.json');
    expect(commentMapping.vfsPath).toBe('issues/10/comments/7001.json');
    expect(
      `/github/repos/${encodeURIComponent(mockRepoContext.owner)}/${encodeURIComponent(mockRepoContext.repo)}/${issueMapping.vfsPath}`,
    ).toBe('/github/repos/octocat/hello-world/issues/10/meta.json');
    expect(
      `/github/repos/${encodeURIComponent(mockRepoContext.owner)}/${encodeURIComponent(mockRepoContext.repo)}/${commentMapping.vfsPath}`,
    ).toBe('/github/repos/octocat/hello-world/issues/10/comments/7001.json');
  });
});
