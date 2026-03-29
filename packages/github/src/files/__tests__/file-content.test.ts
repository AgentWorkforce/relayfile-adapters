import { Buffer } from 'node:buffer';

import { expect, test, vi } from 'vitest';

import {
  fetchFileContent,
  fetchHeadAndBase,
  writeFileContents,
  type HeadBaseFileResult,
} from '../content-fetcher.js';
import { FileContentCache, fetchWithCache } from '../cache.js';
import { mockBaseFileContents, mockFileContents, mockRepoContext } from '../../__tests__/fixtures/index.js';
import type { GitHubProxyProvider, ProxyRequest, ProxyResponse } from '../../types.js';

const GITHUB_API_BASE_URL = 'https://api.github.com';

class MemoryVfs {
  readonly files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async readFile(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return value;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

function buildContentsEndpoint(path: string, ref: string): string {
  return `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/contents/${path}?ref=${ref}`;
}

function decodeFixture(content: string): string {
  return Buffer.from(content, 'base64').toString('utf8');
}

function createFixtureProvider(
  overrides: Record<string, ProxyResponse> = {},
): GitHubProxyProvider & {
  connectionId: string;
  providerConfigKey: string;
  proxy: ReturnType<typeof vi.fn>;
} {
  const proxy = vi.fn(async (request: ProxyRequest): Promise<ProxyResponse> => {
    const override = overrides[request.endpoint];
    if (override) {
      return override;
    }

    if (request.baseUrl !== GITHUB_API_BASE_URL) {
      throw new Error(`Unsupported base URL: ${request.baseUrl}`);
    }

    const prefix = `/repos/${mockRepoContext.owner}/${mockRepoContext.repo}/contents/`;
    if (!request.endpoint.startsWith(prefix)) {
      throw new Error(`No fixture for ${request.method} ${request.endpoint}`);
    }

    const [rawPath, rawQuery = ''] = request.endpoint.slice(prefix.length).split('?');
    const params = new URLSearchParams(rawQuery);
    const path = decodeURIComponent(rawPath);
    const ref = request.query?.ref ?? params.get('ref') ?? mockRepoContext.headSha;
    const contentMap = ref === mockRepoContext.baseSha ? mockBaseFileContents : mockFileContents;
    const content = contentMap[path];

    if (!content) {
      return {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        data: { message: 'Not Found' },
      };
    }

    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      data: {
        type: 'file',
        encoding: 'base64',
        path,
        size: Buffer.from(content, 'base64').length,
        sha: ref === mockRepoContext.baseSha ? `${path}-base` : `${path}-head`,
        content,
      },
    };
  });

  return {
    name: 'fixture-provider',
    connectionId: 'conn-test',
    providerConfigKey: 'github-app-oauth',
    proxy,
  };
}

test('fetchFileContent decodes base64 content', async () => {
  const provider = createFixtureProvider();

  const result = await fetchFileContent(
    provider,
    mockRepoContext.owner,
    mockRepoContext.repo,
    'src/index.ts',
    mockRepoContext.headSha,
  );

  expect(result.content).toBe(decodeFixture(mockFileContents['src/index.ts']));
  expect(result.encoding).toBe('base64');
  expect(result.isBinary).toBe(false);
  expect(provider.proxy).toHaveBeenCalledTimes(1);
});

test('fetchFileContent skips binary files', async () => {
  const binaryPath = 'assets/logo.bin';
  const provider = createFixtureProvider({
    [buildContentsEndpoint(binaryPath, mockRepoContext.headSha)]: {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
      data: {
        type: 'file',
        encoding: 'base64',
        path: binaryPath,
        size: 4,
        sha: 'binary-sha',
        content: Buffer.from([0, 159, 146, 150]).toString('base64'),
      },
    },
  });

  const result = await fetchFileContent(
    provider,
    mockRepoContext.owner,
    mockRepoContext.repo,
    binaryPath,
    mockRepoContext.headSha,
  );

  expect(result.content).toBeNull();
  expect(result.isBinary).toBe(true);
  expect(result.skippedReason).toBe('binary');
});

test('fetchFileContent respects size limit', async () => {
  const largePath = 'docs/large.md';
  const provider = createFixtureProvider({
    [buildContentsEndpoint(largePath, mockRepoContext.headSha)]: {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      data: {
        type: 'file',
        encoding: 'base64',
        path: largePath,
        size: 128,
        sha: 'large-sha',
        content: Buffer.from('small body', 'utf8').toString('base64'),
      },
    },
  });

  const result = await fetchFileContent(
    provider,
    mockRepoContext.owner,
    mockRepoContext.repo,
    largePath,
    mockRepoContext.headSha,
    { maxFileSizeBytes: 32 },
  );

  expect(result.content).toBeNull();
  expect(result.isBinary).toBe(false);
  expect(result.skippedReason).toBe('too_large');
  expect(result.size).toBe(128);
});

test('fetchHeadAndBase fetches both versions', async () => {
  const provider = createFixtureProvider();

  const result = await fetchHeadAndBase(
    provider,
    mockRepoContext.owner,
    mockRepoContext.repo,
    42,
    'src/index.ts',
    mockRepoContext.headSha,
    mockRepoContext.baseSha,
  );

  expect(result.head).toBe(decodeFixture(mockFileContents['src/index.ts']));
  expect(result.base).toBe(decodeFixture(mockBaseFileContents['src/index.ts']));
  expect(result.path).toBe('src/index.ts');
  expect(provider.proxy).toHaveBeenCalledTimes(2);
});

test('FileContentCache.has returns false on miss', async () => {
  const cache = new FileContentCache(new MemoryVfs());

  await expect(
    cache.has(
      mockRepoContext.owner,
      mockRepoContext.repo,
      'src/index.ts',
      mockRepoContext.headSha,
    ),
  ).resolves.toBe(false);
});

test('FileContentCache.set then has returns true', async () => {
  const vfs = new MemoryVfs();
  const cache = new FileContentCache(vfs);

  await cache.set(
    mockRepoContext.owner,
    mockRepoContext.repo,
    'src/index.ts',
    mockRepoContext.headSha,
    'cached hello',
  );

  await expect(
    cache.has(
      mockRepoContext.owner,
      mockRepoContext.repo,
      'src/index.ts',
      mockRepoContext.headSha,
    ),
  ).resolves.toBe(true);
  await expect(vfs.readFile('.cache/files.json')).resolves.toContain('src/index.ts');
});

test('fetchWithCache returns cached content on hit', async () => {
  const cache = new FileContentCache(new MemoryVfs());
  const provider = createFixtureProvider();
  const cachedContent = 'cached fixture content';

  await cache.set(
    mockRepoContext.owner,
    mockRepoContext.repo,
    'src/index.ts',
    mockRepoContext.headSha,
    cachedContent,
  );
  await cache.rememberRef(
    mockRepoContext.owner,
    mockRepoContext.repo,
    'src/index.ts',
    'feature/fixture-e2e',
    mockRepoContext.headSha,
  );

  const result = await fetchWithCache(
    cache,
    provider,
    mockRepoContext.owner,
    mockRepoContext.repo,
    'src/index.ts',
    'feature/fixture-e2e',
  );

  expect(result).toEqual({
    cacheHit: true,
    content: cachedContent,
    sha: mockRepoContext.headSha,
  });
  expect(provider.proxy).not.toHaveBeenCalled();
});

test('fetchWithCache calls provider on miss', async () => {
  const cache = new FileContentCache(new MemoryVfs());
  const provider = createFixtureProvider();

  const result = await fetchWithCache(
    cache,
    provider,
    mockRepoContext.owner,
    mockRepoContext.repo,
    'src/index.ts',
    'feature/fixture-e2e',
  );

  expect(result.cacheHit).toBe(false);
  expect(result.content).toBe(decodeFixture(mockFileContents['src/index.ts']));
  expect(result.sha).toBe('src/index.ts-head');
  expect(provider.proxy).toHaveBeenCalledTimes(1);
});

test('writeFileContents writes to correct VFS paths', async () => {
  const vfs = new MemoryVfs();
  const files: HeadBaseFileResult[] = [
    {
      prNumber: 42,
      path: 'src/index.ts',
      head: 'head text',
      base: 'base text',
      headFile: {
        content: 'head text',
        encoding: 'base64',
        isBinary: false,
        path: 'src/index.ts',
        ref: mockRepoContext.headSha,
        sha: 'head-sha',
        size: 9,
      },
      baseFile: {
        content: 'base text',
        encoding: 'base64',
        isBinary: false,
        path: 'src/index.ts',
        ref: mockRepoContext.baseSha,
        sha: 'base-sha',
        size: 9,
      },
    },
  ];

  const result = await writeFileContents(
    files,
    vfs,
    mockRepoContext.owner,
    mockRepoContext.repo,
    42,
  );

  expect(await vfs.readFile('/github/repos/octocat/hello-world/pulls/42/files/src/index.ts')).toBe(
    'head text',
  );
  expect(await vfs.readFile('/github/repos/octocat/hello-world/pulls/42/base/src/index.ts')).toBe(
    'base text',
  );
  expect(result.filesWritten).toBe(2);
  expect(result.paths).toEqual([
    '/github/repos/octocat/hello-world/pulls/42/files/src/index.ts',
    '/github/repos/octocat/hello-world/pulls/42/base/src/index.ts',
  ]);
});
