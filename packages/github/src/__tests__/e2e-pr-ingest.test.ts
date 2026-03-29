import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GitHubAdapter,
  type FileSemantics,
  type IngestResult,
  type JsonValue,
  type ProxyRequest,
  type ProxyResponse,
} from '../index.js';
import { ingestCheckRuns } from '../checks/mapper.ts';
import { fetchPRCommits } from '../commits/fetcher.ts';
import { mapCommitToVFS } from '../commits/mapper.ts';
import { fetchHeadAndBase, writeFileContents } from '../files/content-fetcher.ts';
import { mapPRFiles } from '../pr/file-mapper.ts';
import { ingestReviewComments } from '../reviews/comment-mapper.ts';
import { ingestReviews } from '../reviews/review-mapper.ts';
import { mapPRProperties } from '../semantics/property-mapper.ts';
import { mapPRRelations } from '../semantics/relation-mapper.ts';
import { createMockProvider } from './fixtures/mock-provider.ts';
import { mockPRPayload, mockRepoContext } from './fixtures/index.ts';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const CONNECTION_ID = 'mock-connection';
const PROVIDER_CONFIG_KEY = 'github-app-oauth';

type VfsWriteState = {
  created?: boolean;
  status?: 'created' | 'updated';
  updated?: boolean;
};

class InMemoryVfs {
  private readonly files = new Map<string, string>();
  private readonly semantics = new Map<string, FileSemantics>();

  has(path: string): boolean {
    return this.files.has(path);
  }

  list(prefix: string): string[] {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  readFile(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`Missing VFS path: ${path}`);
    }

    return content;
  }

  getSemantics(path: string): FileSemantics | undefined {
    return this.semantics.get(path);
  }

  setSemantics(path: string, semantics: FileSemantics): void {
    this.semantics.set(path, semantics);
  }

  writeFile(path: string, content: string): VfsWriteState {
    const existed = this.files.has(path);
    this.files.set(path, content);

    return existed
      ? { created: false, status: 'updated', updated: true }
      : { created: true, status: 'created', updated: false };
  }
}

type FixtureProvider = ReturnType<typeof createMockProvider> & {
  connectionId: string;
  defaultConnectionId: string;
  providerConfigKey: string;
  defaultProviderConfigKey: string;
};

class E2EGitHubAdapter extends GitHubAdapter {
  constructor(
    private readonly fixtureProvider: FixtureProvider,
    private readonly vfs: InMemoryVfs,
  ) {
    super(fixtureProvider, {
      connectionId: CONNECTION_ID,
      owner: mockRepoContext.owner,
      providerConfigKey: PROVIDER_CONFIG_KEY,
      repo: mockRepoContext.repo,
    });
  }

  override async ingestPullRequest(payload: Record<string, unknown>): Promise<IngestResult>;
  async ingestPullRequest(owner: string, repo: string, number: number): Promise<IngestResult>;
  override async ingestPullRequest(
    ownerOrPayload: Record<string, unknown> | string,
    repo?: string,
    number?: number,
  ): Promise<IngestResult> {
    const target =
      typeof ownerOrPayload === 'string'
        ? {
            owner: ownerOrPayload,
            repo: expectNonEmptyString(repo, 'repo'),
            number: expectPositiveInteger(number, 'number'),
          }
        : resolvePayloadTarget(ownerOrPayload);

    const prRoot = buildPrRoot(target.owner, target.repo, target.number);
    const repoRoot = buildRepoRoot(target.owner, target.repo);
    const pr = await fetchPullRequestJson(
      this.fixtureProvider,
      target.owner,
      target.repo,
      target.number,
    );
    const results: IngestResult[] = [];

    results.push(
      await writeDocument(
        this.vfs,
        `${prRoot}/meta.json`,
        `${JSON.stringify(pr, null, 2)}\n`,
      ),
    );
    this.vfs.setSemantics(`${prRoot}/meta.json`, {
      properties: mapPRProperties(pr) ?? {},
      relations: mapPRRelations(target.owner, target.repo, target.number) ?? [],
    });

    const diff = await fetchPullRequestDiff(
      this.fixtureProvider,
      target.owner,
      target.repo,
      target.number,
    );
    results.push(await writeDocument(this.vfs, `${prRoot}/diff.patch`, diff));

    const files = await mapPRFiles(
      this.fixtureProvider,
      target.owner,
      target.repo,
      target.number,
    );
    const fileContents = await Promise.all(
      files.map((file) =>
        fetchHeadAndBase(
          this.fixtureProvider,
          target.owner,
          target.repo,
          target.number,
          {
            filename: file.githubPath,
            status: file.status,
          },
          readNestedString(pr, ['head', 'sha']),
          readNestedString(pr, ['base', 'sha']),
        ),
      ),
    );
    results.push(
      await writeFileContents(fileContents, this.vfs, target.owner, target.repo, target.number),
    );

    const commits = await fetchPRCommits(
      this.fixtureProvider,
      target.owner,
      target.repo,
      target.number,
    );
    results.push(await writeCommitDocuments(this.vfs, repoRoot, commits, target));

    results.push(
      await ingestReviews(
        this.fixtureProvider,
        target.owner,
        target.repo,
        target.number,
        scopedVfs(this.vfs, prRoot),
      ),
    );
    results.push(
      await ingestReviewComments(
        this.fixtureProvider,
        target.owner,
        target.repo,
        target.number,
        scopedVfs(this.vfs, prRoot),
      ),
    );
    results.push(
      await ingestCheckRuns(
        this.fixtureProvider,
        target.owner,
        target.repo,
        target.number,
        readNestedString(pr, ['head', 'sha']),
        scopedVfs(this.vfs, prRoot),
      ),
    );

    return mergeIngestResults(results);
  }
}

describe('e2e PR ingest', () => {
  it('GitHubAdapter ingests a pull request into the expected VFS layout', async () => {
    const provider = createFixtureProvider();
    const vfs = new InMemoryVfs();
    const adapter = new E2EGitHubAdapter(provider, vfs);

    const result = await adapter.ingestPullRequest('octocat', 'hello-world', 42);
    const prRoot = '/github/repos/octocat/hello-world/pulls/42';
    const metaPath = `${prRoot}/meta.json`;
    const diffPath = `${prRoot}/diff.patch`;
    const filePaths = vfs.list(`${prRoot}/files/`);
    const basePaths = vfs.list(`${prRoot}/base/`);
    const commitPaths = vfs.list(`${prRoot}/commits/`);
    const reviewPaths = vfs.list(`${prRoot}/reviews/`);
    const commentPaths = vfs.list(`${prRoot}/comments/`);
    const checkPaths = vfs.list(`${prRoot}/checks/`);

    assert.ok(result.filesWritten > 0);
    assert.deepStrictEqual(result.errors, []);

    const meta = JSON.parse(vfs.readFile(metaPath)) as Record<string, unknown>;
    assert.strictEqual(meta.title, mockPRPayload.title);
    assert.strictEqual(meta.state, mockPRPayload.state);

    assert.ok(vfs.readFile(diffPath).trim().length > 0);
    assert.ok(vfs.readFile(diffPath).includes('diff --git'));

    assert.strictEqual(filePaths.length, 3);
    assert.strictEqual(basePaths.length, 3);
    assert.strictEqual(commitPaths.length, 2);
    assert.strictEqual(reviewPaths.length, 1);
    assert.strictEqual(commentPaths.length, 2);
    assert.strictEqual(checkPaths.length, 3);
    assert.ok(checkPaths.includes(`${prRoot}/checks/_summary.json`));

    for (const path of vfs.list(`${prRoot}/`)) {
      if (!path.endsWith('.json')) {
        continue;
      }

      // Should not throw
      JSON.parse(vfs.readFile(path));
    }

    assert.deepStrictEqual(vfs.getSemantics(metaPath), {
      properties: mapPRProperties(mockPRPayload) ?? {},
      relations: mapPRRelations('octocat', 'hello-world', 42) ?? [],
    });
  });
});

function buildRepoRoot(owner: string, repo: string): string {
  return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function buildPrRoot(owner: string, repo: string, number: number): string {
  return `${buildRepoRoot(owner, repo)}/pulls/${number}`;
}

function createFixtureProvider(): FixtureProvider {
  const provider = createMockProvider();

  return {
    ...provider,
    connectionId: CONNECTION_ID,
    defaultConnectionId: CONNECTION_ID,
    providerConfigKey: PROVIDER_CONFIG_KEY,
    defaultProviderConfigKey: PROVIDER_CONFIG_KEY,
    async proxy(request: ProxyRequest): Promise<ProxyResponse> {
      return provider.proxy(normalizeFixtureRequest(request));
    },
  };
}

function mergeIngestResults(results: readonly IngestResult[]): IngestResult {
  return results.reduce<IngestResult>(
    (merged, result) => {
      merged.filesWritten += result.filesWritten;
      merged.filesUpdated += result.filesUpdated;
      merged.filesDeleted += result.filesDeleted;
      merged.paths.push(...result.paths);
      merged.errors.push(...result.errors);
      return merged;
    },
    {
      filesWritten: 0,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [],
      errors: [],
    },
  );
}

function normalizeFixtureRequest(request: ProxyRequest): ProxyRequest {
  const commitsEndpoint = `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/commits`;

  if (request.endpoint.startsWith(`${commitsEndpoint}?`)) {
    return {
      ...request,
      endpoint: commitsEndpoint,
    };
  }

  return request;
}

function resolvePayloadTarget(payload: Record<string, unknown>): {
  owner: string;
  repo: string;
  number: number;
} {
  const repository = expectObject(payload.repository, 'payload.repository');
  const fullName = expectNonEmptyString(readUnknownString(repository.full_name), 'repository.full_name');
  const [owner, repo] = fullName.split('/', 2);
  const pullRequest = expectObject(payload.pull_request, 'payload.pull_request');

  return {
    owner: expectNonEmptyString(owner, 'owner'),
    repo: expectNonEmptyString(repo, 'repo'),
    number: expectPositiveInteger(readUnknownNumber(pullRequest.number), 'pull_request.number'),
  };
}

function scopedVfs(vfs: InMemoryVfs, root: string): { writeFile(path: string, content: string): VfsWriteState } {
  return {
    writeFile(path: string, content: string): VfsWriteState {
      return vfs.writeFile(joinVfsPath(root, path), content);
    },
  };
}

async function writeCommitDocuments(
  vfs: InMemoryVfs,
  repoRoot: string,
  commits: readonly Record<string, unknown>[],
  target: { owner: string; repo: string; number: number },
): Promise<IngestResult> {
  const results: IngestResult[] = [];

  for (const commit of commits) {
    const mapped = mapCommitToVFS(commit, target.owner, target.repo, target.number);
    results.push(await writeDocument(vfs, joinVfsPath(repoRoot, mapped.vfsPath), mapped.content));
  }

  return mergeIngestResults(results);
}

async function writeDocument(vfs: InMemoryVfs, path: string, content: string): Promise<IngestResult> {
  const writeState = vfs.writeFile(path, content);

  return {
    filesWritten: writeState.created ? 1 : 0,
    filesUpdated: writeState.updated ? 1 : 0,
    filesDeleted: 0,
    paths: [path],
    errors: [],
  };
}

async function fetchPullRequestJson(
  provider: FixtureProvider,
  owner: string,
  repo: string,
  number: number,
): Promise<Record<string, unknown>> {
  const response = await provider.proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`,
    connectionId: provider.connectionId,
    headers: {
      Accept: 'application/vnd.github+json',
      'Provider-Config-Key': provider.providerConfigKey,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.status >= 400) {
    throw new Error(`Failed to fetch pull request ${owner}/${repo}#${number}`);
  }

  return expectObject(response.data, 'pull request response');
}

async function fetchPullRequestDiff(
  provider: FixtureProvider,
  owner: string,
  repo: string,
  number: number,
): Promise<string> {
  const response = await provider.proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`,
    connectionId: provider.connectionId,
    headers: {
      Accept: 'application/vnd.github.diff',
      'Provider-Config-Key': provider.providerConfigKey,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.status >= 400 || typeof response.data !== 'string') {
    throw new Error(`Failed to fetch diff for pull request ${owner}/${repo}#${number}`);
  }

  return response.data;
}

function joinVfsPath(root: string, path: string): string {
  return `${root.replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`;
}

function expectObject(value: JsonValue | null | unknown, context: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} must be an object`);
  }

  return value as Record<string, unknown>;
}

function expectNonEmptyString(value: string | undefined, context: string): string {
  if (!value?.trim()) {
    throw new Error(`${context} must be a non-empty string`);
  }

  return value.trim();
}

function expectPositiveInteger(value: number | undefined, context: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${context} must be a positive integer`);
  }

  return value;
}

function readNestedString(source: Record<string, unknown>, path: readonly string[]): string {
  let current: unknown = source;

  for (const segment of path) {
    if (!current || Array.isArray(current) || typeof current !== 'object') {
      throw new Error(`${path.join('.')} is missing`);
    }

    current = (current as Record<string, unknown>)[segment];
  }

  if (typeof current !== 'string' || !current.trim()) {
    throw new Error(`${path.join('.')} must be a non-empty string`);
  }

  return current;
}

function readUnknownNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function readUnknownString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
