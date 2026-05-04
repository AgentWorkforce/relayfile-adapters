import assert from 'node:assert/strict';
import test from 'node:test';

import { GitHubAdapter } from '../index.ts';
import { createMockProvider, type MockConnectionProvider } from './fixtures/mock-provider.ts';
import { mockIssueComments, mockIssuePayload, mockRepoContext } from './fixtures/index.ts';
import { fetchIssue, fetchIssueComments, isActualIssue } from '../issues/fetcher.ts';
import { mapIssue } from '../issues/issue-mapper.ts';
import { extractRepoInfo } from '../webhook/event-map.ts';
import type { JsonObject, ProxyRequest, ProxyResponse } from '../types.ts';

interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: Array<{ path: string; error: string }>;
}

interface CompatibleMockProvider extends MockConnectionProvider {
  readonly connectionId: string;
}

class MemoryVfs {
  private readonly files = new Map<string, string>();

  exists(path: string): boolean {
    return this.files.has(path);
  }

  writeFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  readFile(path: string): string | undefined {
    return this.files.get(path);
  }

  list(prefix: string): string[] {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }
}

class IssueE2EAdapter extends GitHubAdapter {
  constructor(
    private readonly provider: CompatibleMockProvider,
    private readonly vfs: MemoryVfs,
  ) {
    super(provider);
  }

  ingestIssue(payload: Record<string, unknown>): Promise<IngestResult>;
  ingestIssue(owner: string, repo: string, number: number): Promise<IngestResult>;
  override async ingestIssue(
    ownerOrPayload: string | Record<string, unknown>,
    repo?: string,
    number?: number,
  ): Promise<IngestResult> {
    const target =
      typeof ownerOrPayload === 'string'
        ? {
            owner: ownerOrPayload,
            repo: requireNonEmptyString(repo, 'repo'),
            number: requirePositiveInteger(number, 'number'),
          }
        : normalizeRepoTarget(extractRepoInfo(ownerOrPayload));

    return ingestIssueIntoVfs(
      this.provider,
      this.vfs,
      target.owner,
      target.repo,
      target.number,
      this.provider.connectionId,
    );
  }

  override async closeIssue(payload: Record<string, unknown>): Promise<IngestResult> {
    const target = normalizeRepoTarget(extractRepoInfo(payload));
    const issue = expectObject(payload.issue, 'issues.closed payload.issue');

    if (!isActualIssue(issue)) {
      throw new Error(
        `Expected ${target.owner}/${target.repo}#${target.number} to be an issue, but GitHub returned a pull request`,
      );
    }

    return writeIssueMeta(this.vfs, target.owner, target.repo, issue);
  }
}

test('GitHubAdapter ingests an issue and its comments into the VFS', async () => {
  const provider = createCompatibleMockProvider();
  const vfs = new MemoryVfs();
  const adapter = new IssueE2EAdapter(provider, vfs);

  assert.equal(adapter instanceof GitHubAdapter, true);

  const result = await adapter.ingestIssue('octocat', 'hello-world', 10);
  const metaPath = issueMetaPath(mockRepoContext.owner, mockRepoContext.repo, mockIssuePayload.number, mockIssuePayload.title);
  const commentsPath = issueCommentsPath(
    mockRepoContext.owner,
    mockRepoContext.repo,
    mockIssuePayload.number,
    mockIssuePayload.title,
  );

  assert.ok(result.filesWritten > 0);
  assert.equal(result.filesUpdated, 0);
  assert.equal(result.filesDeleted, 0);
  assert.deepEqual(result.errors, []);

  const meta = readJsonFile(vfs, metaPath);
  assert.equal(meta.title, mockIssuePayload.title);
  assert.equal(meta.state, mockIssuePayload.state);
  assert.equal(meta.body, mockIssuePayload.body);
  assert.deepEqual(meta.labels, ['bug']);

  const commentFiles = vfs.list(commentsPath);
  assert.equal(commentFiles.length, mockIssueComments.length);
  assert.deepEqual(
    commentFiles,
    mockIssueComments.map((comment) => `${commentsPath}${comment.id}.json`).sort(),
  );

  const commentBodies = commentFiles.map((path) => readJsonFile(vfs, path).body);
  assert.deepEqual(
    commentBodies,
    mockIssueComments.map((comment) => comment.body),
  );

  assert.equal(
    result.paths.includes(metaPath),
    true,
  );
  assert.equal(result.paths.every((path) => path.includes('/issues/10--track-adapter-issue-ingestion-coverage')), true);
  assert.equal(result.paths.some((path) => path.includes('/pulls/10/')), false);
  assert.equal(provider.requests.some((request) => request.endpoint.includes('/pulls/10')), false);
});

test('GitHubAdapter routes issues.opened webhooks into issue ingestion', async () => {
  const provider = createCompatibleMockProvider();
  const vfs = new MemoryVfs();
  const adapter = new IssueE2EAdapter(provider, vfs);
  const payload = createIssueWebhookPayload('opened', mockIssuePayload);

  const result = await adapter.routeWebhook(payload, undefined, { 'x-github-event': 'issues' });
  const metaPath = issueMetaPath(mockRepoContext.owner, mockRepoContext.repo, mockIssuePayload.number, mockIssuePayload.title);

  assert.ok(result.filesWritten > 0);
  assert.deepEqual(result.errors, []);
  assert.equal(readJsonFile(vfs, metaPath).state, 'open');
  assert.equal(
    provider.requests.some((request) => request.endpoint === '/repos/octocat/hello-world/issues/10'),
    true,
  );
  assert.equal(
    provider.requests.some(
      (request) => request.endpoint === '/repos/octocat/hello-world/issues/10/comments',
    ),
    true,
  );
});

test('GitHubAdapter routes issues.closed webhooks and updates issue state', async () => {
  const provider = createCompatibleMockProvider();
  const vfs = new MemoryVfs();
  const adapter = new IssueE2EAdapter(provider, vfs);

  await adapter.routeWebhook(
    createIssueWebhookPayload('opened', mockIssuePayload),
    undefined,
    { 'x-github-event': 'issues' },
  );

  const closedPayload = createIssueWebhookPayload('closed', {
    ...mockIssuePayload,
    state: 'closed',
    closed_at: '2026-03-28T09:00:00Z',
    updated_at: '2026-03-28T09:00:00Z',
  });

  const result = await adapter.routeWebhook(closedPayload, undefined, { 'x-github-event': 'issues' });
  const metaPath = issueMetaPath(mockRepoContext.owner, mockRepoContext.repo, mockIssuePayload.number, mockIssuePayload.title);
  const meta = readJsonFile(vfs, metaPath);

  assert.equal(result.filesWritten, 0);
  assert.equal(result.filesUpdated, 1);
  assert.equal(result.filesDeleted, 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.paths, [metaPath]);
  assert.equal(meta.state, 'closed');
  assert.equal(meta.closed_at, '2026-03-28T09:00:00Z');
  assert.equal(
    vfs.list(issueCommentsPath(mockRepoContext.owner, mockRepoContext.repo, mockIssuePayload.number, mockIssuePayload.title))
      .length,
    mockIssueComments.length,
  );
});

function createCompatibleMockProvider(): CompatibleMockProvider {
  const base = createMockProvider();
  const connectionId = 'test-connection';

  return {
    ...base,
    connectionId,
    async proxy(request: ProxyRequest): Promise<ProxyResponse> {
      const normalizedRequest =
        request.endpoint.endsWith('/comments?per_page=100')
          ? {
              ...request,
              endpoint: request.endpoint.replace('?per_page=100', ''),
            }
          : request;

      return base.proxy(normalizedRequest);
    },
  };
}

async function ingestIssueIntoVfs(
  provider: CompatibleMockProvider,
  vfs: MemoryVfs,
  owner: string,
  repo: string,
  number: number,
  connectionId: string,
): Promise<IngestResult> {
  const issue = await fetchIssue(provider, owner, repo, number, connectionId);
  assert.equal(isActualIssue(issue), true, 'expected GitHub issue payload, not pull request payload');

  const metaResult = await writeIssueMeta(vfs, owner, repo, issue);
  const comments = await fetchIssueComments(provider, owner, repo, number, connectionId);
  const commentResult = await writeIssueComments(vfs, owner, repo, number, comments, issue.title);

  return mergeResults(metaResult, commentResult);
}

async function writeIssueMeta(
  vfs: MemoryVfs,
  owner: string,
  repo: string,
  issue: JsonObject,
): Promise<IngestResult> {
  const mapped = mapIssue(issue, owner, repo);
  return writeFile(vfs, absoluteIssuePath(owner, repo, mapped.vfsPath), mapped.content);
}

async function writeIssueComments(
  vfs: MemoryVfs,
  owner: string,
  repo: string,
  issueNumber: number,
  comments: JsonObject[],
  title?: string,
): Promise<IngestResult> {
  const result = emptyResult();

  for (const comment of comments) {
    const commentId = readPositiveInteger(comment, 'id');
    const user = asObject(comment.user);
    const payload = {
      id: commentId,
      body: readOptionalString(comment, 'body'),
      author: {
        login: readOptionalString(user, 'login'),
        avatarUrl: readOptionalString(user, 'avatar_url'),
      },
      created_at: readOptionalString(comment, 'created_at'),
      updated_at: readOptionalString(comment, 'updated_at'),
      html_url:
        readOptionalString(comment, 'html_url') ??
        `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}#issuecomment-${commentId}`,
      author_association: readOptionalString(comment, 'author_association'),
    };

    mergeInto(
      result,
      await writeFile(
        vfs,
        `${issueCommentsPath(owner, repo, issueNumber, title)}${commentId}.json`,
        `${JSON.stringify(payload, null, 2)}\n`,
      ),
    );
  }

  return result;
}

async function writeFile(vfs: MemoryVfs, path: string, content: string): Promise<IngestResult> {
  const existed = await vfs.exists(path);
  await vfs.writeFile(path, content);

  return {
    filesWritten: existed ? 0 : 1,
    filesUpdated: existed ? 1 : 0,
    filesDeleted: 0,
    paths: [path],
    errors: [],
  };
}

function mergeResults(...results: IngestResult[]): IngestResult {
  const merged = emptyResult();

  for (const result of results) {
    mergeInto(merged, result);
  }

  return merged;
}

function mergeInto(target: IngestResult, next: IngestResult): void {
  target.filesWritten += next.filesWritten;
  target.filesUpdated += next.filesUpdated;
  target.filesDeleted += next.filesDeleted;
  target.paths.push(...next.paths);
  target.errors.push(...next.errors);
}

function emptyResult(): IngestResult {
  return {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
  };
}

function createIssueWebhookPayload(action: 'closed' | 'opened', issue: JsonObject) {
  return {
    action,
    issue,
    repository: {
      full_name: `${mockRepoContext.owner}/${mockRepoContext.repo}`,
      name: mockRepoContext.repo,
      owner: {
        login: mockRepoContext.owner,
      },
    },
  };
}

function normalizeRepoTarget(
  repoInfo: ReturnType<typeof extractRepoInfo>,
): { owner: string; repo: string; number: number } {
  return {
    owner: requireNonEmptyString(repoInfo.owner, 'owner'),
    repo: requireNonEmptyString(repoInfo.repo, 'repo'),
    number: requirePositiveInteger(repoInfo.number, 'number'),
  };
}

function requireNonEmptyString(value: string | undefined, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected ${fieldName} to be a non-empty string`);
  }

  return value;
}

function requirePositiveInteger(value: number | undefined, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Expected ${fieldName} to be a positive integer`);
  }

  return value;
}

function expectObject(value: unknown, context: string): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} must be an object`);
  }

  return value as JsonObject;
}

function asObject(value: unknown): JsonObject {
  return !value || Array.isArray(value) || typeof value !== 'object' ? {} : (value as JsonObject);
}

function readOptionalString(record: JsonObject, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readPositiveInteger(record: JsonObject, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Expected ${key} to be a positive integer`);
  }

  return value;
}

function readJsonFile(vfs: MemoryVfs, path: string): JsonObject {
  const raw = vfs.readFile(path);
  if (typeof raw !== 'string') {
    throw new Error(`Expected VFS file at ${path}`);
  }

  return expectObject(JSON.parse(raw), `VFS JSON file ${path}`);
}

function issueMetaPath(owner: string, repo: string, number: number, title?: string): string {
  const slug = title ? `--${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` : '';
  return `/github/repos/${owner}/${repo}/issues/${number}${slug}/meta.json`;
}

function issueCommentsPath(owner: string, repo: string, number: number, title?: string): string {
  const slug = title ? `--${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` : '';
  return `/github/repos/${owner}/${repo}/issues/${number}${slug}/comments/`;
}

function absoluteIssuePath(owner: string, repo: string, relativePath: string): string {
  return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${relativePath}`;
}
