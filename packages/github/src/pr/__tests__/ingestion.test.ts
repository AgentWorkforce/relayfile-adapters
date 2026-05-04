import { Buffer } from 'node:buffer';

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  mockDiff,
  mockPRFiles,
  mockPRPayload,
  mockRepoContext,
} from '../../__tests__/fixtures/index.js';
import { type VfsLike } from '../../files/content-fetcher.js';
import type { GitHubRequestProvider, ProxyRequest, ProxyResponse } from '../../types.js';
import { fetchAndWriteDiff, ingestPullRequest } from '../diff-writer.js';
import { buildVFSPath, mapPRFiles } from '../file-mapper.js';
import { parsePullRequest } from '../parser.js';

interface FixtureProviderOptions {
  diff?: string;
  files?: readonly Record<string, unknown>[];
  prPayload?: Record<string, unknown>;
  responses?: Partial<Record<'diff' | 'files' | 'pull', ProxyResponse>>;
}

function createPullRequestFixture(prPayload?: Record<string, unknown>) {
  const payload = {
    merged: false,
    ...mockPRPayload,
    ...prPayload,
  };

  return {
    ...payload,
    head: {
      ...mockPRPayload.head,
      ...(typeof payload.head === 'object' && payload.head !== null ? payload.head : {}),
      repo: {
        ...mockPRPayload.head.repo,
        html_url: `https://github.com/${mockRepoContext.owner}/${mockRepoContext.repo}`,
        ...(typeof payload.head === 'object' &&
        payload.head !== null &&
        'repo' in payload.head &&
        typeof payload.head.repo === 'object' &&
        payload.head.repo !== null
          ? payload.head.repo
          : {}),
      },
    },
    base: {
      ...mockPRPayload.base,
      ...(typeof payload.base === 'object' && payload.base !== null ? payload.base : {}),
      repo: {
        ...mockPRPayload.base.repo,
        html_url: `https://github.com/${mockRepoContext.owner}/${mockRepoContext.repo}`,
        ...(typeof payload.base === 'object' &&
        payload.base !== null &&
        'repo' in payload.base &&
        typeof payload.base.repo === 'object' &&
        payload.base.repo !== null
          ? payload.base.repo
          : {}),
      },
    },
  };
}

function createFixtureProvider(options: FixtureProviderOptions = {}) {
  const proxy = mock.fn(async (request: ProxyRequest): Promise<ProxyResponse> => {
    if (
      request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/files`
    ) {
      return (
        options.responses?.files ?? {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          data: options.files ?? mockPRFiles,
        }
      );
    }

    if (request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42`) {
      if (request.headers?.Accept === 'application/vnd.github.diff') {
        return (
          options.responses?.diff ?? {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            data: options.diff ?? mockDiff,
          }
        );
      }

      return (
        options.responses?.pull ?? {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          data: createPullRequestFixture(options.prPayload),
        }
      );
    }

    throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
  });

  const provider: GitHubRequestProvider = {
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
  });
  const exists = mock.fn((path: string) => writes.has(path));

  const vfs: VfsLike = {
    exists,
    writeFile,
  };

  return { exists, vfs, writeFile, writes };
}

describe('pull request ingestion', () => {
  it('parsePullRequest extracts correct metadata', async () => {
    const { provider, proxy } = createFixtureProvider();

    const parsed = await parsePullRequest(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.deepStrictEqual(parsed, {
      number: 42,
      title: mockPRPayload.title,
      body: mockPRPayload.body,
      state: mockPRPayload.state,
      draft: mockPRPayload.draft,
      merged: false,
      createdAt: mockPRPayload.created_at,
      updatedAt: mockPRPayload.updated_at,
      closedAt: mockPRPayload.closed_at,
      mergedAt: mockPRPayload.merged_at,
      htmlUrl: mockPRPayload.html_url,
      diffUrl: mockPRPayload.diff_url,
      patchUrl: mockPRPayload.patch_url,
      author: {
        id: mockPRPayload.user.id,
        login: mockPRPayload.user.login,
        type: mockPRPayload.user.type,
        avatarUrl: mockPRPayload.user.avatar_url,
        htmlUrl: mockPRPayload.user.html_url,
      },
      labels: mockPRPayload.labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
        description: label.description,
        default: label.default,
      })),
      head: {
        label: mockPRPayload.head.label,
        ref: mockPRPayload.head.ref,
        sha: mockPRPayload.head.sha,
        repo: {
          id: mockPRPayload.head.repo.id,
          name: mockPRPayload.head.repo.name,
          fullName: mockPRPayload.head.repo.full_name,
          private: mockPRPayload.head.repo.private,
          htmlUrl: `https://github.com/${mockRepoContext.owner}/${mockRepoContext.repo}`,
        },
      },
      base: {
        label: mockPRPayload.base.label,
        ref: mockPRPayload.base.ref,
        sha: mockPRPayload.base.sha,
        repo: {
          id: mockPRPayload.base.repo.id,
          name: mockPRPayload.base.repo.name,
          fullName: mockPRPayload.base.repo.full_name,
          private: mockPRPayload.base.repo.private,
          htmlUrl: `https://github.com/${mockRepoContext.owner}/${mockRepoContext.repo}`,
        },
      },
    });
    assert.strictEqual(proxy.mock.calls.length, 1);
    assert.deepStrictEqual(proxy.mock.calls[0].arguments, [{
      method: 'GET',
      baseUrl: 'https://api.github.com',
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42`,
      connectionId: 'conn-fixture',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }]);
  });

  it('mapPRFiles maps file paths correctly', async () => {
    const { provider, proxy } = createFixtureProvider();

    const mapped = await mapPRFiles(provider, mockRepoContext.owner, mockRepoContext.repo, 42);

    assert.deepStrictEqual(mapped, [
      {
        vfsPath: '/github/repos/octocat/hello-world/pulls/42/files/src/index.ts',
        githubPath: 'src/index.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
      },
      {
        vfsPath: '/github/repos/octocat/hello-world/pulls/42/files/src/utils/math.ts',
        githubPath: 'src/utils/math.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
      },
      {
        vfsPath: '/github/repos/octocat/hello-world/pulls/42/files/README.md',
        githubPath: 'README.md',
        status: 'modified',
        additions: 1,
        deletions: 1,
      },
    ]);
    assert.strictEqual(proxy.mock.calls.length, 1);
    assert.deepStrictEqual(proxy.mock.calls[0].arguments, [{
      method: 'GET',
      baseUrl: 'https://api.github.com',
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/files`,
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

  it('mapPRFiles handles renamed files', async () => {
    const renamedFiles = [
      {
        sha: '8888888888888888888888888888888888888888',
        filename: 'src/new-name.ts',
        previous_filename: 'src/old-name.ts',
        status: 'renamed',
        additions: 0,
        deletions: 0,
      },
    ] satisfies readonly Record<string, unknown>[];
    const { provider } = createFixtureProvider({ files: renamedFiles });

    const mapped = await mapPRFiles(provider, mockRepoContext.owner, mockRepoContext.repo, 42);

    assert.deepStrictEqual(mapped, [
      {
        vfsPath: '/github/repos/octocat/hello-world/pulls/42/files/src/new-name.ts',
        githubPath: 'src/new-name.ts',
        status: 'renamed',
        additions: 0,
        deletions: 0,
      },
    ]);
  });

  it('fetchAndWriteDiff writes diff.patch', async () => {
    const { provider, proxy } = createFixtureProvider();
    const { vfs, writes, writeFile } = createMemoryVfs();

    const result = await fetchAndWriteDiff(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
      vfs,
    );

    assert.deepStrictEqual(result, {
      path: '/github/repos/octocat/hello-world/pulls/42/diff.patch',
      size: Buffer.byteLength(mockDiff, 'utf8'),
    });
    assert.deepStrictEqual(writeFile.mock.calls[0].arguments, [result.path, mockDiff]);
    assert.strictEqual(writes.get(result.path), mockDiff);
    assert.deepStrictEqual(proxy.mock.calls[0].arguments, [{
      method: 'GET',
      baseUrl: 'https://api.github.com',
      endpoint: `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42`,
      connectionId: 'conn-fixture',
      headers: {
        Accept: 'application/vnd.github.diff',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }]);
  });

  it('ingestPullRequest returns complete IngestResult', async () => {
    const { provider } = createFixtureProvider();
    const { vfs, writes } = createMemoryVfs();

    const result = await ingestPullRequest(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
      vfs,
    );

    assert.deepStrictEqual(result, {
      filesWritten: 5,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [
        '/github/repos/octocat/hello-world/pulls/42--add-fixture-backed-github-adapter-coverage/meta.json',
        '/github/repos/octocat/hello-world/pulls/42--add-fixture-backed-github-adapter-coverage/files/src/index.ts',
        '/github/repos/octocat/hello-world/pulls/42--add-fixture-backed-github-adapter-coverage/files/src/utils/math.ts',
        '/github/repos/octocat/hello-world/pulls/42--add-fixture-backed-github-adapter-coverage/files/README.md',
        '/github/repos/octocat/hello-world/pulls/42--add-fixture-backed-github-adapter-coverage/diff.patch',
      ],
      errors: [],
    });
    const meta = JSON.parse(writes.get('/github/repos/octocat/hello-world/pulls/42--add-fixture-backed-github-adapter-coverage/meta.json') ?? '');
    assert.strictEqual(meta.number, 42);
    assert.strictEqual(meta.title, mockPRPayload.title);
    assert.strictEqual(meta.head.sha, mockRepoContext.headSha);
    assert.strictEqual(meta.base.sha, mockRepoContext.baseSha);
    assert.deepStrictEqual(
      JSON.parse(writes.get('/github/repos/octocat/hello-world/pulls/42--add-fixture-backed-github-adapter-coverage/files/src/index.ts') ?? ''),
      {
        filename: 'src/index.ts',
        path: 'src/index.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
      },
    );
    assert.strictEqual(writes.get('/github/repos/octocat/hello-world/pulls/42--add-fixture-backed-github-adapter-coverage/diff.patch'), mockDiff);
  });

  it('ingestPullRequest handles API errors gracefully', async () => {
    const { provider } = createFixtureProvider({
      responses: {
        pull: {
          status: 500,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          data: { message: 'pull request unavailable' },
        },
        files: {
          status: 502,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          data: { message: 'files unavailable' },
        },
        diff: {
          status: 503,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          data: { message: 'diff unavailable' },
        },
      },
    });
    const { vfs, writeFile, writes } = createMemoryVfs();

    const result = await ingestPullRequest(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
      vfs,
    );

    assert.deepStrictEqual(result, {
      filesWritten: 0,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [],
      errors: [
        {
          path: '/github/repos/octocat/hello-world/pulls/42/meta.json',
          error:
            'GitHub pull request fetch failed for octocat/hello-world#42: 500 pull request unavailable',
        },
        {
          path: '/github/repos/octocat/hello-world/pulls/42/files',
          error:
            'Failed to fetch pull request files for octocat/hello-world#42 (status 502): files unavailable',
        },
        {
          path: '/github/repos/octocat/hello-world/pulls/42/diff.patch',
          error:
            'Failed to fetch pull request diff for octocat/hello-world#42: 503 diff unavailable',
        },
      ],
    });
    assert.strictEqual(writeFile.mock.calls.length, 0);
    assert.strictEqual(writes.size, 0);
  });

  it('buildVFSPath constructs correct paths', () => {
    assert.strictEqual(
      buildVFSPath(' acme org ', 'widgets', 7, '/files/src/my file.ts'),
      '/github/repos/acme%20org/widgets/pulls/7/files/src/my%20file.ts',
    );
  });
});
