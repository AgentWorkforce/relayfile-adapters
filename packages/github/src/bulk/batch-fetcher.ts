import { GITHUB_API_BASE_URL } from '../config.js';
import type { GitHubProxyProvider, JsonObject, JsonValue } from '../types.js';

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_MAX_FILE_SIZE = 1_000_000;
const RATE_LIMIT_THRESHOLD = 100;

type FileVariant = 'base' | 'head';

export interface BatchOptions {
  concurrency: number;
  maxFileSize: number;
  skipCached: boolean;
  cache?: BatchFetchCache;
}

export interface BatchFetchCache {
  has(key: string): boolean | Promise<boolean>;
  set?(key: string, value: FileContent): void | Promise<void>;
}

export interface PullRequestFileDescriptor {
  owner: string;
  repo: string;
  connectionId: string;
  filename: string;
  status?: string;
  previousFilename?: string;
  previous_filename?: string;
}

export interface FileContent {
  owner: string;
  repo: string;
  path: string;
  ref: string;
  variant: FileVariant;
  content: string;
  size: number;
  sha?: string;
  encoding: string;
  cacheKey: string;
}

export interface FetchError {
  path: string;
  ref: string;
  variant: FileVariant;
  error: string;
  status?: number;
}

export interface BatchFetchResult {
  fetched: FileContent[];
  skipped: string[];
  errors: FetchError[];
}

export interface RateLimitStatus {
  remaining: number | null;
  resetAt: Date | null;
  shouldThrottle: boolean;
}

export async function batchFetchFiles(
  provider: GitHubProxyProvider,
  files: PullRequestFileDescriptor[],
  headRef: string,
  baseRef: string,
  options: Partial<BatchOptions> = {},
): Promise<BatchFetchResult> {
  const settings = normalizeOptions(options);
  const limit = createLimiter(settings.concurrency);
  const tasks: Array<Promise<FetchOutcome>> = [];

  for (const file of files) {
    if (shouldFetchHead(file.status)) {
      tasks.push(limit(() => fetchVariant(provider, file, 'head', file.filename, headRef, settings)));
    } else {
      tasks.push(
        Promise.resolve({
          kind: 'skipped',
          value: buildCacheKey(file.owner, file.repo, file.filename, headRef),
        }),
      );
    }

    if (shouldFetchBase(file.status)) {
      const basePath = file.previousFilename ?? file.previous_filename ?? file.filename;
      tasks.push(limit(() => fetchVariant(provider, file, 'base', basePath, baseRef, settings)));
    } else {
      const basePath = file.previousFilename ?? file.previous_filename ?? file.filename;
      tasks.push(
        Promise.resolve({
          kind: 'skipped',
          value: buildCacheKey(file.owner, file.repo, basePath, baseRef),
        }),
      );
    }
  }

  const settled = await Promise.all(tasks);
  const result: BatchFetchResult = {
    fetched: [],
    skipped: [],
    errors: [],
  };

  for (const outcome of settled) {
    if (outcome.kind === 'fetched') {
      result.fetched.push(outcome.value);
      continue;
    }

    if (outcome.kind === 'skipped') {
      result.skipped.push(outcome.value);
      continue;
    }

    result.errors.push(outcome.value);
  }

  return result;
}

export function checkRateLimit(headers: Record<string, string>): RateLimitStatus {
  const remainingHeader = getHeader(headers, 'x-ratelimit-remaining');
  const resetHeader = getHeader(headers, 'x-ratelimit-reset');
  const remaining = parseInteger(remainingHeader);
  const resetSeconds = parseInteger(resetHeader);
  const resetAt = resetSeconds === null ? null : new Date(resetSeconds * 1000);

  return {
    remaining,
    resetAt,
    shouldThrottle: remaining !== null && remaining < RATE_LIMIT_THRESHOLD,
  };
}

export async function throttleIfNeeded(rateLimit: RateLimitStatus): Promise<void> {
  if (!rateLimit.shouldThrottle || rateLimit.resetAt === null) {
    return;
  }

  const delayMs = rateLimit.resetAt.getTime() - Date.now();
  if (delayMs <= 0) {
    return;
  }

  console.warn(
    `GitHub rate limit is low (${rateLimit.remaining ?? 'unknown'} remaining); throttling until ${rateLimit.resetAt.toISOString()}.`,
  );
  await sleep(delayMs);
}

interface FetchSuccess {
  kind: 'fetched';
  value: FileContent;
}

interface FetchSkipped {
  kind: 'skipped';
  value: string;
}

interface FetchFailed {
  kind: 'error';
  value: FetchError;
}

type FetchOutcome = FetchFailed | FetchSkipped | FetchSuccess;

interface NormalizedBatchOptions {
  concurrency: number;
  maxFileSize: number;
  skipCached: boolean;
  cache?: BatchFetchCache;
}

async function fetchVariant(
  provider: GitHubProxyProvider,
  file: PullRequestFileDescriptor,
  variant: FileVariant,
  path: string,
  ref: string,
  options: NormalizedBatchOptions,
): Promise<FetchOutcome> {
  const cacheKey = buildCacheKey(file.owner, file.repo, path, ref);

  if (options.skipCached && options.cache && (await options.cache.has(cacheKey))) {
    return { kind: 'skipped', value: cacheKey };
  }

  try {
    const response = await provider.proxy({
      method: 'GET',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.repo)}/contents/${encodePath(path)}`,
      connectionId: file.connectionId,
      headers: {
        Accept: 'application/vnd.github.object+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      query: {
        ref,
      },
    });

    const rateLimit = checkRateLimit(response.headers);
    await throttleIfNeeded(rateLimit);

    if (response.status >= 400) {
      return {
        kind: 'error',
        value: {
          path,
          ref,
          variant,
          status: response.status,
          error: extractErrorMessage(response.data) ?? `GitHub returned HTTP ${response.status}`,
        },
      };
    }

    const content = toFileContent(response.data, {
      cacheKey,
      maxFileSize: options.maxFileSize,
      owner: file.owner,
      path,
      ref,
      repo: file.repo,
      variant,
    });

    if (content === null) {
      return { kind: 'skipped', value: cacheKey };
    }

    if (options.cache?.set) {
      await options.cache.set(cacheKey, content);
    }

    return {
      kind: 'fetched',
      value: content,
    };
  } catch (error) {
    return {
      kind: 'error',
      value: {
        path,
        ref,
        variant,
        error: formatError(error),
      },
    };
  }
}

function toFileContent(
  value: JsonValue | null,
  metadata: {
    cacheKey: string;
    maxFileSize: number;
    owner: string;
    path: string;
    ref: string;
    repo: string;
    variant: FileVariant;
  },
): FileContent | null {
  if (typeof value === 'string') {
    const size = Buffer.byteLength(value, 'utf8');
    if (size > metadata.maxFileSize) {
      return null;
    }

    return {
      owner: metadata.owner,
      repo: metadata.repo,
      path: metadata.path,
      ref: metadata.ref,
      variant: metadata.variant,
      content: value,
      size,
      encoding: 'utf-8',
      cacheKey: metadata.cacheKey,
    };
  }

  const object = expectObject(value, `GitHub content payload for ${metadata.path}@${metadata.ref}`);
  const encoding = readOptionalString(object, 'encoding') ?? 'utf-8';
  const rawContent = readOptionalString(object, 'content') ?? '';
  const sha = readOptionalString(object, 'sha');
  const decoded =
    encoding === 'base64'
      ? Buffer.from(rawContent.replace(/\s+/g, ''), 'base64').toString('utf8')
      : rawContent;
  const size = readOptionalNumber(object, 'size') ?? Buffer.byteLength(decoded, 'utf8');

  if (size > metadata.maxFileSize) {
    return null;
  }

  return {
    owner: metadata.owner,
    repo: metadata.repo,
    path: metadata.path,
    ref: metadata.ref,
    variant: metadata.variant,
    content: decoded,
    size,
    sha,
    encoding,
    cacheKey: metadata.cacheKey,
  };
}

function shouldFetchHead(status?: string): boolean {
  return !matchesStatus(status, ['removed']);
}

function shouldFetchBase(status?: string): boolean {
  return !matchesStatus(status, ['added', 'copied']);
}

function matchesStatus(status: string | undefined, blocked: string[]): boolean {
  if (!status) {
    return false;
  }

  return blocked.includes(status.toLowerCase());
}

function normalizeOptions(options: Partial<BatchOptions>): NormalizedBatchOptions {
  return {
    concurrency: Math.max(1, Math.trunc(options.concurrency ?? DEFAULT_CONCURRENCY)),
    maxFileSize: Math.max(0, Math.trunc(options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE)),
    skipCached: options.skipCached ?? true,
    cache: options.cache,
  };
}

function createLimiter(concurrency: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const schedule = () => {
    if (activeCount >= concurrency) {
      return;
    }

    const run = queue.shift();
    if (!run) {
      return;
    }

    activeCount += 1;
    run();
  };

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            activeCount -= 1;
            schedule();
          });
      });

      schedule();
    });
  };
}

function buildCacheKey(owner: string, repo: string, path: string, ref: string): string {
  return `${owner}/${repo}:${path}@${ref}`;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
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

function extractErrorMessage(value: JsonValue | null): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const message = value.message;
  return typeof message === 'string' ? message : undefined;
}

function expectObject(value: JsonValue | null, context: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }

  return value;
}

function readOptionalString(value: JsonObject, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function readOptionalNumber(value: JsonObject, key: string): number | undefined {
  const field = value[key];
  return typeof field === 'number' ? field : undefined;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
