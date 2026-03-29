import { Buffer } from 'node:buffer';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  mockBaseFileContents,
  mockDiff,
  mockFileContents,
  mockPRFiles,
  mockPRPayload,
  mockRepoContext,
} from '../../__tests__/fixtures/index.js';
import type { VfsLike } from '../../files/content-fetcher.js';
import type { GitHubProxyProvider, ProxyRequest, ProxyResponse } from '../../types.js';
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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
  const exists = vi.fn(async (path: string) => writes.has(path));
  const writeFile = vi.fn(async (path: string, content: string) => {
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
): GitHubProxyProvider & { proxy: ReturnType<typeof vi.fn> } {
  const proxy = vi.fn(handler);

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

    expect(result.errors).toEqual([]);
    expect(result.fetched).toHaveLength(8);
    expect(maxActiveRequests).toBeLessThanOrEqual(2);
    expect(maxActiveRequests).toBe(2);
  });

  it('batchFetchFiles skips cached files', async () => {
    const provider = createProvider(async () => {
      throw new Error('provider.proxy should not be called for cached files');
    });
    const cache = {
      has: vi.fn(async () => true),
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

    expect(cache.has).toHaveBeenCalledTimes(2);
    expect(provider.proxy).not.toHaveBeenCalled();
    expect(result.fetched).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([
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

    expect(result.fetched).toHaveLength(3);
    expect(result.errors).toEqual([
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

    expect(rateLimit).toEqual({
      remaining: 42,
      resetAt: new Date(1893456789 * 1000),
      shouldThrottle: true,
    });
  });

  it('throttleIfNeeded delays when near limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T12:00:00.000Z'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let finished = false;

    const promise = throttleIfNeeded({
      remaining: 5,
      resetAt: new Date(Date.now() + 1_500),
      shouldThrottle: true,
    }).then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(1_499);
    expect(finished).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(finished).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toContain('GitHub rate limit is low (5 remaining)');
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

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writes.get('/github/repos/octocat/hello-world/pulls/42/files/src/index.ts')).toBe(
      'head version',
    );
    expect(writes.get('/github/repos/octocat/hello-world/pulls/42/base/src/index.ts')).toBe(
      'base version',
    );
    expect(result).toMatchObject({
      filesWritten: 2,
      filesUpdated: 0,
      filesSkipped: 0,
      errors: [],
    });
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

    expect(result).toMatchObject({
      filesWritten: 1,
      filesUpdated: 1,
      filesSkipped: 1,
      errors: [],
    });
  });

  it('bulkIngestPR orchestrates full flow', async () => {
    const { vfs, writes } = createMemoryVfs();
    const metadataCache = {
      set: vi.fn(async () => undefined),
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
          has: vi.fn(async () => false),
          set: vi.fn(async () => undefined),
        },
        metadataCache,
        skipCached: false,
        concurrency: 3,
      },
    );

    expect(result.filesWritten).toBe(8);
    expect(result.filesUpdated).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.paths).toHaveLength(8);
    expect(writes.get('/github/repos/octocat/hello-world/pulls/42/diff.patch')).toBe(mockDiff);
    expect(
      JSON.parse(writes.get('/github/repos/octocat/hello-world/pulls/42/meta.json') ?? '{}'),
    ).toMatchObject({
      number: 42,
      title: mockPRPayload.title,
      head: { sha: mockRepoContext.headSha },
      base: { sha: mockRepoContext.baseSha },
    });
    expect(writes.get('/github/repos/octocat/hello-world/pulls/42/files/src/index.ts')).toBe(
      decodeFixtureContent(mockFileContents, 'src/index.ts'),
    );
    expect(writes.get('/github/repos/octocat/hello-world/pulls/42/base/src/index.ts')).toBe(
      decodeFixtureContent(mockBaseFileContents, 'src/index.ts'),
    );
    expect(metadataCache.set).toHaveBeenCalledTimes(4);
    expect(metadataCache.set).toHaveBeenCalledWith(
      'pull-request:octocat/hello-world#42:summary',
      {
        fetched: 6,
        skipped: 0,
        errors: 0,
      },
    );
    expect(provider.proxy).toHaveBeenCalledTimes(9);
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

    expect(result).toEqual({
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

    expect(result.errors).toEqual([]);
    expect(result.filesWritten).toBe(242);
    expect(result.filesUpdated).toBe(0);
    expect(result.paths).toHaveLength(242);
    expect(writes.size).toBe(242);
    expect(provider.proxy).toHaveBeenCalledTimes(244);
  });
});
