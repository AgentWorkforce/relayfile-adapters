import { Buffer } from 'node:buffer';

import type { GitHubProxyProvider, JsonObject, JsonValue, ProxyResponse } from '../types.js';

const CACHE_METADATA_PATH = '.cache/files.json';
const CACHE_CONTENT_ROOT = '.cache/files';
const CACHE_VERSION = 1;
const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json';
const GITHUB_API_VERSION = '2022-11-28';
const DEFAULT_PROVIDER_CONFIG_KEY = 'github-app-oauth';

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

export interface FileCacheEntry {
  owner: string;
  repo: string;
  path: string;
  contentPath: string;
  storedAt: string;
}

export interface FileCacheManifest {
  version: number;
  files: Record<string, FileCacheEntry>;
  refs: Record<string, string>;
}

export interface FetchWithCacheResult {
  cacheHit: boolean;
  content: string;
  sha: string;
}

interface GitHubContentPayload {
  content?: string;
  encoding?: string;
  sha?: string;
  type?: string;
}

interface ProviderDefaults {
  connectionId?: string;
  defaultConnectionId?: string;
  defaultProviderConfigKey?: string;
  providerConfigKey?: string;
}

export class FileContentCache {
  constructor(private readonly vfs: VfsLike) {}

  async has(owner: string, repo: string, path: string, sha: string): Promise<boolean> {
    const normalizedSha = normalizeSha(sha);
    const entry = await this.getEntry(normalizedSha);
    if (!entry) {
      return false;
    }

    const contentPath = entry.contentPath || buildContentPath(normalizedSha);
    const exists = await pathExists(this.vfs, contentPath);
    if (exists === false) {
      await this.pruneMissingEntry(normalizedSha);
      return false;
    }

    return true;
  }

  async get(owner: string, repo: string, path: string, sha: string): Promise<string | null> {
    const normalizedSha = normalizeSha(sha);
    const entry = await this.getEntry(normalizedSha);
    if (!entry) {
      return null;
    }

    const contentPath = entry.contentPath || buildContentPath(normalizedSha);
    const content = await readVfsText(this.vfs, contentPath);
    if (content === null) {
      await this.pruneMissingEntry(normalizedSha);
      return null;
    }

    const normalizedPath = normalizeRepoPath(path);
    if (
      entry.owner !== owner ||
      entry.repo !== repo ||
      entry.path !== normalizedPath
    ) {
      await this.upsertEntry(normalizedSha, {
        owner,
        repo,
        path: normalizedPath,
        contentPath,
        storedAt: new Date().toISOString(),
      });
    }

    return content;
  }

  async set(owner: string, repo: string, path: string, sha: string, content: string): Promise<void> {
    const normalizedSha = normalizeSha(sha);
    const normalizedPath = normalizeRepoPath(path);
    const contentPath = buildContentPath(normalizedSha);

    await writeVfsText(this.vfs, contentPath, content);
    await this.upsertEntry(normalizedSha, {
      owner,
      repo,
      path: normalizedPath,
      contentPath,
      storedAt: new Date().toISOString(),
    });
  }

  async getByRef(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<{ content: string; sha: string } | null> {
    const normalizedPath = normalizeRepoPath(path);
    const manifest = await this.readManifest();
    const sha = manifest.refs[buildRefKey(owner, repo, normalizedPath, ref)];
    if (!sha) {
      return null;
    }

    const content = await this.get(owner, repo, normalizedPath, sha);
    if (content === null) {
      delete manifest.refs[buildRefKey(owner, repo, normalizedPath, ref)];
      await this.writeManifest(manifest);
      return null;
    }

    return { content, sha };
  }

  async rememberRef(owner: string, repo: string, path: string, ref: string, sha: string): Promise<void> {
    const manifest = await this.readManifest();
    manifest.refs[buildRefKey(owner, repo, normalizeRepoPath(path), ref)] = normalizeSha(sha);
    await this.writeManifest(manifest);
  }

  private async getEntry(sha: string): Promise<FileCacheEntry | null> {
    const manifest = await this.readManifest();
    return manifest.files[sha] ?? null;
  }

  private async upsertEntry(sha: string, entry: FileCacheEntry): Promise<void> {
    const manifest = await this.readManifest();
    manifest.files[sha] = entry;
    await this.writeManifest(manifest);
  }

  private async pruneMissingEntry(sha: string): Promise<void> {
    const manifest = await this.readManifest();
    if (!manifest.files[sha]) {
      return;
    }

    delete manifest.files[sha];
    for (const [refKey, value] of Object.entries(manifest.refs)) {
      if (value === sha) {
        delete manifest.refs[refKey];
      }
    }
    await this.writeManifest(manifest);
  }

  private async readManifest(): Promise<FileCacheManifest> {
    const raw = await readVfsText(this.vfs, CACHE_METADATA_PATH);
    if (!raw) {
      return createEmptyManifest();
    }

    try {
      const parsed = JSON.parse(raw) as Partial<FileCacheManifest>;
      return {
        version: parsed.version === CACHE_VERSION ? parsed.version : CACHE_VERSION,
        files: isRecord(parsed.files) ? sanitizeFiles(parsed.files) : {},
        refs: isRecord(parsed.refs) ? sanitizeRefs(parsed.refs) : {},
      };
    } catch {
      return createEmptyManifest();
    }
  }

  private async writeManifest(manifest: FileCacheManifest): Promise<void> {
    await writeVfsText(this.vfs, CACHE_METADATA_PATH, JSON.stringify(manifest, null, 2));
  }
}

export async function fetchWithCache(
  cache: FileContentCache,
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<FetchWithCacheResult> {
  const normalizedPath = normalizeRepoPath(path);

  const cachedByRef = await cache.getByRef(owner, repo, normalizedPath, ref);
  if (cachedByRef) {
    return {
      cacheHit: true,
      content: cachedByRef.content,
      sha: cachedByRef.sha,
    };
  }

  if (looksLikeSha(ref)) {
    const cachedBySha = await cache.get(owner, repo, normalizedPath, ref);
    if (cachedBySha !== null) {
      return {
        cacheHit: true,
        content: cachedBySha,
        sha: normalizeSha(ref),
      };
    }
  }

  const fetched = await fetchFile(provider, owner, repo, normalizedPath, ref);
  await cache.set(owner, repo, normalizedPath, fetched.sha, fetched.content);
  await cache.rememberRef(owner, repo, normalizedPath, ref, fetched.sha);

  return {
    cacheHit: false,
    content: fetched.content,
    sha: fetched.sha,
  };
}

function buildContentPath(sha: string): string {
  return `${CACHE_CONTENT_ROOT}/${normalizeSha(sha)}`;
}

function buildRefKey(owner: string, repo: string, path: string, ref: string): string {
  return `${owner}/${repo}:${path}@${ref}`;
}

function createEmptyManifest(): FileCacheManifest {
  return {
    version: CACHE_VERSION,
    files: {},
    refs: {},
  };
}

async function fetchFile(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string }> {
  const response = await provider.proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePathForGitHub(path)}?ref=${encodeURIComponent(ref)}`,
    connectionId: resolveConnectionId(provider),
    headers: {
      Accept: GITHUB_ACCEPT_HEADER,
      'Provider-Config-Key': resolveProviderConfigKey(provider),
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
  });

  if (response.status >= 400) {
    throw new Error(formatProviderError(response, path, ref));
  }

  const payload = parseContentPayload(response.data, path);
  const sha = normalizeSha(payload.sha);
  const content = decodePayloadContent(payload.content, payload.encoding ?? null);

  return { content, sha };
}

function decodePayloadContent(content: string | undefined, encoding: string | null): string {
  if (!content) {
    return '';
  }

  if (encoding === null || encoding === 'base64') {
    return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8');
  }

  return content;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value.trim());
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

function normalizeSha(sha: string | undefined): string {
  const normalized = sha?.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Expected GitHub file payload to include sha');
  }
  return normalized;
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
  return undefined;
}

function parseContentPayload(data: JsonValue | null, path: string): GitHubContentPayload {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Expected a GitHub file payload for ${path}`);
  }

  const payload = data as JsonObject;
  const type = payload.type;
  if (type !== undefined && type !== 'file') {
    throw new Error(`Expected file content payload for ${path}, received type "${String(type)}"`);
  }

  return payload as unknown as GitHubContentPayload;
}

function resolveConnectionId(provider: GitHubProxyProvider): string {
  const defaults = provider as GitHubProxyProvider & ProviderDefaults;
  const connectionId = defaults.connectionId ?? defaults.defaultConnectionId;

  if (!connectionId?.trim()) {
    throw new Error(
      'Missing GitHub connection id. Provide provider.connectionId or provider.defaultConnectionId.',
    );
  }

  return connectionId.trim();
}

function resolveProviderConfigKey(provider: GitHubProxyProvider): string {
  const defaults = provider as GitHubProxyProvider & ProviderDefaults;
  return (
    defaults.providerConfigKey ??
    defaults.defaultProviderConfigKey ??
    DEFAULT_PROVIDER_CONFIG_KEY
  );
}

async function readVfsText(vfs: VfsLike, path: string): Promise<string | null> {
  const readers = [vfs.readFile, vfs.read, vfs.get];

  for (const reader of readers) {
    if (typeof reader !== 'function') {
      continue;
    }

    try {
      const value = await reader.call(vfs, path);
      const text = toText(value);
      if (text !== null) {
        return text;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function sanitizeFiles(entries: Record<string, unknown>): Record<string, FileCacheEntry> {
  const sanitized: Record<string, FileCacheEntry> = {};

  for (const [sha, value] of Object.entries(entries)) {
    if (!isRecord(value)) {
      continue;
    }

    const owner = typeof value.owner === 'string' ? value.owner : null;
    const repo = typeof value.repo === 'string' ? value.repo : null;
    const path = typeof value.path === 'string' ? value.path : null;
    const contentPath = typeof value.contentPath === 'string' ? value.contentPath : null;
    const storedAt = typeof value.storedAt === 'string' ? value.storedAt : new Date(0).toISOString();

    if (!owner || !repo || !path || !contentPath) {
      continue;
    }

    sanitized[normalizeSha(sha)] = {
      owner,
      repo,
      path,
      contentPath,
      storedAt,
    };
  }

  return sanitized;
}

function sanitizeRefs(entries: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== 'string' || !key.trim()) {
      continue;
    }
    sanitized[key] = normalizeSha(value);
  }

  return sanitized;
}

function toText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8');
  }
  return null;
}

async function writeVfsText(vfs: VfsLike, path: string, content: string): Promise<void> {
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
