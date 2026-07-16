import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchRepoCommits, GitHubAdapter } from '../index.js';
import { githubCommitPath, githubRepoCommitsIndexPath } from '../path-mapper.js';
import type { GitHubAdapterConfig, ProxyRequest, ProxyResponse } from '../types.js';

const OWNER = 'octocat';
const REPO = 'hello-world';
const SHA_A = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111';
const SHA_B = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222';

function createRepoCommit(sha: string, message: string, committedAt = '2026-05-01T00:00:00Z') {
  return {
    sha,
    commit: {
      message,
      author: {
        name: 'octocat',
        email: 'octocat@github.com',
        date: committedAt,
      },
      committer: {
        name: 'octocat',
        email: 'octocat@github.com',
        date: committedAt,
      },
    },
    author: { login: 'octocat', id: 1, type: 'User' },
    committer: { login: 'octocat', id: 1, type: 'User' },
    parents: [],
  };
}

function createRepository() {
  return {
    id: 1,
    name: REPO,
    full_name: `${OWNER}/${REPO}`,
    html_url: `https://github.com/${OWNER}/${REPO}`,
    private: false,
    owner: { login: OWNER },
  };
}

class CommitRecordingProvider {
  readonly name = 'recording-github';
  readonly connectionId = 'conn-commits';
  readonly requests: ProxyRequest[] = [];
  readonly writes = new Map<string, string>();
  private readonly repoCommits: typeof createRepoCommit extends (...args: never) => infer R ? R[] : never[];

  constructor(commits: ReturnType<typeof createRepoCommit>[] = []) {
    this.repoCommits = commits as never;
  }

  async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
    this.requests.push(request);

    if (request.endpoint === `/repos/${OWNER}/${REPO}`) {
      return this.json(createRepository()) as ProxyResponse<T>;
    }

    if (request.endpoint === `/repos/${OWNER}/${REPO}/issues`) {
      return this.json([]) as ProxyResponse<T>;
    }

    if (request.endpoint === `/repos/${OWNER}/${REPO}/pulls`) {
      return this.json([]) as ProxyResponse<T>;
    }

    if (request.endpoint?.startsWith(`/repos/${OWNER}/${REPO}/commits`)) {
      return this.json(this.repoCommits) as ProxyResponse<T>;
    }

    throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.writes.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    const value = this.writes.get(path);
    if (value === undefined) {
      throw new Error(`Missing path: ${path}`);
    }
    return value;
  }

  async exists(path: string): Promise<boolean> {
    return this.writes.has(path);
  }

  countRequests(pattern: string | RegExp): number {
    return this.requests.filter((r) =>
      typeof pattern === 'string' ? r.endpoint === pattern : pattern.test(r.endpoint ?? ''),
    ).length;
  }

  private json<T>(data: T): ProxyResponse<T> {
    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      data,
    };
  }
}

class ConcurrentCommitProvider {
  readonly name = 'concurrent-github';
  readonly connectionId = 'conn-commits';
  readonly conflictPaths: string[] = [];
  private readonly files = new Map<string, { content: string; revision: string }>();
  private revisionCounter = 0;
  private indexReadCount = 0;
  private releaseIndexReads!: () => void;
  private readonly indexReadBarrier = new Promise<void>((resolve) => {
    this.releaseIndexReads = resolve;
  });

  async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
    throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
  }

  async readFile(path: string): Promise<{ content: string; revision: string } | undefined> {
    if (path === githubRepoCommitsIndexPath(OWNER, REPO) && this.indexReadCount < 2) {
      this.indexReadCount += 1;
      if (this.indexReadCount === 2) {
        this.releaseIndexReads();
      }
      await this.indexReadBarrier;
    }
    const file = this.files.get(path);
    return file ? { ...file } : undefined;
  }

  writeFile(
    path: string,
    content: string,
    options?: { baseRevision?: string },
  ): void {
    const existing = this.files.get(path);
    const currentRevision = existing?.revision ?? '0';
    if (options?.baseRevision !== undefined && options.baseRevision !== currentRevision) {
      this.conflictPaths.push(path);
      const error = new Error('RevisionConflictError');
      Object.assign(error, { name: 'RevisionConflictError', status: 409, code: 'revision_conflict' });
      throw error;
    }

    this.revisionCounter += 1;
    this.files.set(path, { content, revision: `r${this.revisionCounter}` });
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }

  text(path: string): string | undefined {
    return this.files.get(path)?.content;
  }
}

function createCommitMaterializingAdapter(
  provider: CommitRecordingProvider,
  config: Partial<GitHubAdapterConfig> = {},
): GitHubAdapter {
  return new GitHubAdapter(provider as never, {
    owner: OWNER,
    repo: REPO,
    connectionId: 'conn-commits',
    materialization: {
      default: 'lazy',
      rules: [{ repos: [`${OWNER}/${REPO}`], resources: ['commits'] }],
    },
    ...config,
  });
}

describe('GitHub repo-level commit materialization', () => {
  it("'commits' is in GITHUB_MATERIALIZATION_RESOURCES", async () => {
    const { GITHUB_MATERIALIZATION_RESOURCES } = await import('../config.js');
    assert.ok(
      (GITHUB_MATERIALIZATION_RESOURCES as readonly string[]).includes('commits'),
      "'commits' must be in GITHUB_MATERIALIZATION_RESOURCES",
    );
  });

  it("'commits' is in GitHubBulkMaterializationResource union type (type-level check via assignment)", () => {
    // If this compiles, the type includes 'commits'.
    const resource: import('../types.js').GitHubBulkMaterializationResource = 'commits';
    assert.strictEqual(resource, 'commits');
  });

  it('fetchRepoCommits calls /repos/{o}/{r}/commits with correct endpoint', async () => {
    const commits = [createRepoCommit(SHA_A, 'first commit')];
    const provider = new CommitRecordingProvider(commits);
    const adapter = createCommitMaterializingAdapter(provider);

    await adapter.sync('workspace-1');

    const commitRequests = provider.requests.filter((r) =>
      r.endpoint?.startsWith(`/repos/${OWNER}/${REPO}/commits`),
    );
    assert.ok(commitRequests.length >= 1, 'Expected at least one request to the commits endpoint');
    assert.ok(
      commitRequests[0].endpoint?.startsWith(`/repos/${OWNER}/${REPO}/commits`),
      'Commits endpoint must use /repos/{owner}/{repo}/commits',
    );
  });

  it('fetchRepoCommits follows Link-header pagination and respects maxCommits', async () => {
    const requests: ProxyRequest[] = [];
    const pages = [
      [createRepoCommit(SHA_A, 'first commit')],
      [createRepoCommit(SHA_B, 'second commit')],
    ];
    const provider = {
      connectionId: 'conn-commits',
      async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
        requests.push(request);
        const page = requests.length;
        return {
          status: 200,
          headers: page === 1
            ? { link: `<https://api.github.com/repos/${OWNER}/${REPO}/commits?page=2&per_page=1>; rel="next"` }
            : {},
          data: pages[page - 1],
        } as ProxyResponse<T>;
      },
    };

    const commits = await fetchRepoCommits(provider, OWNER, REPO, {
      maxCommits: 2,
      perPage: 1,
      since: '2026-05-01T00:00:00Z',
    });

    assert.deepStrictEqual(commits.map((commit) => commit.sha), [SHA_A, SHA_B]);
    assert.strictEqual(requests.length, 2);
    assert.match(requests[0]?.endpoint ?? '', new RegExp(`^/repos/${OWNER}/${REPO}/commits\\?`));
    assert.strictEqual(
      new URL(requests[0]?.endpoint ?? '', 'https://api.github.com').searchParams.get('since'),
      '2026-05-01T00:00:00Z',
    );
    assert.strictEqual(
      requests[1]?.endpoint,
      `/repos/${OWNER}/${REPO}/commits?page=2&per_page=1`,
    );
  });

  it('fetchRepoCommits normalizes enterprise Link paths relative to an /api/v3 base URL', async () => {
    const baseUrl = 'https://github.example.com/api/v3';
    const requests: ProxyRequest[] = [];
    const provider = {
      connectionId: 'conn-enterprise-commits',
      async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
        requests.push(request);
        const page = requests.length;
        return {
          status: 200,
          headers: page === 1
            ? { link: `<${baseUrl}/repos/${OWNER}/${REPO}/commits?page=2&per_page=1>; rel="next"` }
            : {},
          data: [
            page === 1
              ? createRepoCommit(SHA_A, 'first commit')
              : createRepoCommit(SHA_B, 'second commit'),
          ],
        } as ProxyResponse<T>;
      },
    };

    const commits = await fetchRepoCommits(provider, OWNER, REPO, {
      baseUrl,
      maxCommits: 2,
      perPage: 1,
    });

    assert.deepStrictEqual(commits.map((commit) => commit.sha), [SHA_A, SHA_B]);
    assert.strictEqual(requests.length, 2);
    assert.strictEqual(requests[1]?.baseUrl, baseUrl);
    assert.strictEqual(
      requests[1]?.endpoint,
      `/repos/${OWNER}/${REPO}/commits?page=2&per_page=1`,
    );
    assert.strictEqual(
      requests.filter(
        (request) =>
          request.endpoint === `/repos/${OWNER}/${REPO}/commits?page=2&per_page=1`,
      ).length,
      1,
    );
  });

  it('fetchRepoCommits stops before following another Link when maxCommits is reached', async () => {
    const requests: ProxyRequest[] = [];
    const provider = {
      connectionId: 'conn-commits',
      async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
        requests.push(request);
        return {
          status: 200,
          headers: {
            link: `<https://api.github.com/repos/${OWNER}/${REPO}/commits?page=2&per_page=100>; rel="next"`,
          },
          data: [
            createRepoCommit(SHA_A, 'first commit'),
            createRepoCommit(SHA_B, 'second commit'),
          ],
        } as ProxyResponse<T>;
      },
    };

    const commits = await fetchRepoCommits(provider, OWNER, REPO, { maxCommits: 1 });

    assert.deepStrictEqual(commits.map((commit) => commit.sha), [SHA_A]);
    assert.strictEqual(requests.length, 1);
  });

  it('materializeRepoInternal with commits plan emits commits/_index.json', async () => {
    const commits = [
      createRepoCommit(SHA_A, 'first commit', '2026-05-01T00:00:00Z'),
      createRepoCommit(SHA_B, 'second commit', '2026-05-02T00:00:00Z'),
    ];
    const provider = new CommitRecordingProvider(commits);
    const adapter = createCommitMaterializingAdapter(provider);

    await adapter.sync('workspace-1');

    const indexPath = githubRepoCommitsIndexPath(OWNER, REPO);
    assert.ok(provider.writes.has(indexPath), `Expected ${indexPath} to exist`);
    const rawIndex = await provider.readFile(indexPath);
    const index = JSON.parse(rawIndex) as Array<{
      id: string;
      title: string;
      updated: string;
      sha: string;
      message: string;
      authorLogin: string;
      committedAt: string;
      canonicalPath: string;
    }>;
    assert.ok(Array.isArray(index), 'commits/_index.json must be an array');
    assert.strictEqual(index.length, 2);
    assert.deepStrictEqual(index.map((entry) => entry.sha), [SHA_B, SHA_A]);
    const expectedIndex = [
      {
        id: SHA_B,
        title: 'second commit',
        updated: '2026-05-02T00:00:00Z',
        sha: SHA_B,
        message: 'second commit',
        authorLogin: 'octocat',
        committedAt: '2026-05-02T00:00:00Z',
        canonicalPath: githubCommitPath(OWNER, REPO, SHA_B),
      },
      {
        id: SHA_A,
        title: 'first commit',
        updated: '2026-05-01T00:00:00Z',
        sha: SHA_A,
        message: 'first commit',
        authorLogin: 'octocat',
        committedAt: '2026-05-01T00:00:00Z',
        canonicalPath: githubCommitPath(OWNER, REPO, SHA_A),
      },
    ];
    assert.deepStrictEqual(index, expectedIndex);
    assert.strictEqual(rawIndex, `${JSON.stringify(expectedIndex)}\n`);
  });

  it('commits/_index.json entries have canonicalPath pointing to metadata.json', async () => {
    const commits = [createRepoCommit(SHA_A, 'add feature')];
    const provider = new CommitRecordingProvider(commits);
    const adapter = createCommitMaterializingAdapter(provider);

    await adapter.sync('workspace-1');

    const indexPath = githubRepoCommitsIndexPath(OWNER, REPO);
    const index = JSON.parse(await provider.readFile(indexPath)) as Array<{
      sha: string;
      canonicalPath: string;
    }>;
    const entry = index[0];
    assert.ok(entry, 'Expected at least one commit in the index');
    assert.strictEqual(entry.sha, SHA_A);
    assert.strictEqual(entry.canonicalPath, githubCommitPath(OWNER, REPO, SHA_A));
    assert.ok(
      entry.canonicalPath.endsWith('/metadata.json'),
      'canonicalPath must end with /metadata.json',
    );
  });

  it('canonical commit record is written at commits/<sha>/metadata.json', async () => {
    const commits = [createRepoCommit(SHA_A, 'fix bug')];
    const provider = new CommitRecordingProvider(commits);
    const adapter = createCommitMaterializingAdapter(provider);

    await adapter.sync('workspace-1');

    const canonicalPath = githubCommitPath(OWNER, REPO, SHA_A);
    assert.ok(provider.writes.has(canonicalPath), `Expected ${canonicalPath} to exist`);
    const record = JSON.parse(await provider.readFile(canonicalPath)) as Record<string, unknown>;
    assert.strictEqual(record.sha, SHA_A);
  });

  it('does not treat the Git author name as a GitHub authorLogin', async () => {
    const commit = createRepoCommit(SHA_A, 'unlinked author');
    commit.author = null as never;
    commit.commit.author.name = 'Git Author Name';
    const provider = new CommitRecordingProvider([commit]);
    const adapter = createCommitMaterializingAdapter(provider);

    await adapter.sync('workspace-1');

    const index = JSON.parse(
      await provider.readFile(githubRepoCommitsIndexPath(OWNER, REPO)),
    ) as Array<{ authorLogin: string }>;
    assert.strictEqual(index[0]?.authorLogin, '');
  });

  it('preserves a richer REST commit when a sparse push arrives for the same SHA', async () => {
    const restCommit = createRepoCommit(SHA_A, 'authoritative REST message');
    Object.assign(restCommit, {
      stats: { additions: 4, deletions: 1, total: 5 },
      files: [{ filename: 'src/index.ts', status: 'modified' }],
    });
    const provider = new CommitRecordingProvider([restCommit]);
    const adapter = createCommitMaterializingAdapter(provider);
    await adapter.sync('workspace-1');

    await adapter.ingestWebhook('workspace-1', {
      provider: 'github',
      connectionId: 'conn-commits',
      eventType: 'push',
      objectType: 'commit',
      objectId: SHA_A,
      payload: {
        ref: 'refs/heads/main',
        commits: [{
          id: SHA_A,
          message: 'sparse webhook message',
          timestamp: '2026-05-03T00:00:00Z',
          author: { name: 'Git Author Name', email: 'author@example.com' },
        }],
        repository: {
          name: REPO,
          full_name: `${OWNER}/${REPO}`,
          owner: { login: OWNER },
        },
      },
    });

    const canonicalPath = githubCommitPath(OWNER, REPO, SHA_A);
    const canonical = JSON.parse(await provider.readFile(canonicalPath)) as {
      sha: string;
      commit: { message: string };
      author: { login: string };
      stats: { total: number };
      files: Array<{ filename: string }>;
    };
    assert.strictEqual(canonical.sha, SHA_A);
    assert.strictEqual(canonical.commit.message, 'authoritative REST message');
    assert.strictEqual(canonical.author.login, 'octocat');
    assert.strictEqual(canonical.stats.total, 5);
    assert.strictEqual(canonical.files[0]?.filename, 'src/index.ts');

    const index = JSON.parse(
      await provider.readFile(githubRepoCommitsIndexPath(OWNER, REPO)),
    ) as Array<{ authorLogin: string; message: string }>;
    assert.strictEqual(index[0]?.authorLogin, 'octocat');
    assert.strictEqual(index[0]?.message, 'authoritative REST message');
  });

  it('skips commit rows with empty SHAs instead of constructing an invalid canonical path', async () => {
    const provider = new CommitRecordingProvider([createRepoCommit('', 'malformed commit')]);
    const adapter = createCommitMaterializingAdapter(provider);

    await adapter.sync('workspace-1');

    const index = JSON.parse(
      await provider.readFile(githubRepoCommitsIndexPath(OWNER, REPO)),
    ) as unknown[];
    assert.deepStrictEqual(index, []);
  });

  it('commits materialization respects since filter', async () => {
    const commits = [createRepoCommit(SHA_A, 'recent commit')];
    const provider = new CommitRecordingProvider(commits);
    const adapter = new GitHubAdapter(provider as never, {
      owner: OWNER,
      repo: REPO,
      connectionId: 'conn-commits',
      materialization: {
        default: 'eager',
        rules: [
          {
            repos: [`${OWNER}/${REPO}`],
            resources: ['commits'],
            since: '2026-06-01T00:00:00Z',
          },
        ],
      },
    });

    await adapter.sync('workspace-1');

    const commitRequests = provider.requests.filter((r) =>
      r.endpoint?.startsWith(`/repos/${OWNER}/${REPO}/commits`),
    );
    assert.ok(commitRequests.length >= 1, 'Expected a commits request');
    // The query must include the since filter
    const firstRequest = commitRequests[0];
    assert.ok(
      firstRequest.query?.since === '2026-06-01T00:00:00Z' ||
      firstRequest.endpoint?.includes('since='),
      'Commits request must pass the since filter',
    );
  });

  it('commits materialization respects the adapter maxCommits bound', async () => {
    const provider = new CommitRecordingProvider([
      createRepoCommit(SHA_A, 'first commit'),
      createRepoCommit(SHA_B, 'second commit'),
    ]);
    const adapter = createCommitMaterializingAdapter(provider, { maxCommits: 1 });

    await adapter.sync('workspace-1');

    const index = JSON.parse(
      await provider.readFile(githubRepoCommitsIndexPath(OWNER, REPO)),
    ) as Array<{ sha: string }>;
    assert.deepStrictEqual(index.map((entry) => entry.sha), [SHA_A]);
  });

  it('commits materialization can be disabled with mode=lazy', async () => {
    const commits = [createRepoCommit(SHA_A, 'should not appear')];
    const provider = new CommitRecordingProvider(commits);
    const adapter = new GitHubAdapter(provider as never, {
      owner: OWNER,
      repo: REPO,
      connectionId: 'conn-commits',
      materialization: {
        default: 'lazy',
      },
    });

    await adapter.sync('workspace-1');

    const indexPath = githubRepoCommitsIndexPath(OWNER, REPO);
    assert.strictEqual(
      provider.writes.has(indexPath),
      false,
      'commits/_index.json should not be written for fully lazy repos',
    );
  });

  it('layout-prompt documents commits/_index.json', async () => {
    const { GITHUB_LAYOUT_PROMPT } = await import('../layout-prompt.js');
    assert.ok(
      GITHUB_LAYOUT_PROMPT.includes('commits/_index.json'),
      'GITHUB_LAYOUT_PROMPT must mention commits/_index.json',
    );
    assert.ok(
      GITHUB_LAYOUT_PROMPT.includes('canonicalPath'),
      'GITHUB_LAYOUT_PROMPT must describe canonicalPath in commits index',
    );
  });

  it('layout.ts includes commits resource', async () => {
    const { layoutManifest } = await import('../layout.js');
    const manifest = layoutManifest();
    const commitsResource = manifest.resources.find((r) => r.path.includes('commits'));
    assert.ok(commitsResource, 'layout manifest must include a commits resource');
    assert.ok(
      commitsResource.path.includes('github/repos'),
      'commits resource path must be under github/repos',
    );
    assert.strictEqual(commitsResource.materialization, 'lazy');
  });

  it('push webhook with commits array writes each commit to its canonical path', async () => {
    const provider = new CommitRecordingProvider([]);
    const adapter = new GitHubAdapter(provider as never, {
      owner: OWNER,
      repo: REPO,
      connectionId: 'conn-commits',
    });

    const result = await adapter.ingestWebhook('workspace-1', {
      provider: 'github',
      connectionId: 'conn-commits',
      eventType: 'push',
      objectType: 'commit',
      objectId: SHA_A,
      payload: {
        ref: 'refs/heads/main',
        head_commit: {
          id: SHA_A,
          message: 'fix: resolve issue',
          author: { name: 'octocat', email: 'octocat@github.com' },
        },
        commits: [
          {
            id: SHA_A,
            message: 'fix: resolve issue',
            timestamp: '2026-05-01T00:00:00Z',
            author: { name: 'octocat', email: 'octocat@github.com' },
          },
          {
            id: SHA_B,
            message: 'refactor: clean up',
            timestamp: '2026-05-02T00:00:00Z',
            author: { name: 'octocat', email: 'octocat@github.com' },
          },
        ],
        repository: {
          name: REPO,
          full_name: `${OWNER}/${REPO}`,
          owner: { login: OWNER },
        },
      },
    });

    // Both commits should be written at their canonical paths
    const pathA = githubCommitPath(OWNER, REPO, SHA_A);
    const pathB = githubCommitPath(OWNER, REPO, SHA_B);
    assert.ok(provider.writes.has(pathA), `Expected ${pathA} to be written`);
    assert.ok(provider.writes.has(pathB), `Expected ${pathB} to be written`);
    assert.ok(result.paths.includes(pathA), `Result paths must include ${pathA}`);
    assert.ok(result.paths.includes(pathB), `Result paths must include ${pathB}`);
    const canonicalA = JSON.parse(await provider.readFile(pathA)) as {
      sha: string;
      commit: { message: string };
      author: unknown;
    };
    assert.strictEqual(canonicalA.sha, SHA_A);
    assert.strictEqual(canonicalA.commit.message, 'fix: resolve issue');
    assert.strictEqual(canonicalA.author, null);
    const indexPath = githubRepoCommitsIndexPath(OWNER, REPO);
    assert.ok(result.paths.includes(indexPath), `Result paths must include ${indexPath}`);
    const index = JSON.parse(await provider.readFile(indexPath)) as Array<{
      id: string;
      title: string;
      canonicalPath: string;
    }>;
    assert.deepStrictEqual(index.map((entry) => entry.id), [SHA_B, SHA_A]);
    assert.deepStrictEqual(index.map((entry) => entry.title), [
      'refactor: clean up',
      'fix: resolve issue',
    ]);
    assert.deepStrictEqual(index.map((entry) => entry.canonicalPath), [pathB, pathA]);
  });

  it('atomically preserves rows from concurrent push webhook index updates', async () => {
    const provider = new ConcurrentCommitProvider();
    const adapter = new GitHubAdapter(provider as never, {
      owner: OWNER,
      repo: REPO,
      connectionId: 'conn-commits',
    });
    const event = (sha: string, message: string, timestamp: string) => ({
      provider: 'github',
      connectionId: 'conn-commits',
      eventType: 'push',
      objectType: 'commit',
      objectId: sha,
      payload: {
        ref: 'refs/heads/main',
        commits: [{
          id: sha,
          message,
          timestamp,
          author: {
            name: 'octocat',
            email: 'octocat@github.com',
            username: 'octocat',
          },
        }],
        repository: {
          name: REPO,
          full_name: `${OWNER}/${REPO}`,
          owner: { login: OWNER },
        },
      },
    });

    const [first, second] = await Promise.all([
      adapter.ingestWebhook('workspace-1', event(SHA_A, 'first', '2026-05-01T00:00:00Z')),
      adapter.ingestWebhook('workspace-1', event(SHA_B, 'second', '2026-05-02T00:00:00Z')),
    ]);

    assert.deepStrictEqual(first.errors, []);
    assert.deepStrictEqual(second.errors, []);
    const indexPath = githubRepoCommitsIndexPath(OWNER, REPO);
    const rawIndex = provider.text(indexPath);
    assert.ok(rawIndex);
    const index = JSON.parse(rawIndex) as Array<{ id: string }>;
    assert.deepStrictEqual(index.map((entry) => entry.id), [SHA_B, SHA_A]);
    assert.ok(
      provider.conflictPaths.includes(indexPath),
      'the deterministic race must exercise a CAS conflict and retry',
    );
  });
});
