import { atomicUpsertRecordIndex } from './atomic-index.js';
import { GITHUB_API_BASE_URL } from './config.js';
import type { VfsLike } from './files/content-fetcher.js';
import {
  buildRepoPullsIndexFile,
  pullRequestMergeIndexFields,
  type GitHubRecordIndexRow,
} from './index-emitter.js';
import { listPullRequests } from './operations.js';
import { githubRepoPullsIndexPath } from './path-mapper.js';
import type {
  GitHubAdapterConfig,
  GitHubRequestProvider,
  IngestResult,
  JsonObject,
  JsonValue,
  ProxyResponse,
} from './types.js';

const PULL_INDEX_PAGE_SIZE = 100;
const PULL_INDEX_CURSOR_PREFIX = 'github-pull-index-v1';
const PULL_INDEX_CAS_ATTEMPTS = 3;
const JSON_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
} as const;

interface ConnectionAwareProvider extends GitHubRequestProvider {
  connectionId?: string;
  defaultConnectionId?: string;
  providerConfigKey?: string;
  defaultProviderConfigKey?: string;
  resolveConnectionId?: () => Promise<string> | string;
  getConnectionId?: () => Promise<string> | string;
}

export interface ConvergeRepoPullIndexOptions {
  /** Opaque continuation returned by the preceding invocation for this repository. */
  cursor?: string;
}

export interface ConvergeRepoPullIndexResult extends IngestResult {
  /** True once GitHub returned the last page. */
  done: boolean;
  /** Page fetched by this invocation. Useful for progress logging. */
  page: number;
  /** Pull rows fetched from GitHub by this invocation. */
  pullRequestsScanned: number;
  /** Pull rows durably reconciled into the index by this invocation. */
  pullRequestsPersisted: number;
  /**
   * GitHub list operations issued by this invocation. This is always one.
   * The primitive deliberately leaves retries to its idempotent caller so a
   * Worker can budget outbound subrequests exactly.
   */
  githubRequests: 1;
  /** Present only while another page remains. Bound to the owner/repository. */
  cursor?: string;
}

export class PullIndexConvergenceError extends Error {
  readonly page: number;
  readonly path: string;
  readonly pullRequestsScanned: number;
  readonly writeErrors: IngestResult['errors'];

  constructor(
    path: string,
    page: number,
    pullRequestsScanned: number,
    writeErrors: IngestResult['errors'],
  ) {
    const detail = writeErrors.map(({ error }) => error).join('; ') || 'index write did not complete';
    super(`failed to persist pull-index page ${page} to ${path}: ${detail}`);
    this.name = 'PullIndexConvergenceError';
    this.path = path;
    this.page = page;
    this.pullRequestsScanned = pullRequestsScanned;
    this.writeErrors = writeErrors;
  }
}

/**
 * Converge one page of a repository's canonical pull-request index.
 *
 * One invocation performs exactly one
 * `GET /repos/{owner}/{repo}/pulls?state=all&per_page=100&page=N` operation and
 * no per-record fetch or ingestion. Up to three revision-aware VFS
 * read/write attempts reconcile the returned rows into `pulls/_index.json`;
 * an empty terminal page performs no VFS write. A 238-PR repository therefore
 * completes in three invocations, while arbitrarily larger repositories can
 * be resumed with the opaque cursor without increasing per-call cost.
 *
 * Page rows are merged into the current index instead of replacing it from an
 * empty baseline. That makes retries idempotent and lets CAS preserve rows or
 * richer fields written concurrently by webhook/direct ingestion. A page whose
 * CAS attempts are exhausted rejects without returning a cursor or `done`, so
 * callers cannot advance past rows that were fetched but not persisted.
 */
export async function convergeRepoPullIndex(
  workspaceId: string,
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
  options: ConvergeRepoPullIndexOptions = {},
): Promise<ConvergeRepoPullIndexResult> {
  void workspaceId;
  const vfs = requireVfsProvider(provider);
  const page = parseCursor(options.cursor, owner, repo);
  const operation = listPullRequests({
    owner,
    repo,
    state: 'all',
    sort: 'created',
    direction: 'asc',
    page,
    per_page: PULL_INDEX_PAGE_SIZE,
  });
  const response = await provider.proxy({
    method: operation.method,
    baseUrl: config.baseUrl || GITHUB_API_BASE_URL,
    endpoint: operation.path,
    connectionId: await resolveConnectionId(provider, config.connectionId),
    query: serializeQuery(operation.query),
    headers: {
      ...JSON_HEADERS,
      ...buildProviderHeaders(provider, config),
    },
  });

  assertSuccessfulResponse(response, operation.path);
  const rows = expectArray(
    response.data,
    `GitHub pull requests response for ${owner}/${repo}`,
  ).map((item, index) =>
    toPullIndexRow(
      expectObject(item, `GitHub pull requests response[${index}]`),
      owner,
      repo,
    ),
  );

  const path = githubRepoPullsIndexPath(owner, repo);
  const writeResult = rows.length > 0
    ? await reconcilePullIndexPage(vfs, owner, repo, rows)
    : emptyIngestResult();
  if (
    rows.length > 0
    && (
      writeResult.errors.length > 0
      || writeResult.filesWritten + writeResult.filesUpdated !== 1
      || !writeResult.paths.includes(path)
    )
  ) {
    throw new PullIndexConvergenceError(
      path,
      page,
      rows.length,
      writeResult.errors,
    );
  }
  const done = rows.length < PULL_INDEX_PAGE_SIZE;

  return {
    ...writeResult,
    done,
    page,
    pullRequestsScanned: rows.length,
    pullRequestsPersisted: rows.length,
    githubRequests: 1,
    ...(!done ? { cursor: formatCursor(owner, repo, page + 1) } : {}),
  };
}

async function reconcilePullIndexPage(
  vfs: VfsLike,
  owner: string,
  repo: string,
  pageRows: GitHubRecordIndexRow[],
): Promise<IngestResult> {
  const path = githubRepoPullsIndexPath(owner, repo);
  return atomicUpsertRecordIndex(
    vfs,
    path,
    (existingRows) => mergePullIndexRows(existingRows, pageRows),
    (rows) => buildRepoPullsIndexFile(owner, repo, rows).content,
    { maxAttempts: PULL_INDEX_CAS_ATTEMPTS },
  );
}

function mergePullIndexRows(
  existingRows: GitHubRecordIndexRow[],
  pageRows: GitHubRecordIndexRow[],
): GitHubRecordIndexRow[] {
  const merged = new Map(existingRows.map((row) => [row.id, row]));

  for (const pageRow of pageRows) {
    const current = merged.get(pageRow.id);
    const next = { ...current, ...pageRow };
    // An empty labels array is represented by omission in the documented row
    // shape. Remove a stale value from an older row when GitHub now returns no
    // labels, while retaining richer fields that list-pulls does not expose.
    if (!('labels' in pageRow)) {
      delete next.labels;
    }
    merged.set(pageRow.id, next);
  }

  return [...merged.values()];
}

function toPullIndexRow(value: JsonObject, owner: string, repo: string): GitHubRecordIndexRow {
  const context = `GitHub pull request ${owner}/${repo}`;
  const number = readPositiveInteger(value, 'number', context);
  const headRef = readRequiredString(readObject(value, 'head'), 'ref', `${context}.head`);
  const labels = readLabelNames(value.labels);
  return {
    id: String(number),
    title: readString(value, 'title') ?? '',
    updated: readString(value, 'updated_at') ?? '',
    number,
    state: readString(value, 'state') ?? '',
    ...(labels.length > 0 ? { labels } : {}),
    ...pullRequestMergeIndexFields(readString(value, 'merged_at')),
    headRef,
  };
}

function formatCursor(owner: string, repo: string, page: number): string {
  return [
    PULL_INDEX_CURSOR_PREFIX,
    encodeURIComponent(owner),
    encodeURIComponent(repo),
    String(page),
  ].join(':');
}

function parseCursor(cursor: string | undefined, owner: string, repo: string): number {
  if (cursor === undefined) {
    return 1;
  }

  const [prefix, encodedOwner, encodedRepo, pageText, ...extra] = cursor.split(':');
  const page = Number(pageText);
  let cursorOwner: string;
  let cursorRepo: string;
  try {
    cursorOwner = decodeURIComponent(encodedOwner ?? '');
    cursorRepo = decodeURIComponent(encodedRepo ?? '');
  } catch {
    throw new Error('Invalid GitHub pull-index cursor encoding.');
  }

  if (
    prefix !== PULL_INDEX_CURSOR_PREFIX
    || extra.length > 0
    || cursorOwner !== owner
    || cursorRepo !== repo
    || !Number.isInteger(page)
    || page < 2
  ) {
    throw new Error(`Invalid GitHub pull-index cursor for ${owner}/${repo}.`);
  }

  return page;
}

function serializeQuery(
  query: Record<string, string | number | boolean | undefined> | undefined,
): Record<string, string> | undefined {
  if (!query) {
    return undefined;
  }
  const entries = Object.entries(query)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([key, value]) => [key, String(value)] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

async function resolveConnectionId(
  provider: GitHubRequestProvider,
  explicitConnectionId?: string,
): Promise<string> {
  if (explicitConnectionId?.trim()) {
    return explicitConnectionId.trim();
  }

  const connectionAwareProvider = provider as ConnectionAwareProvider;
  const directConnectionId =
    connectionAwareProvider.connectionId?.trim()
    ?? connectionAwareProvider.defaultConnectionId?.trim();
  if (directConnectionId) {
    return directConnectionId;
  }

  const resolver = connectionAwareProvider.resolveConnectionId ?? connectionAwareProvider.getConnectionId;
  if (resolver) {
    const resolvedConnectionId = (await resolver.call(connectionAwareProvider)).trim();
    if (resolvedConnectionId) {
      return resolvedConnectionId;
    }
  }

  throw new Error('Missing GitHub connection id. Pass config.connectionId or expose it on the provider.');
}

function buildProviderHeaders(
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
): Record<string, string> {
  const connectionAwareProvider = provider as ConnectionAwareProvider;
  const providerConfigKey =
    config.providerConfigKey?.trim()
    ?? connectionAwareProvider.providerConfigKey?.trim()
    ?? connectionAwareProvider.defaultProviderConfigKey?.trim();
  return providerConfigKey ? { 'Provider-Config-Key': providerConfigKey } : {};
}

function requireVfsProvider(provider: GitHubRequestProvider): VfsLike {
  const vfs = provider as GitHubRequestProvider & VfsLike;
  if (!vfs.readFile && !vfs.read && !vfs.get) {
    throw new Error(
      'GitHub pull-index convergence requires a provider that implements VFS reads.',
    );
  }
  if (!vfs.writeFile && !vfs.write && !vfs.put && !vfs.set && !vfs.upsert) {
    throw new Error('GitHub pull-index convergence requires a provider that implements VFS writes.');
  }
  return vfs;
}

function assertSuccessfulResponse(response: ProxyResponse, path: string): void {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub request failed for ${path} with status ${response.status}`);
  }
}

function expectArray(value: JsonValue | null, context: string): JsonValue[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value;
}

function expectObject(value: JsonValue | unknown, context: string): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} must be an object`);
  }
  return value as JsonObject;
}

function readObject(source: JsonObject | undefined, key: string): JsonObject | undefined {
  const value = source?.[key];
  return value && !Array.isArray(value) && typeof value === 'object'
    ? value as JsonObject
    : undefined;
}

function readString(source: JsonObject | undefined | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' ? value : null;
}

function readRequiredString(
  source: JsonObject | undefined,
  key: string,
  context: string,
): string {
  const value = readString(source, key)?.trim();
  if (!value) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

function readPositiveInteger(source: JsonObject, key: string, context: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${context}.${key} must be a positive integer`);
  }
  return value;
}

function readLabelNames(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry === 'string') {
      return entry.trim() ? [entry] : [];
    }
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') {
      return [];
    }
    const name = readString(entry as JsonObject, 'name')?.trim();
    return name ? [name] : [];
  });
}

function emptyIngestResult(): IngestResult {
  return {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
  };
}
