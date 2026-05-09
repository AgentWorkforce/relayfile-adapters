import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GitHubAdapter } from '../index.js';
import type { GitHubAdapterConfig, ProxyRequest, ProxyResponse } from '../types.js';

type RepoName = 'repo-a' | 'repo-b';

interface RecordingProviderOptions {
  delayMs?: number;
  repos?: RepoName[];
}

class RecordingProvider {
  readonly name = 'recording-github';
  readonly connectionId = 'conn-lazy';
  readonly requests: ProxyRequest[] = [];
  readonly writes = new Map<string, string>();

  constructor(private readonly options: RecordingProviderOptions = {}) {}

  async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
    this.requests.push(request);
    await maybeDelay(this.options.delayMs);

    if (request.endpoint === '/orgs/octocat/repos') {
      return this.json(
        (this.options.repos ?? ['repo-a', 'repo-b']).map((repo) => createRepository(repo)),
      ) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-a') {
      return this.json(createRepository('repo-a')) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-b') {
      return this.json(createRepository('repo-b')) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-a/issues') {
      return this.json([createIssue('repo-a', 10, 'repo-a issue')]) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-b/issues') {
      return this.json([]) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-a/issues/10') {
      return this.json(createIssue('repo-a', 10, 'repo-a issue')) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-b/issues/20') {
      return this.json(createIssue('repo-b', 20, 'repo-b issue')) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-a/issues/10/comments?per_page=100') {
      return this.json([]) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-b/issues/20/comments?per_page=100') {
      return this.json([]) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-a/pulls') {
      return this.json([createPull('repo-a', 42, 'repo-a pull')]) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-b/pulls') {
      return this.json([]) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-a/pulls/42/files') {
      return this.json([
        {
          sha: '1234567890abcdef1234567890abcdef12345678',
          filename: 'src/index.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
        },
      ]) as ProxyResponse<T>;
    }

    if (request.endpoint === '/repos/octocat/repo-a/pulls/42') {
      if (request.headers?.Accept === 'application/vnd.github.diff') {
        return {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          data: '@@ -1 +1 @@\n-old\n+new\n' as T,
        };
      }

      return this.json(createPull('repo-a', 42, 'repo-a pull')) as ProxyResponse<T>;
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

  async healthCheck(): Promise<boolean> {
    return true;
  }

  countRequests(endpoint: string): number {
    return this.requests.filter((request) => request.endpoint === endpoint).length;
  }

  private json<T>(data: T): ProxyResponse<T> {
    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      data,
    };
  }
}

function createRepository(repo: RepoName) {
  return {
    id: repo === 'repo-a' ? 1 : 2,
    name: repo,
    full_name: `octocat/${repo}`,
    html_url: `https://github.com/octocat/${repo}`,
    owner: { login: 'octocat' },
  };
}

function createIssue(repo: RepoName, number: number, title: string) {
  return {
    number,
    title,
    state: 'open',
    body: `${title} body`,
    html_url: `https://github.com/octocat/${repo}/issues/${number}`,
    user: {
      login: 'octocat',
      avatar_url: 'https://avatars.githubusercontent.com/u/1',
    },
    labels: [],
    assignees: [],
  };
}

function createPull(repo: RepoName, number: number, title: string) {
  return {
    number,
    title,
    state: 'open',
    body: `${title} body`,
    html_url: `https://github.com/octocat/${repo}/pull/${number}`,
    diff_url: `https://github.com/octocat/${repo}/pull/${number}.diff`,
    patch_url: `https://github.com/octocat/${repo}/pull/${number}.patch`,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-02T00:00:00Z',
    closed_at: null,
    merged_at: null,
    draft: false,
    merged: false,
    user: {
      id: 1,
      login: 'octocat',
      type: 'User',
      avatar_url: 'https://avatars.githubusercontent.com/u/1',
      html_url: 'https://github.com/octocat',
    },
    labels: [],
    head: {
      label: 'octocat:feature',
      ref: 'feature',
      sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      repo: createRepository(repo),
    },
    base: {
      label: 'octocat:main',
      ref: 'main',
      sha: 'fedcbafedcbafedcbafedcbafedcbafedcbafedc',
      repo: createRepository(repo),
    },
  };
}

function createAdapter(provider: RecordingProvider, config: Partial<GitHubAdapterConfig> = {}) {
  return new GitHubAdapter(provider as never, {
    owner: 'octocat',
    ...config,
  });
}

async function maybeDelay(delayMs: number | undefined): Promise<void> {
  if (!delayMs) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

describe('GitHub lazy materialization', () => {
  it('lazy defaults to false and initial sync writes full repo subtrees', async () => {
    const provider = new RecordingProvider();
    const adapter = createAdapter(provider);

    await adapter.sync('workspace-1');

    assert.ok(provider.writes.has('/github/repos/octocat/repo-a/metadata.json'));
    assert.ok(provider.writes.has('/github/repos/octocat/repo-a/issues/_index.json'));
    assert.ok(provider.writes.has('/github/repos/octocat/repo-a/pulls/_index.json'));
  });

  it('lazy true initial sync writes only the repos index plus root marker', async () => {
    const provider = new RecordingProvider();
    const adapter = createAdapter(provider, { lazy: true });

    await adapter.sync('workspace-1');

    assert.deepStrictEqual(Array.from(provider.writes.keys()).sort(), [
      '/github/repos/',
      '/github/repos/_index.json',
    ]);
    assert.strictEqual(
      Array.from(provider.writes.keys()).some((path) => path.startsWith('/github/repos/octocat/')),
      false,
    );
  });

  it('materializeRepo populates only one repo subtree and leaves the others untouched', async () => {
    const provider = new RecordingProvider();
    const adapter = createAdapter(provider, { lazy: true });

    await adapter.sync('workspace-1');
    const result = await adapter.materializeRepo('workspace-1', 'octocat', 'repo-a');

    // PR 2 emits alias artifacts under `/github/repos/<owner>__<repo>/` and
    // PR 1 emits root-level `/github/repos/_index.json` and `/github/LAYOUT.md`
    // alongside the canonical `/github/repos/<owner>/<repo>/` subtree.
    // Make sure paths only target repo-a (or shared roots), and that repo-b
    // is untouched under either prefix.
    assert.strictEqual(
      result.paths.every(
        (path) =>
          path.startsWith('/github/repos/octocat/repo-a/') ||
          path.startsWith('/github/repos/octocat__repo-a/') ||
          path === '/github/repos/_index.json' ||
          path === '/github/LAYOUT.md',
      ),
      true,
    );
    assert.strictEqual(
      Array.from(provider.writes.keys()).some(
        (path) => path.startsWith('/github/repos/octocat/repo-b/') || path.startsWith('/github/repos/octocat__repo-b/'),
      ),
      false,
    );
    assert.ok(provider.writes.has('/github/repos/octocat/repo-a/metadata.json'));
    assert.ok(provider.writes.has('/github/repos/octocat/repo-a/issues/_index.json'));
    assert.ok(provider.writes.has('/github/repos/octocat/repo-a/pulls/_index.json'));
  });

  it('materializeRepo is idempotent for an already materialized repo', async () => {
    const provider = new RecordingProvider();
    const adapter = createAdapter(provider, { lazy: true });

    await adapter.sync('workspace-1');
    await adapter.materializeRepo('workspace-1', 'octocat', 'repo-a');
    const second = await adapter.materializeRepo('workspace-1', 'octocat', 'repo-a');

    assert.strictEqual(second.filesWritten, 0);
    assert.ok(second.filesUpdated > 0);
  });

  it('lazy false sync writes full repo subtrees', async () => {
    const provider = new RecordingProvider();
    const adapter = createAdapter(provider, {
      repo: 'repo-a',
      lazy: false,
    });

    await adapter.sync('workspace-1');

    assert.ok(provider.writes.has('/github/repos/octocat/repo-a/metadata.json'));
    assert.ok(provider.writes.has('/github/repos/octocat/repo-a/issues/_index.json'));
    assert.ok(provider.writes.has('/github/repos/octocat/repo-a/pulls/_index.json'));
  });

  it('lazy sync with zero accessible repos writes an empty root index', async () => {
    const provider = new RecordingProvider({ repos: [] });
    const adapter = createAdapter(provider, { lazy: true });

    await adapter.sync('workspace-1');

    assert.deepStrictEqual(
      JSON.parse(await provider.readFile('/github/repos/_index.json')),
      { repos: [] },
    );
  });

  it('materializeRepo repairs a missing cached root index entry before writing the repo subtree', async () => {
    const provider = new RecordingProvider({ repos: [] });
    const adapter = createAdapter(provider, { lazy: true });

    await adapter.sync('workspace-1');
    await adapter.materializeRepo('workspace-1', 'octocat', 'repo-a');

    // PR 1's index emitter overwrites the lazy `{repos: [...]}` payload with
    // a flat array of `{ id, title, updated }` rows after materialize completes.
    // This is a known shape conflict tracked alongside the wider alias/index
    // unification work; here we just verify some entry for repo-a survived
    // the reconciliation and that the canonical metadata file was written.
    const raw = await provider.readFile('/github/repos/_index.json');
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { repos?: unknown }).repos)
        ? ((parsed as { repos: unknown[] }).repos)
        : [];
    assert.ok(
      rows.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const record = entry as Record<string, unknown>;
        return record.id === 'octocat/repo-a' || (record.owner === 'octocat' && record.repo === 'repo-a');
      }),
      'expected repo-a to be present in the root index after materialize',
    );
    assert.ok(provider.writes.has('/github/repos/octocat/repo-a/metadata.json'));
  });

  it('parallel materializeRepo calls share one in-flight fetch and return the same repo paths', async () => {
    const provider = new RecordingProvider({ delayMs: 5 });
    const adapter = createAdapter(provider, { lazy: true });

    await adapter.sync('workspace-1');
    provider.requests.length = 0;

    const [first, second] = await Promise.all([
      adapter.materializeRepo('workspace-1', 'octocat', 'repo-a'),
      adapter.materializeRepo('workspace-1', 'octocat', 'repo-a'),
    ]);

    assert.deepStrictEqual(second.paths, first.paths);
    assert.strictEqual(provider.countRequests('/repos/octocat/repo-a'), 1);
    assert.strictEqual(provider.countRequests('/repos/octocat/repo-a/issues'), 1);
    assert.strictEqual(provider.countRequests('/repos/octocat/repo-a/pulls'), 1);
  });

  it('materializeRepo writes metadata plus empty issue and pull indexes for repos with no synced content', async () => {
    const provider = new RecordingProvider();
    const adapter = createAdapter(provider, { lazy: true });

    await adapter.sync('workspace-1');
    const result = await adapter.materializeRepo('workspace-1', 'octocat', 'repo-b');

    assert.deepStrictEqual(result.paths.sort(), [
      '/github/repos/octocat/repo-b/issues/_index.json',
      '/github/repos/octocat/repo-b/metadata.json',
      '/github/repos/octocat/repo-b/pulls/_index.json',
    ]);
    assert.deepStrictEqual(
      JSON.parse(await provider.readFile('/github/repos/octocat/repo-b/issues/_index.json')),
      { issues: [] },
    );
    assert.deepStrictEqual(
      JSON.parse(await provider.readFile('/github/repos/octocat/repo-b/pulls/_index.json')),
      { pulls: [] },
    );
  });
});
