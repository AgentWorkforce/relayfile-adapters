import { Buffer } from 'node:buffer';

import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  mockBaseFileContents,
  mockDiff,
  mockFileContents,
  mockPRFiles,
  mockPRPayload,
  mockRepoContext,
} from '../../__tests__/fixtures/index.js';
import type { VfsLike } from '../../files/content-fetcher.js';
import type { GitHubRequestProvider, ProxyRequest, ProxyResponse } from '../../types.js';
import {
  batchFetchFiles,
  checkRateLimit,
  throttleIfNeeded,
  type FileContent,
  type PullRequestFileDescriptor,
} from '../batch-fetcher.js';
import {
  bulkIngestPR,
  bulkWriteToVFS,
  mergeIngestResults,
} from '../bulk-writer.js';

const GITHUB_API_BASE_URL = 'https://api.github.com';

function encodeContent(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function jsonResponse(data: ProxyResponse['data'], headers: Record<string, string> = {}): ProxyResponse {
  return {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-ratelimit-remaining': '5000',
      'x-ratelimit-reset': '1893456000',
      ...headers,
    },
    data,
  };
}

function createContentResponse(path: string, ref: string, content: string): ProxyResponse {
  return jsonResponse({
    type: 'file',
    encoding: 'base64',
    path,
    sha: `${ref}:${path}`,
    size: Buffer.byteLength(content, 'utf8'),
    content: encodeContent(content),
  });
}

function createMemoryVfs(initialEntries: Record<string, string> = {}) {
  const writes = new Map(Object.entries(initialEntries));
  const exists = mock.fn(async (path: string) => writes.has(path));
  const writeFile = mock.fn(async (path: string, content: string) => {
    writes.set(path, content);
  });

  const vfs: VfsLike = {
    exists,
    writeFile,
  };

  return { exists, vfs, writeFile, writes };
}

function createProvider(
  handler: (request: ProxyRequest) => Promise<ProxyResponse> | ProxyResponse,
): GitHubRequestProvider & { proxy: ReturnType<typeof mock.fn> } {
  const proxy = mock.fn(handler);

  return {
    name: 'mock-github',
    connectionId: 'conn-test',
    proxy,
  };
}

function createFileDescriptor(
  filename: string,
  overrides: Partial<PullRequestFileDescriptor> = {},
): PullRequestFileDescriptor {
  return {
    owner: mockRepoContext.owner,
    repo: mockRepoContext.repo,
    connectionId: 'conn-test',
    filename,
    status: 'modified',
    ...overrides,
  };
}

function decodeFixtureContent(source: Record<string, string>, path: string): string {
  return Buffer.from(source[path] ?? '', 'base64').toString('utf8');
}

describe('bulk ingest', () => {
  it('batchFetchFiles respects concurrency limit', async () => {
    const files = [
      createFileDescriptor('src/file-1.ts'),
      createFileDescriptor('src/file-2.ts'),
      createFileDescriptor('src/file-3.ts'),
      createFileDescriptor('src/file-4.ts'),
    ];
    let activeRequests = 0;
    let maxActiveRequests = 0;

    const provider = createProvider(async (request) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);

      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const path = decodeURIComponent(request.endpoint.split('/contents/')[1] ?? '');
        const ref = request.query?.ref ?? 'unknown-ref';
        return createContentResponse(path, ref, `${path}:${ref}`);
      } finally {
        activeRequests -= 1;
      }
    });

    const result = await batchFetchFiles(provider, files, 'head-sha', 'base-sha', {
      concurrency: 2,
      skipCached: false,
    });

    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.fetched.length, 8);
    assert.ok(maxActiveRequests <= 2);
    assert.strictEqual(maxActiveRequests, 2);
  });

  it('batchFetchFiles skips cached files', async () => {
    const provider = createProvider(async () => {
      throw new Error('provider.proxy should not be called for cached files');
    });
    const cache = {
      has: mock.fn(async () => true),
    };

    const result = await batchFetchFiles(
      provider,
      [createFileDescriptor('src/cached.ts')],
      'head-sha',
      'base-sha',
      {
        cache,
        skipCached: true,
      },
    );

    assert.strictEqual(cache.has.mock.calls.length, 2);
    assert.strictEqual(provider.proxy.mock.calls.length, 0);
    assert.deepStrictEqual(result.fetched, []);
    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.skipped, [
      `${mockRepoContext.owner}/${mockRepoContext.repo}:src/cached.ts@head-sha`,
      `${mockRepoContext.owner}/${mockRepoContext.repo}:src/cached.ts@base-sha`,
    ]);
  });

  it('batchFetchFiles handles fetch errors gracefully', async () => {
    const provider = createProvider(async (request) => {
      const path = decodeURIComponent(request.endpoint.split('/contents/')[1] ?? '');
      const ref = request.query?.ref ?? '';

      if (path === 'src/error.ts' && ref === 'head-sha') {
        throw new Error('network failed');
      }

      return createContentResponse(path, ref, `content:${path}:${ref}`);
    });

    const result = await batchFetchFiles(
      provider,
      [
        createFileDescriptor('src/ok.ts'),
        createFileDescriptor('src/error.ts'),
      ],
      'head-sha',
      'base-sha',
      {
        concurrency: 3,
        skipCached: false,
      },
    );

    assert.strictEqual(result.fetched.length, 3);
    assert.deepStrictEqual(result.errors, [
      {
        path: 'src/error.ts',
        ref: 'head-sha',
        variant: 'head',
        error: 'network failed',
      },
    ]);
  });

  it('checkRateLimit parses headers correctly', () => {
    const rateLimit = checkRateLimit({
      'X-RateLimit-Remaining': '42',
      'x-ratelimit-reset': '1893456789',
    });

    assert.deepStrictEqual(rateLimit, {
      remaining: 42,
      resetAt: new Date(1893456789 * 1000),
      shouldThrottle: true,
    });
  });

  it('throttleIfNeeded delays when near limit', async () => {
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };

    try {
      const start = Date.now();
      await throttleIfNeeded({
        remaining: 5,
        resetAt: new Date(Date.now() + 100),
        shouldThrottle: true,
      });
      const elapsed = Date.now() - start;

      assert.ok(elapsed >= 90);
      assert.strictEqual(warnCalls.length, 1);
      assert.ok(String(warnCalls[0]?.[0]).includes('GitHub rate limit is low (5 remaining)'));
    } finally {
      console.warn = originalWarn;
    }
  });

  it('bulkWriteToVFS writes head and base files', async () => {
    const { vfs, writes, writeFile } = createMemoryVfs();
    const files: FileContent[] = [
      {
        owner: mockRepoContext.owner,
        repo: mockRepoContext.repo,
        path: 'src/index.ts',
        ref: mockRepoContext.headSha,
        variant: 'head',
        content: 'head version',
        size: 12,
        encoding: 'utf-8',
        cacheKey: 'head-key',
      },
      {
        owner: mockRepoContext.owner,
        repo: mockRepoContext.repo,
        path: 'src/index.ts',
        ref: mockRepoContext.baseSha,
        variant: 'base',
        content: 'base version',
        size: 12,
        encoding: 'utf-8',
        cacheKey: 'base-key',
      },
    ];

    const result = await bulkWriteToVFS(
      files,
      vfs,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.strictEqual(writeFile.mock.calls.length, 2);
    assert.strictEqual(
      writes.get('/github/repos/octocat/hello-world/pulls/42/files/src/index.ts'),
      'head version',
    );
    assert.strictEqual(
      writes.get('/github/repos/octocat/hello-world/pulls/42/base/src/index.ts'),
      'base version',
    );
    assert.strictEqual(result.filesWritten, 2);
    assert.strictEqual(result.filesUpdated, 0);
    assert.strictEqual(result.filesSkipped, 0);
    assert.deepStrictEqual(result.errors, []);
  });

  it('bulkWriteToVFS tracks written vs updated counts', async () => {
    const existingPath = '/github/repos/octocat/hello-world/pulls/42/files/src/index.ts';
    const { vfs } = createMemoryVfs({
      [existingPath]: 'old content',
    });
    const files: FileContent[] = [
      {
        owner: mockRepoContext.owner,
        repo: mockRepoContext.repo,
        path: 'src/index.ts',
        ref: mockRepoContext.headSha,
        variant: 'head',
        content: 'updated content',
        size: 15,
        encoding: 'utf-8',
        cacheKey: 'update-key',
      },
      {
        owner: mockRepoContext.owner,
        repo: mockRepoContext.repo,
        path: 'src/new.ts',
        ref: mockRepoContext.headSha,
        variant: 'head',
        content: 'new content',
        size: 11,
        encoding: 'utf-8',
        cacheKey: 'new-key',
      },
      {
        owner: mockRepoContext.owner,
        repo: mockRepoContext.repo,
        path: 'src/new.ts',
        ref: mockRepoContext.headSha,
        variant: 'head',
        content: 'duplicate content',
        size: 17,
        encoding: 'utf-8',
        cacheKey: 'duplicate-key',
      },
    ];

    const result = await bulkWriteToVFS(
      files,
      vfs,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
    );

    assert.strictEqual(result.filesWritten, 1);
    assert.strictEqual(result.filesUpdated, 1);
    assert.strictEqual(result.filesSkipped, 1);
    assert.deepStrictEqual(result.errors, []);
  });

  it('bulkIngestPR orchestrates full flow', async () => {
    const { vfs, writes } = createMemoryVfs();
    const metadataCache = {
      set: mock.fn(async () => undefined),
    };

    const provider = createProvider(async (request) => {
      if (
        request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/files`
      ) {
        return jsonResponse(mockPRFiles as unknown as ProxyResponse['data']);
      }

      if (request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42`) {
        if (request.headers?.Accept === 'application/vnd.github.diff') {
          return {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            data: mockDiff,
          };
        }

        return jsonResponse(mockPRPayload as unknown as ProxyResponse['data']);
      }

      const prefix = `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/contents/`;
      if (request.endpoint.startsWith(prefix)) {
        const path = decodeURIComponent(request.endpoint.slice(prefix.length));
        const ref = request.query?.ref ?? mockRepoContext.headSha;
        const source = ref === mockRepoContext.baseSha ? mockBaseFileContents : mockFileContents;
        return jsonResponse({
          type: 'file',
          encoding: 'base64',
          path,
          sha: `${ref}:${path}`,
          size: Buffer.from(source[path] ?? '', 'base64').byteLength,
          content: source[path] ?? '',
        });
      }

      throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
    });

    const result = await bulkIngestPR(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
      vfs,
      {
        cache: {
          has: mock.fn(async () => false),
          set: mock.fn(async () => undefined),
        },
        metadataCache,
        skipCached: false,
        concurrency: 3,
      },
    );

    assert.strictEqual(result.filesWritten, 8);
    assert.strictEqual(result.filesUpdated, 0);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.paths.length, 8);
    assert.strictEqual(writes.get('/github/repos/octocat/hello-world/pulls/42/diff.patch'), mockDiff);
    const meta = JSON.parse(writes.get('/github/repos/octocat/hello-world/pulls/42/meta.json') ?? '{}');
    assert.strictEqual(meta.number, 42);
    assert.strictEqual(meta.title, mockPRPayload.title);
    assert.strictEqual(meta.head.sha, mockRepoContext.headSha);
    assert.strictEqual(meta.base.sha, mockRepoContext.baseSha);
    assert.strictEqual(
      writes.get('/github/repos/octocat/hello-world/pulls/42/files/src/index.ts'),
      decodeFixtureContent(mockFileContents, 'src/index.ts'),
    );
    assert.strictEqual(
      writes.get('/github/repos/octocat/hello-world/pulls/42/base/src/index.ts'),
      decodeFixtureContent(mockBaseFileContents, 'src/index.ts'),
    );
    assert.strictEqual(metadataCache.set.mock.calls.length, 4);
    assert.deepStrictEqual(metadataCache.set.mock.calls[0].arguments, [
      'pull-request:octocat/hello-world#42:meta',
      meta,
    ]);
    const summaryCall = metadataCache.set.mock.calls.find(
      ({ arguments: [cacheKey] }) => cacheKey === 'pull-request:octocat/hello-world#42:summary',
    );
    assert.ok(summaryCall);
    assert.deepStrictEqual(summaryCall.arguments, [
      'pull-request:octocat/hello-world#42:summary',
      {
        fetched: 6,
        skipped: 0,
        errors: 0,
      },
    ]);
    assert.strictEqual(provider.proxy.mock.calls.length, 9);
  });

  it('mergeIngestResults combines stats correctly', () => {
    const result = mergeIngestResults(
      {
        filesWritten: 2,
        filesUpdated: 1,
        filesDeleted: 0,
        paths: ['/meta.json'],
        errors: [{ path: '/meta.json', error: 'warn' }],
      },
      {
        filesWritten: 3,
        filesUpdated: 4,
        filesDeleted: 1,
        paths: ['/diff.patch', '/files/src/index.ts'],
        errors: [{ path: '/files/src/index.ts', error: 'skip' }],
      },
    );

    assert.deepStrictEqual(result, {
      filesWritten: 5,
      filesUpdated: 5,
      filesDeleted: 1,
      paths: ['/meta.json', '/diff.patch', '/files/src/index.ts'],
      errors: [
        { path: '/meta.json', error: 'warn' },
        { path: '/files/src/index.ts', error: 'skip' },
      ],
    });
  });

  it('Large PR (100+ files) handles without memory issues', async () => {
    const largeFiles = Array.from({ length: 120 }, (_, index) => ({
      filename: `src/generated/file-${index}.ts`,
      status: 'modified',
    }));
    const { vfs, writes } = createMemoryVfs();

    const provider = createProvider(async (request) => {
      if (
        request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42/files`
      ) {
        const page = Number(request.query?.page ?? '1');
        const start = (page - 1) * 100;
        const data = largeFiles.slice(start, start + 100);
        return jsonResponse(data as unknown as ProxyResponse['data']);
      }

      if (request.endpoint === `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/pulls/42`) {
        if (request.headers?.Accept === 'application/vnd.github.diff') {
          return {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            data: mockDiff,
          };
        }

        return jsonResponse(mockPRPayload as unknown as ProxyResponse['data']);
      }

      const prefix = `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/contents/`;
      if (request.endpoint.startsWith(prefix)) {
        const path = decodeURIComponent(request.endpoint.slice(prefix.length));
        const ref = request.query?.ref ?? mockRepoContext.headSha;
        return createContentResponse(path, ref, `export const value = '${path}:${ref}';\n`);
      }

      throw new Error(`Unexpected request: ${request.method} ${request.endpoint}`);
    });

    const result = await bulkIngestPR(
      provider,
      mockRepoContext.owner,
      mockRepoContext.repo,
      42,
      vfs,
      {
        concurrency: 8,
        skipCached: false,
      },
    );

    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.filesWritten, 242);
    assert.strictEqual(result.filesUpdated, 0);
    assert.strictEqual(result.paths.length, 242);
    assert.strictEqual(writes.size, 242);
    assert.strictEqual(provider.proxy.mock.calls.length, 244);
  });
});
