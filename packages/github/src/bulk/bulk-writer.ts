import { GITHUB_API_BASE_URL } from '../config.js';
import type { IngestResult, VfsLike } from '../files/content-fetcher.ts';
import { type BatchFetchCache, batchFetchFiles, type BatchOptions, type FileContent } from './batch-fetcher.ts';
import type { ParsePullRequestOptions, PullRequestMetadata } from '../pr/parser.ts';
import type { GitHubProxyProvider, JsonObject, JsonValue, ProxyResponse } from '../types.ts';

const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_PAGE_SIZE = 100;

type JsonRecord = Record<string, unknown>;

interface ConnectionAwareProvider extends GitHubProxyProvider {
  connectionId?: string;
  defaultConnectionId?: string;
  providerConfigKey?: string;
  defaultProviderConfigKey?: string;
  resolveConnectionId?: () => Promise<string> | string;
  getConnectionId?: () => Promise<string> | string;
}

interface PullRequestFileDescriptor {
  owner: string;
  repo: string;
  connectionId: string;
  filename: string;
  status?: string;
  previousFilename?: string;
  previous_filename?: string;
}

interface BulkMetadataCache {
  set(key: string, value: unknown): Promise<void> | void;
}

interface BulkWriteResultInternal extends BulkWriteResult {
  paths: string[];
}

export interface BulkWriteResult {
  filesWritten: number;
  filesUpdated: number;
  filesSkipped: number;
  errors: Array<{ path: string; error: string }>;
  duration: number;
}

export interface BulkIngestOptions
  extends Partial<BatchOptions>,
    ParsePullRequestOptions {
  cache?: BatchFetchCache;
  metadataCache?: BulkMetadataCache;
}

export async function bulkWriteToVFS(
  files: FileContent[],
  vfs: VfsLike,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<BulkWriteResult> {
  const startedAt = Date.now();
  const basePath = buildPullRequestRoot(owner, repo, prNumber);
  const result: BulkWriteResultInternal = {
    filesWritten: 0,
    filesUpdated: 0,
    filesSkipped: 0,
    errors: [],
    duration: 0,
    paths: [],
  };
  const seenPaths = new Set<string>();

  for (const file of files) {
    const relativePath = normalizeRepoPath(file.path);
    const targetPath =
      file.variant === 'base'
        ? `${basePath}/base/${relativePath}`
        : `${basePath}/files/${relativePath}`;

    if (seenPaths.has(targetPath)) {
      result.filesSkipped += 1;
      continue;
    }

    seenPaths.add(targetPath);

    try {
      const existed = await pathExists(vfs, targetPath);
      await runVfsWrite(vfs, targetPath, file.content);
      result.paths.push(targetPath);

      if (existed) {
        result.filesUpdated += 1;
      } else {
        result.filesWritten += 1;
      }
    } catch (error) {
      result.errors.push({
        path: targetPath,
        error: formatError(error),
      });
    }
  }

  result.duration = Date.now() - startedAt;
  return result;
}

export async function bulkIngestPR(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  vfs: VfsLike,
  options: BulkIngestOptions = {},
): Promise<IngestResult> {
  const trimmedOwner = requireNonEmpty(owner, 'owner');
  const trimmedRepo = requireNonEmpty(repo, 'repo');
  const prNumber = requirePositiveInteger(number, 'number');
  const connectionId = await resolveConnectionId(provider, options.connectionId);

  const [metadata, files] = await Promise.all([
    fetchPullRequestMetadata(provider, trimmedOwner, trimmedRepo, prNumber, connectionId, options.headers),
    fetchPullRequestFiles(provider, trimmedOwner, trimmedRepo, prNumber, connectionId, options.headers),
  ]);

  const batchResult = await batchFetchFiles(
    provider,
    files,
    metadata.head.sha,
    metadata.base.sha,
    {
      cache: options.cache,
      concurrency: options.concurrency,
      maxFileSize: options.maxFileSize,
      skipCached: options.skipCached,
    },
  );

  const diff = await fetchPullRequestDiff(
    provider,
    trimmedOwner,
    trimmedRepo,
    prNumber,
    connectionId,
    options.headers,
  );

  const [metaWrite, diffWrite, bulkWrite] = await Promise.all([
    writeJsonFile(
      vfs,
      `${buildPullRequestRoot(trimmedOwner, trimmedRepo, prNumber)}/meta.json`,
      metadata,
    ),
    writeTextFile(
      vfs,
      `${buildPullRequestRoot(trimmedOwner, trimmedRepo, prNumber)}/diff.patch`,
      diff,
    ),
    bulkWriteToVFS(batchResult.fetched, vfs, trimmedOwner, trimmedRepo, prNumber),
  ]);

  await updateMetadataCache(options.metadataCache, {
    files,
    metadata,
    diff,
    owner: trimmedOwner,
    repo: trimmedRepo,
    prNumber,
    batchResult,
  });

  const aggregated = mergeIngestResults(
    metaWrite,
    diffWrite,
    toIngestResult(bulkWrite),
  );

  for (const error of batchResult.errors) {
    aggregated.errors.push({
      path: buildContentPath(trimmedOwner, trimmedRepo, prNumber, error.variant, error.path),
      error: error.error,
    });
  }

  return aggregated;
}

export function mergeIngestResults(...results: IngestResult[]): IngestResult {
  return results.reduce<IngestResult>(
    (combined, result) => {
      combined.filesWritten += result.filesWritten;
      combined.filesUpdated += result.filesUpdated;
      combined.filesDeleted += result.filesDeleted;
      combined.paths.push(...result.paths);
      combined.errors.push(...result.errors);
      return combined;
    },
    createEmptyIngestResult(),
  );
}

async function fetchPullRequestFiles(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  connectionId: string,
  headers?: Record<string, string>,
): Promise<PullRequestFileDescriptor[]> {
  const files: PullRequestFileDescriptor[] = [];
  let page = 1;

  while (true) {
    const response = await provider.proxy({
      method: 'GET',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files`,
      connectionId,
      headers: buildJsonHeaders(provider, headers),
      query: {
        page: String(page),
        per_page: String(GITHUB_PAGE_SIZE),
      },
    });

    assertSuccessfulResponse(
      response,
      `Failed to fetch pull request files for ${owner}/${repo}#${number}`,
    );

    const pageFiles = parsePullRequestFilesResponse(response.data, owner, repo, connectionId);
    files.push(...pageFiles);

    if (!hasNextPage(response.headers) && pageFiles.length < GITHUB_PAGE_SIZE) {
      break;
    }

    if (!hasNextPage(response.headers) && pageFiles.length === 0) {
      break;
    }

    page += 1;
  }

  return files;
}

async function fetchPullRequestMetadata(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  connectionId: string,
  headers?: Record<string, string>,
): Promise<PullRequestMetadata> {
  const response = await provider.proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`,
    connectionId,
    headers: buildJsonHeaders(provider, headers),
  });

  assertSuccessfulResponse(
    response,
    `Failed to fetch pull request metadata for ${owner}/${repo}#${number}`,
  );

  return toPullRequestMetadata(response.data, number);
}

async function fetchPullRequestDiff(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  connectionId: string,
  headers?: Record<string, string>,
): Promise<string> {
  const response = await provider.proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`,
    connectionId,
    headers: {
      ...buildProviderHeaders(provider),
      Accept: 'application/vnd.github.diff',
      ...headers,
    },
  });

  assertSuccessfulResponse(
    response,
    `Failed to fetch pull request diff for ${owner}/${repo}#${number}`,
  );

  if (typeof response.data === 'string') {
    return response.data;
  }

  throw new Error(`GitHub pull request diff response must be a string for ${owner}/${repo}#${number}`);
}

function parsePullRequestFilesResponse(
  value: JsonValue | null,
  owner: string,
  repo: string,
  connectionId: string,
): PullRequestFileDescriptor[] {
  if (!Array.isArray(value)) {
    throw new Error('GitHub pull request files response must be an array');
  }

  return value.map((entry, index) => parsePullRequestFile(entry, index, owner, repo, connectionId));
}

function parsePullRequestFile(
  value: JsonValue,
  index: number,
  owner: string,
  repo: string,
  connectionId: string,
): PullRequestFileDescriptor {
  const file = expectObject(value, `GitHub pull request files response[${index}]`);
  const filename = readRequiredString(file, 'filename', `GitHub pull request files response[${index}]`);
  const status = readOptionalString(file, 'status');
  const previousFilename = readOptionalString(file, 'previous_filename');

  return {
    owner,
    repo,
    connectionId,
    filename,
    status,
    previousFilename,
    previous_filename: previousFilename,
  };
}

function toPullRequestMetadata(value: JsonValue | null, fallbackNumber: number): PullRequestMetadata {
  const pullRequest = expectObject(value, 'GitHub pull request response');
  const head = expectObject(pullRequest.head, 'GitHub pull request response.head');
  const base = expectObject(pullRequest.base, 'GitHub pull request response.base');

  return {
    author: readAuthor(pullRequest.user),
    base: readPullRequestRef(base, 'GitHub pull request response.base'),
    body: readNullableString(pullRequest, 'body'),
    closedAt: readNullableString(pullRequest, 'closed_at'),
    createdAt: readString(pullRequest, 'created_at') ?? '',
    diffUrl: readNullableString(pullRequest, 'diff_url'),
    draft: readBoolean(pullRequest, 'draft') ?? false,
    head: readPullRequestRef(head, 'GitHub pull request response.head'),
    htmlUrl: readNullableString(pullRequest, 'html_url'),
    labels: readLabels(pullRequest.labels),
    merged: readBoolean(pullRequest, 'merged') ?? false,
    mergedAt: readNullableString(pullRequest, 'merged_at'),
    number: readNumber(pullRequest, 'number') ?? fallbackNumber,
    patchUrl: readNullableString(pullRequest, 'patch_url'),
    state: readString(pullRequest, 'state') ?? 'open',
    title: readString(pullRequest, 'title') ?? '',
    updatedAt: readString(pullRequest, 'updated_at') ?? '',
  };
}

function buildJsonHeaders(
  provider: GitHubProxyProvider,
  headers?: Record<string, string>,
): Record<string, string> {
  return {
    ...buildProviderHeaders(provider),
    Accept: 'application/vnd.github+json',
    ...headers,
  };
}

function buildProviderHeaders(provider: GitHubProxyProvider): Record<string, string> {
  const connectionAwareProvider = provider as ConnectionAwareProvider;
  const providerConfigKey =
    connectionAwareProvider.providerConfigKey?.trim() ??
    connectionAwareProvider.defaultProviderConfigKey?.trim();

  return {
    ...(providerConfigKey ? { 'Provider-Config-Key': providerConfigKey } : {}),
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

function readPullRequestRef(value: JsonObject, context: string): PullRequestMetadata['head'] {
  return {
    label: readString(value, 'label') ?? '',
    ref: readString(value, 'ref') ?? '',
    sha: readRequiredString(value, 'sha', context),
    repo: readRepository(value.repo),
  };
}

function readRepository(value: JsonValue | undefined): PullRequestMetadata['head']['repo'] {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }

  const repository = value as JsonObject;
  const id = readNumber(repository, 'id');
  const name = readString(repository, 'name');
  const fullName = readString(repository, 'full_name');
  const htmlUrl = readString(repository, 'html_url');
  const isPrivate = readBoolean(repository, 'private');

  if (id === undefined || name === undefined || fullName === undefined || htmlUrl === undefined) {
    return null;
  }

  return {
    id,
    name,
    fullName,
    htmlUrl,
    private: isPrivate ?? false,
  };
}

function readAuthor(value: JsonValue | undefined): PullRequestMetadata['author'] {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }

  const author = value as JsonObject;
  const id = readNumber(author, 'id');
  const login = readString(author, 'login');
  if (id === undefined || login === undefined) {
    return null;
  }

  return {
    id,
    login,
    type: readString(author, 'type') ?? 'User',
    avatarUrl: readNullableString(author, 'avatar_url'),
    htmlUrl: readNullableString(author, 'html_url'),
  };
}

function readLabels(value: JsonValue | undefined): PullRequestMetadata['labels'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') {
      return [];
    }

    const label = entry as JsonObject;
    const id = readNumber(label, 'id');
    const name = readString(label, 'name');
    const color = readString(label, 'color');

    if (id === undefined || name === undefined || color === undefined) {
      return [];
    }

    return [{
      id,
      name,
      color,
      default: readBoolean(label, 'default') ?? false,
      description: readNullableString(label, 'description'),
    }];
  });
}

function buildPullRequestRoot(owner: string, repo: string, prNumber: number): string {
  return `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}`;
}

function buildContentPath(
  owner: string,
  repo: string,
  prNumber: number,
  variant: 'base' | 'head',
  path: string,
): string {
  const relativePath = normalizeRepoPath(path);
  const basePath = buildPullRequestRoot(owner, repo, prNumber);
  return variant === 'base'
    ? `${basePath}/base/${relativePath}`
    : `${basePath}/files/${relativePath}`;
}

function createEmptyIngestResult(): IngestResult {
  return {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
  };
}

function toIngestResult(writeResult: BulkWriteResult): IngestResult {
  const paths = 'paths' in writeResult && Array.isArray(writeResult.paths) ? writeResult.paths : [];
  return {
    filesWritten: writeResult.filesWritten,
    filesUpdated: writeResult.filesUpdated,
    filesDeleted: 0,
    paths: [...paths],
    errors: [...writeResult.errors],
  };
}

async function writeJsonFile(
  vfs: VfsLike,
  path: string,
  value: JsonRecord | PullRequestMetadata,
): Promise<IngestResult> {
  return writeTextFile(vfs, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextFile(
  vfs: VfsLike,
  path: string,
  content: string,
): Promise<IngestResult> {
  try {
    const existed = await pathExists(vfs, path);
    await runVfsWrite(vfs, path, content);

    return {
      filesWritten: existed ? 0 : 1,
      filesUpdated: existed ? 1 : 0,
      filesDeleted: 0,
      paths: [path],
      errors: [],
    };
  } catch (error) {
    return {
      filesWritten: 0,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [],
      errors: [{ path, error: formatError(error) }],
    };
  }
}

async function updateMetadataCache(
  cache: BulkMetadataCache | undefined,
  value: {
    batchResult: { fetched: FileContent[]; skipped: string[]; errors: Array<{ path: string; error: string }> };
    diff: string;
    files: PullRequestFileDescriptor[];
    metadata: PullRequestMetadata;
    owner: string;
    prNumber: number;
    repo: string;
  },
): Promise<void> {
  if (!cache) {
    return;
  }

  const prefix = `pull-request:${value.owner}/${value.repo}#${value.prNumber}`;
  await cache.set(`${prefix}:meta`, value.metadata);
  await cache.set(`${prefix}:files`, value.files);
  await cache.set(`${prefix}:diff`, value.diff);
  await cache.set(`${prefix}:summary`, {
    fetched: value.batchResult.fetched.length,
    skipped: value.batchResult.skipped.length,
    errors: value.batchResult.errors.length,
  });
}

async function resolveConnectionId(
  provider: GitHubProxyProvider,
  connectionId?: string,
): Promise<string> {
  if (connectionId?.trim()) {
    return connectionId.trim();
  }

  const connectionAwareProvider = provider as ConnectionAwareProvider;
  const directConnectionId =
    connectionAwareProvider.connectionId?.trim() ??
    connectionAwareProvider.defaultConnectionId?.trim();

  if (directConnectionId) {
    return directConnectionId;
  }

  const resolver =
    connectionAwareProvider.resolveConnectionId ??
    connectionAwareProvider.getConnectionId;

  if (resolver) {
    const resolvedConnectionId = (await resolver.call(connectionAwareProvider)).trim();
    if (resolvedConnectionId) {
      return resolvedConnectionId;
    }
  }

  throw new Error(
    'Missing GitHub connection id. Pass options.connectionId or provide provider.connectionId/defaultConnectionId/resolveConnectionId()/getConnectionId().',
  );
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return trimmed;
}

function requirePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return value;
}

function assertSuccessfulResponse(response: ProxyResponse, context: string): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  const detail = extractErrorMessage(response.data);
  throw new Error(detail ? `${context}: ${detail}` : `${context}: HTTP ${response.status}`);
}

function extractErrorMessage(value: JsonValue | null): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const message = (value as JsonObject).message;
  return typeof message === 'string' && message.trim() ? message : undefined;
}

function hasNextPage(headers: Record<string, string>): boolean {
  const link = getHeader(headers, 'link');
  return typeof link === 'string' && link.includes('rel="next"');
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }

  return undefined;
}

function expectObject(value: JsonValue, context: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }

  return value;
}

function readRequiredString(source: JsonObject, key: string, context: string): string {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }

  return value;
}

function readOptionalString(source: JsonObject, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function readString(source: JsonObject, key: string): string | undefined {
  return readOptionalString(source, key);
}

function readNullableString(source: JsonObject, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function readBoolean(source: JsonObject, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(source: JsonObject, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' ? value : undefined;
}

function normalizeRepoPath(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/');
  const normalized: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      throw new Error(`Path traversal is not allowed: ${path}`);
    }

    normalized.push(segment);
  }

  const resolved = normalized.join('/');
  if (!resolved) {
    throw new Error(`Expected a repository-relative path, received "${path}"`);
  }

  return resolved;
}

async function pathExists(vfs: VfsLike, path: string): Promise<boolean | undefined> {
  if (typeof vfs.exists === 'function') {
    return Boolean(await vfs.exists(path));
  }

  if (typeof vfs.has === 'function') {
    return Boolean(await vfs.has(path));
  }

  if (typeof vfs.stat === 'function') {
    try {
      const value = await vfs.stat(path);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  }

  if (typeof vfs.readFile === 'function') {
    try {
      const value = await vfs.readFile(path);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  }

  if (typeof vfs.read === 'function') {
    try {
      const value = await vfs.read(path);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  }

  if (typeof vfs.get === 'function') {
    try {
      const value = await vfs.get(path);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  }

  return undefined;
}

async function runVfsWrite(vfs: VfsLike, path: string, content: string): Promise<void> {
  const writer =
    vfs.writeFile ??
    vfs.write ??
    vfs.put ??
    vfs.set ??
    vfs.upsert;

  if (!writer) {
    throw new Error(
      'VFS object must expose one of writeFile(path, content), write(path, content), put(path, content), set(path, content), or upsert(path, content).',
    );
  }

  await writer.call(vfs, path, content);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
