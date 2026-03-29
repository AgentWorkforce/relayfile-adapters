import { GITHUB_API_BASE_URL } from '../config.js';
import { Buffer } from 'node:buffer';

import type { GitHubProxyProvider, JsonObject, JsonValue, ProxyResponse } from '../types.js';

const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024;
const DEFAULT_PROVIDER_CONFIG_KEY = 'github-app-oauth';
const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json';
const GITHUB_API_VERSION = '2022-11-28';

type SkippedReason = 'binary' | 'not_found' | 'too_large';

export interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface FileContentFetchOptions {
  cache?: FileContentCache;
  connectionId?: string;
  headers?: Record<string, string>;
  maxFileSizeBytes?: number;
  providerConfigKey?: string;
}

export interface FileContentCache {
  get(key: string): Promise<FileContentResult | null | undefined> | FileContentResult | null | undefined;
  set(key: string, value: FileContentResult): Promise<void> | void;
}

export interface FileContentResult {
  content: string | null;
  encoding: string | null;
  etag?: string;
  isBinary: boolean;
  path: string;
  ref: string;
  sha: string | null;
  size: number;
  skippedReason?: SkippedReason;
}

export interface PullRequestFileDescriptor {
  filename?: string;
  path?: string;
  previous_filename?: string;
  previousFilename?: string;
  status?: string;
}

export interface HeadBaseFileResult {
  base: string | null;
  baseFile: FileContentResult | null;
  head: string | null;
  headFile: FileContentResult | null;
  path: string;
  prNumber: number;
}

export interface VfsLike {
  exists?(path: string): Promise<boolean> | boolean;
  get?(path: string): Promise<unknown> | unknown;
  has?(path: string): Promise<boolean> | boolean;
  put?(path: string, content: string): Promise<unknown> | unknown;
  read?(path: string): Promise<unknown> | unknown;
  readFile?(path: string): Promise<unknown> | unknown;
  set?(path: string, content: string): Promise<unknown> | unknown;
  stat?(path: string): Promise<unknown> | unknown;
  upsert?(path: string, content: string): Promise<unknown> | unknown;
  write?(path: string, content: string): Promise<unknown> | unknown;
  writeFile?(path: string, content: string): Promise<unknown> | unknown;
}

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
  path?: string;
  sha?: string;
  size?: number;
  type?: string;
}

interface ProviderDefaults {
  connectionId?: string;
  defaultConnectionId?: string;
  defaultProviderConfigKey?: string;
  providerConfigKey?: string;
}

export async function fetchFileContent(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  options: FileContentFetchOptions = {},
): Promise<FileContentResult> {
  const normalizedPath = normalizeRepoPath(path);
  const cacheKey = buildCacheKey(owner, repo, normalizedPath, ref);
  const cached = await readCache(options.cache, cacheKey);

  if (cached && looksImmutableRef(ref)) {
    return cached;
  }

  const connectionId = resolveConnectionId(provider, options);
  const providerConfigKey = resolveProviderConfigKey(provider, options);
  const headers: Record<string, string> = {
    Accept: GITHUB_ACCEPT_HEADER,
    'Provider-Config-Key': providerConfigKey,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...options.headers,
  };

  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  const response = await provider.proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePathForGitHub(normalizedPath)}?ref=${encodeURIComponent(ref)}`,
    connectionId,
    headers,
  });

  if (response.status === 304 && cached) {
    return cached;
  }

  if (response.status === 404) {
    const notFound = buildSkippedResult(normalizedPath, ref, 'not_found');
    await writeCache(options.cache, cacheKey, notFound);
    return notFound;
  }

  if (response.status >= 400) {
    throw new Error(formatProviderError(response, normalizedPath, ref));
  }

  const payload = parseContentPayload(response.data, normalizedPath);
  const size = typeof payload.size === 'number' ? payload.size : 0;
  const encoding = typeof payload.encoding === 'string' ? payload.encoding : null;
  const sha = typeof payload.sha === 'string' ? payload.sha : null;
  const etag = getHeader(response.headers, 'etag');
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;

  if (size > maxFileSizeBytes) {
    const tooLarge = buildSkippedResult(normalizedPath, ref, 'too_large', {
      encoding,
      etag,
      sha,
      size,
    });
    await writeCache(options.cache, cacheKey, tooLarge);
    return tooLarge;
  }

  if (encoding === 'none' || isBinaryContentType(getHeader(response.headers, 'content-type'))) {
    const binary = buildSkippedResult(normalizedPath, ref, 'binary', {
      encoding,
      etag,
      sha,
      size,
      isBinary: true,
    });
    await writeCache(options.cache, cacheKey, binary);
    return binary;
  }

  const decoded = decodePayloadContent(payload.content, encoding);
  if (decoded.isBinary) {
    const binary = buildSkippedResult(normalizedPath, ref, 'binary', {
      encoding,
      etag,
      sha,
      size,
      isBinary: true,
    });
    await writeCache(options.cache, cacheKey, binary);
    return binary;
  }

  const result: FileContentResult = {
    content: decoded.content,
    encoding,
    etag,
    isBinary: false,
    path: normalizedPath,
    ref,
    sha,
    size,
  };
  await writeCache(options.cache, cacheKey, result);
  return result;
}

export async function fetchHeadAndBase(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  prNumber: number,
  file: PullRequestFileDescriptor | string,
  headRef: string,
  baseRef: string,
  options: FileContentFetchOptions = {},
): Promise<HeadBaseFileResult> {
  const descriptor = normalizeFileDescriptor(file);
  const status = descriptor.status?.toLowerCase();
  const headPath = normalizeRepoPath(descriptor.path);
  const baseSourcePath =
    descriptor.previousPath && status === 'renamed' ? descriptor.previousPath : descriptor.path;

  const headFile =
    status === 'removed'
      ? null
      : await fetchFileContent(provider, owner, repo, headPath, headRef, options);
  const baseFile =
    status === 'added'
      ? null
      : await fetchFileContent(provider, owner, repo, baseSourcePath, baseRef, options);

  return {
    base: baseFile?.content ?? null,
    baseFile,
    head: headFile?.content ?? null,
    headFile,
    path: headPath,
    prNumber,
  };
}

export async function writeFileContents(
  files: HeadBaseFileResult[],
  vfs: VfsLike,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<IngestResult> {
  const result: IngestResult = {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
  };
  const rootPath = `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}`;

  for (const file of files) {
    const relativePath = normalizeRepoPath(file.path);

    await writeOneSide(
      vfs,
      `${rootPath}/files/${relativePath}`,
      file.headFile?.content ?? null,
      result,
    );
    await writeOneSide(
      vfs,
      `${rootPath}/base/${relativePath}`,
      file.baseFile?.content ?? null,
      result,
    );
  }

  return result;
}

function buildCacheKey(owner: string, repo: string, path: string, ref: string): string {
  return `${owner}/${repo}:${path}@${ref}`;
}

function buildSkippedResult(
  path: string,
  ref: string,
  skippedReason: SkippedReason,
  fields: Partial<FileContentResult> = {},
): FileContentResult {
  return {
    content: null,
    encoding: fields.encoding ?? null,
    etag: fields.etag,
    isBinary: fields.isBinary ?? skippedReason === 'binary',
    path,
    ref,
    sha: fields.sha ?? null,
    size: fields.size ?? 0,
    skippedReason,
  };
}

function decodePayloadContent(
  content: string | undefined,
  encoding: string | null,
): { content: string; isBinary: boolean } {
  if (!content) {
    return { content: '', isBinary: false };
  }

  const normalizedContent = content.replace(/\n/g, '');
  if (encoding === null || encoding === 'base64') {
    const buffer = Buffer.from(normalizedContent, 'base64');
    return {
      content: buffer.toString('utf8'),
      isBinary: bufferLooksBinary(buffer),
    };
  }

  const buffer = Buffer.from(content, 'utf8');
  return {
    content,
    isBinary: bufferLooksBinary(buffer),
  };
}

function encodePathForGitHub(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function formatProviderError(response: ProxyResponse, path: string, ref: string): string {
  const details = extractMessage(response.data);
  return `GitHub contents fetch failed for ${path}@${ref} with status ${response.status}${details ? `: ${details}` : ''}`;
}

function extractMessage(value: JsonValue | null): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const message = (value as JsonObject).message;
  return typeof message === 'string' && message.trim() ? message : null;
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

function isBinaryContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }

  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (!mime) {
    return false;
  }

  if (mime.startsWith('text/')) {
    return false;
  }

  return !TEXT_LIKE_MIME_TYPES.has(mime);
}

function bufferLooksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  let suspiciousBytes = 0;
  const sampleSize = Math.min(buffer.length, 8_000);
  for (let index = 0; index < sampleSize; index += 1) {
    const byte = buffer[index];
    if (byte === 0) {
      return true;
    }
    if ((byte < 7 || (byte > 13 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes / sampleSize > 0.3;
}

function looksImmutableRef(ref: string): boolean {
  return /^[0-9a-f]{40}$/i.test(ref);
}

function normalizeFileDescriptor(file: PullRequestFileDescriptor | string): {
  path: string;
  previousPath?: string;
  status?: string;
} {
  if (typeof file === 'string') {
    return { path: normalizeRepoPath(file) };
  }

  const path = file.filename ?? file.path;
  if (!path) {
    throw new Error('Pull request file descriptor is missing filename/path');
  }

  const previousPath = file.previous_filename ?? file.previousFilename;
  return {
    path: normalizeRepoPath(path),
    previousPath: previousPath ? normalizeRepoPath(previousPath) : undefined,
    status: file.status,
  };
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

function parseContentPayload(data: JsonValue | null, path: string): GitHubContentResponse {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Expected a GitHub file payload for ${path}`);
  }

  const payload = data as JsonObject;
  const type = payload.type;
  if (type !== undefined && type !== 'file') {
    throw new Error(`Expected file content payload for ${path}, received type "${String(type)}"`);
  }

  return payload as unknown as GitHubContentResponse;
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

async function readCache(
  cache: FileContentCache | undefined,
  key: string,
): Promise<FileContentResult | null> {
  if (!cache) {
    return null;
  }

  const value = await cache.get(key);
  return value ?? null;
}

function resolveConnectionId(
  provider: GitHubProxyProvider,
  options: FileContentFetchOptions,
): string {
  const defaults = provider as GitHubProxyProvider & ProviderDefaults;
  const connectionId =
    options.connectionId ?? defaults.connectionId ?? defaults.defaultConnectionId;

  if (!connectionId?.trim()) {
    throw new Error(
      'Missing GitHub connection id. Pass options.connectionId or provide provider.connectionId/defaultConnectionId.',
    );
  }

  return connectionId.trim();
}

function resolveProviderConfigKey(
  provider: GitHubProxyProvider,
  options: FileContentFetchOptions,
): string {
  const defaults = provider as GitHubProxyProvider & ProviderDefaults;
  return (
    options.providerConfigKey ??
    defaults.providerConfigKey ??
    defaults.defaultProviderConfigKey ??
    DEFAULT_PROVIDER_CONFIG_KEY
  );
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

async function writeCache(
  cache: FileContentCache | undefined,
  key: string,
  value: FileContentResult,
): Promise<void> {
  if (!cache) {
    return;
  }

  await cache.set(key, value);
}

async function writeOneSide(
  vfs: VfsLike,
  path: string,
  content: string | null,
  result: IngestResult,
): Promise<void> {
  if (content === null) {
    return;
  }

  try {
    const existed = await pathExists(vfs, path);
    await runVfsWrite(vfs, path, content);
    result.paths.push(path);

    if (existed) {
      result.filesUpdated += 1;
    } else {
      result.filesWritten += 1;
    }
  } catch (error) {
    result.errors.push({
      path,
      error: error instanceof Error ? error.message : 'Unknown VFS write failure',
    });
  }
}

const TEXT_LIKE_MIME_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/x-httpd-php',
  'application/x-javascript',
  'application/x-sh',
  'application/x-toml',
  'application/x-typescript',
  'application/x-yaml',
  'application/xml',
  'application/yaml',
  'image/svg+xml',
]);
