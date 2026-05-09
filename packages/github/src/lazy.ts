import { GITHUB_API_BASE_URL } from './config.js';
import type { VfsLike } from './files/content-fetcher.js';
import { ingestIssue } from './issues/issue-mapper.js';
import { listIssues, listPullRequests, listRepos, getRepository, type GitHubOperation } from './operations.js';
import { githubRepositoryMetadataPath, githubRepoPrefix } from './path-mapper.js';
import { ingestPullRequest } from './pr/diff-writer.js';
import type {
  GitHubAdapterConfig,
  GitHubRequestProvider,
  JsonObject,
  JsonValue,
  MaterializeResult,
  ProxyResponse,
  SyncOptions,
  SyncResult,
} from './types.js';

type LazyGitHubProvider = GitHubRequestProvider & VfsLike;

interface RepoIndexEntry {
  owner: string;
  repo: string;
  url: string;
}

interface RepoListItem {
  number: number;
  state: string | null;
  title: string | null;
  url: string | null;
}

interface ConnectionAwareProvider extends GitHubRequestProvider {
  connectionId?: string;
  defaultConnectionId?: string;
  providerConfigKey?: string;
  defaultProviderConfigKey?: string;
  resolveConnectionId?: () => Promise<string> | string;
  getConnectionId?: () => Promise<string> | string;
}

interface TrackedWriteResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: Array<{ path: string; error: string }>;
}

const ROOT_DIR_MARKER_PATH = '/github/repos/';
const ROOT_INDEX_PATH = '/github/repos/_index.json';
const JSON_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
} as const;

export async function syncGitHubWorkspace(
  workspaceId: string,
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
  inFlight: Map<string, Promise<MaterializeResult>>,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const repos = await resolveRepos(provider, config);
  const vfs = requireVfsProvider(provider);
  const rootMarkerResult = await writeTextFile(vfs, ROOT_DIR_MARKER_PATH, '');
  const rootIndexResult = await writeJsonFile(vfs, ROOT_INDEX_PATH, { repos });
  const tracked = mergeTrackedResults(rootMarkerResult, rootIndexResult);

  if (config.lazy) {
    return toSyncResult(tracked, options.cursor, ['repository']);
  }

  for (const repo of repos) {
    mergeIntoTracked(
      tracked,
      await materializeRepo(workspaceId, provider, config, repo.owner, repo.repo, inFlight),
    );
  }

  return toSyncResult(tracked, options.cursor, ['repository', 'issue', 'pull_request']);
}

export async function materializeRepo(
  workspaceId: string,
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
  inFlight: Map<string, Promise<MaterializeResult>> = new Map(),
): Promise<MaterializeResult> {
  void workspaceId;
  const key = `${owner}/${repo}`.toLowerCase();
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const task = materializeRepoInternal(provider, config, owner, repo).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function materializeRepoInternal(
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
): Promise<MaterializeResult> {
  const vfs = requireVfsProvider(provider);
  const tracked = createTrackedResult(owner, repo);
  const indexedRepos = await readRepoIndex(vfs);
  const repoPrefix = githubRepoPrefix(owner, repo);
  const repoMetadata = await fetchRepositoryMetadata(provider, config, owner, repo);

  if (!indexedRepos.some((entry) => sameRepo(entry, owner, repo))) {
    const nextRepos = [...indexedRepos, toRepoIndexEntry(repoMetadata, owner, repo)]
      .sort((left, right) => `${left.owner}/${left.repo}`.localeCompare(`${right.owner}/${right.repo}`));
    mergeIntoTracked(tracked, await writeJsonFile(vfs, ROOT_INDEX_PATH, { repos: nextRepos }));
  }

  mergeIntoTracked(tracked, await writeJsonFile(vfs, githubRepositoryMetadataPath(owner, repo), repoMetadata));

  const issues = await fetchRepoIssues(provider, config, owner, repo);
  mergeIntoTracked(
    tracked,
    await writeJsonFile(vfs, `${repoPrefix}/issues/_index.json`, {
      issues: issues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        url: issue.url,
      })),
    }),
  );
  for (const issue of issues) {
    mergeIntoTracked(tracked, await ingestIssue(provider, owner, repo, issue.number, vfs));
  }

  const pulls = await fetchRepoPullRequests(provider, config, owner, repo);
  mergeIntoTracked(
    tracked,
    await writeJsonFile(vfs, `${repoPrefix}/pulls/_index.json`, {
      pulls: pulls.map((pull) => ({
        number: pull.number,
        title: pull.title,
        state: pull.state,
        url: pull.url,
      })),
    }),
  );
  for (const pull of pulls) {
    mergeIntoTracked(tracked, await ingestPullRequest(provider, owner, repo, pull.number, vfs));
  }

  return tracked;
}

async function resolveRepos(
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
): Promise<RepoIndexEntry[]> {
  if (config.owner?.trim() && config.repo?.trim()) {
    return [toRepoIndexEntry(await fetchRepositoryMetadata(provider, config, config.owner, config.repo), config.owner, config.repo)];
  }

  const repos = await fetchRepoList(provider, config);
  return repos.map((repo) => toRepoIndexEntry(repo, config.owner, readRequiredRepoName(repo)));
}

async function fetchRepoList(
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
): Promise<JsonObject[]> {
  const results: JsonObject[] = [];
  let page = 1;

  while (true) {
    const operation = listRepos({
      org: config.owner,
      page,
      per_page: 100,
    });
    const response = await proxyOperation(provider, config, operation);
    const pageItems = expectArray(response.data, 'GitHub repositories response').map((item, index) =>
      expectObject(item, `GitHub repositories response[${index}]`),
    );
    results.push(...pageItems);

    if (pageItems.length < 100) {
      return results;
    }

    page += 1;
  }
}

async function fetchRepositoryMetadata(
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
): Promise<JsonObject> {
  const response = await proxyOperation(provider, config, getRepository({ owner, repo }));
  return expectObject(response.data, `GitHub repository response for ${owner}/${repo}`);
}

async function fetchRepoIssues(
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
): Promise<RepoListItem[]> {
  const issues: RepoListItem[] = [];
  let page = 1;

  while (true) {
    const operation = listIssues({
      owner,
      repo,
      state: 'all',
      page,
      per_page: 100,
    });
    const response = await proxyOperation(provider, config, operation);
    const pageItems = expectArray(response.data, `GitHub issues response for ${owner}/${repo}`);

    for (const [index, item] of pageItems.entries()) {
      const issue = expectObject(item, `GitHub issues response[${index}]`);
      if ('pull_request' in issue) {
        continue;
      }
      issues.push(toRepoListItem(issue, `GitHub issue ${owner}/${repo}`));
    }

    if (pageItems.length < 100) {
      return issues;
    }

    page += 1;
  }
}

async function fetchRepoPullRequests(
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
  owner: string,
  repo: string,
): Promise<RepoListItem[]> {
  const pulls: RepoListItem[] = [];
  let page = 1;

  while (true) {
    const operation = listPullRequests({
      owner,
      repo,
      state: 'all',
      page,
      per_page: 100,
    });
    const response = await proxyOperation(provider, config, operation);
    const pageItems = expectArray(response.data, `GitHub pull requests response for ${owner}/${repo}`);

    for (const [index, item] of pageItems.entries()) {
      pulls.push(toRepoListItem(expectObject(item, `GitHub pull request response[${index}]`), `GitHub pull request ${owner}/${repo}`));
    }

    if (pageItems.length < 100) {
      return pulls;
    }

    page += 1;
  }
}

async function proxyOperation(
  provider: GitHubRequestProvider,
  config: GitHubAdapterConfig,
  operation: GitHubOperation,
): Promise<ProxyResponse> {
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

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub request failed for ${operation.path} with status ${response.status}`);
  }

  return response;
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
    connectionAwareProvider.connectionId?.trim() ??
    connectionAwareProvider.defaultConnectionId?.trim();

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
    config.providerConfigKey?.trim() ??
    connectionAwareProvider.providerConfigKey?.trim() ??
    connectionAwareProvider.defaultProviderConfigKey?.trim();

  return providerConfigKey ? { 'Provider-Config-Key': providerConfigKey } : {};
}

function createTrackedResult(owner: string, repo: string): MaterializeResult {
  return {
    owner,
    repo,
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
  };
}

function createEmptyTrackedWriteResult(): TrackedWriteResult {
  return {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
  };
}

function mergeTrackedResults(...results: TrackedWriteResult[]): TrackedWriteResult {
  return results.reduce<TrackedWriteResult>((combined, result) => {
    mergeIntoTracked(combined, result);
    return combined;
  }, createEmptyTrackedWriteResult());
}

function mergeIntoTracked(target: TrackedWriteResult, next: TrackedWriteResult): void {
  target.filesWritten += next.filesWritten;
  target.filesUpdated += next.filesUpdated;
  target.filesDeleted += next.filesDeleted;
  target.paths.push(...next.paths);
  target.errors.push(...next.errors);
}

function toSyncResult(
  tracked: TrackedWriteResult,
  cursor: string | undefined,
  syncedObjectTypes: string[],
): SyncResult {
  return {
    filesWritten: tracked.filesWritten,
    filesUpdated: tracked.filesUpdated,
    filesDeleted: tracked.filesDeleted,
    cursor,
    syncedObjectTypes,
    errors: tracked.errors.map((error) => ({ error: `${error.path}: ${error.error}` })),
  };
}

function requireVfsProvider(provider: GitHubRequestProvider): LazyGitHubProvider {
  const vfs = provider as LazyGitHubProvider;
  if (!vfs.writeFile && !vfs.write && !vfs.put && !vfs.set && !vfs.upsert) {
    throw new Error('GitHub lazy sync requires a provider that also implements VFS write methods.');
  }
  return vfs;
}

async function readRepoIndex(vfs: VfsLike): Promise<RepoIndexEntry[]> {
  const raw = await readTextFile(vfs, ROOT_INDEX_PATH);
  if (!raw) {
    return [];
  }

  try {
    const payload = JSON.parse(raw) as { repos?: unknown };
    if (!Array.isArray(payload.repos)) {
      return [];
    }

    return payload.repos.flatMap((entry, index) => {
      try {
        const repo = expectObject(entry, `GitHub repos index[${index}]`);
        return [toRepoIndexEntry(repo)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

async function readTextFile(vfs: VfsLike, path: string): Promise<string | undefined> {
  const readers = [vfs.readFile, vfs.read, vfs.get];
  for (const reader of readers) {
    if (!reader) {
      continue;
    }

    try {
      const value = await reader.call(vfs, path);
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

async function writeJsonFile(vfs: VfsLike, path: string, value: unknown): Promise<TrackedWriteResult> {
  return writeTextFile(vfs, path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextFile(vfs: VfsLike, path: string, content: string): Promise<TrackedWriteResult> {
  const result = createEmptyTrackedWriteResult();

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
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}

async function pathExists(vfs: VfsLike, path: string): Promise<boolean> {
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

  return Boolean(await readTextFile(vfs, path));
}

async function runVfsWrite(vfs: VfsLike, path: string, content: string): Promise<void> {
  const writer = vfs.writeFile ?? vfs.write ?? vfs.put ?? vfs.set ?? vfs.upsert;
  if (!writer) {
    throw new Error('VFS object must expose a write method.');
  }

  await writer.call(vfs, path, content);
}

function toRepoListItem(value: JsonObject, context: string): RepoListItem {
  const number = readPositiveInteger(value, 'number', context);
  return {
    number,
    title: readString(value, 'title'),
    state: readString(value, 'state'),
    url: readString(value, 'html_url') ?? readString(value, 'url'),
  };
}

function toRepoIndexEntry(
  value: JsonObject,
  fallbackOwner?: string,
  fallbackRepo?: string,
): RepoIndexEntry {
  const ownerRecord = readObject(value, 'owner');
  const owner =
    readString(value, 'owner') ??
    readString(ownerRecord ?? undefined, 'login') ??
    fallbackOwner ??
    readOwnerFromFullName(readString(value, 'full_name'));
  const repo = readString(value, 'repo') ?? fallbackRepo ?? readRequiredRepoName(value);

  if (!owner) {
    throw new Error('GitHub repository is missing owner metadata.');
  }

  return {
    owner,
    repo,
    url:
      readString(value, 'html_url') ??
      readString(value, 'url') ??
      `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  };
}

function readRequiredRepoName(value: JsonObject): string {
  return readString(value, 'repo') ?? readString(value, 'name') ?? readRepoFromFullName(readString(value, 'full_name')) ?? '';
}

function readOwnerFromFullName(fullName: string | null): string | undefined {
  if (!fullName?.includes('/')) {
    return undefined;
  }
  return fullName.split('/')[0];
}

function readRepoFromFullName(fullName: string | null): string | undefined {
  if (!fullName?.includes('/')) {
    return undefined;
  }
  return fullName.split('/')[1];
}

function sameRepo(entry: RepoIndexEntry, owner: string, repo: string): boolean {
  return entry.owner === owner && entry.repo === repo;
}

function expectObject(value: JsonValue | unknown, context: string): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} must be an object`);
  }

  return value as JsonObject;
}

function expectArray(value: JsonValue | null, context: string): JsonValue[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }

  return value;
}

function readObject(source: JsonObject | undefined, key: string): JsonObject | undefined {
  const value = source?.[key];
  return value && !Array.isArray(value) && typeof value === 'object' ? (value as JsonObject) : undefined;
}

function readString(source: JsonObject | undefined | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === 'string' ? value : null;
}

function readPositiveInteger(source: JsonObject, key: string, context: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${context}.${key} must be a positive integer`);
  }

  return value;
}
