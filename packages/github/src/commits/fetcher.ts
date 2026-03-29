import type {
  GitHubProxyProvider,
  JsonObject,
  JsonValue,
  ProxyResponse,
} from '../types.js';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const DEFAULT_GITHUB_API_VERSION = '2022-11-28';
const DEFAULT_PER_PAGE = 100;
const DEFAULT_PROVIDER_CONFIG_KEY = 'github-app-oauth';

type ConnectionAwareProvider = GitHubProxyProvider & {
  connectionId?: string;
  defaultConnectionId?: string;
  providerConfigKey?: string;
  defaultProviderConfigKey?: string;
};

export interface FetchCommitsOptions {
  apiVersion?: string;
  connectionId?: string;
  perPage?: number;
  providerConfigKey?: string;
}

export type GitHubCommitParent = JsonObject & {
  sha: string;
};

export type GitHubPullRequestCommit = JsonObject & {
  author?: JsonObject | null;
  commit: JsonObject;
  committer?: JsonObject | null;
  parents: GitHubCommitParent[];
  sha: string;
};

export type GitHubCommitStats = JsonObject & {
  additions: number;
  deletions: number;
  total: number;
};

export type GitHubCommitFile = JsonObject & {
  additions: number;
  changes: number;
  deletions: number;
  filename: string;
  status: string;
};

export type GitHubCommitDetail = GitHubPullRequestCommit & {
  files: GitHubCommitFile[];
  stats: GitHubCommitStats;
};

export class GitHubCommitFetchError extends Error {
  readonly endpoint: string;
  readonly responseData?: JsonValue | null;
  readonly status?: number;

  constructor(
    message: string,
    options: {
      endpoint: string;
      responseData?: JsonValue | null;
      status?: number;
    },
  ) {
    super(message);
    this.name = 'GitHubCommitFetchError';
    this.endpoint = options.endpoint;
    this.responseData = options.responseData;
    this.status = options.status;
  }
}

export async function fetchPRCommits(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  options: FetchCommitsOptions = {},
): Promise<GitHubPullRequestCommit[]> {
  const commits: GitHubPullRequestCommit[] = [];
  let endpoint: string | undefined = buildPullRequestCommitsEndpoint(
    owner,
    repo,
    number,
    options.perPage,
  );

  while (endpoint) {
    const response = await proxyGitHubRequest(provider, endpoint, options);
    commits.push(...parsePullRequestCommitsResponse(response, endpoint));
    endpoint = extractNextPageEndpoint(response.headers, endpoint);
  }

  return commits;
}

export async function fetchCommitDetail(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  sha: string,
  options: Omit<FetchCommitsOptions, 'perPage'> = {},
): Promise<GitHubCommitDetail> {
  const endpoint = buildCommitDetailEndpoint(owner, repo, sha);
  const response = await proxyGitHubRequest(provider, endpoint, options);
  return parseCommitDetailResponse(response, endpoint);
}

function buildPullRequestCommitsEndpoint(
  owner: string,
  repo: string,
  pullRequestNumber: number,
  perPage?: number,
): string {
  const params = new URLSearchParams({
    page: '1',
    per_page: String(normalizePerPage(perPage)),
  });

  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/pulls/${pullRequestNumber}/commits?${params.toString()}`;
}

function buildCommitDetailEndpoint(owner: string, repo: string, sha: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/commits/${encodeURIComponent(sha)}`;
}

async function proxyGitHubRequest(
  provider: GitHubProxyProvider,
  endpoint: string,
  options: Omit<FetchCommitsOptions, 'perPage'>,
): Promise<ProxyResponse> {
  const connectionId = resolveConnectionId(provider, endpoint, options.connectionId);
  const providerConfigKey = resolveProviderConfigKey(provider, options.providerConfigKey);

  return provider.proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint,
    connectionId,
    headers: {
      Accept: 'application/vnd.github+json',
      'Provider-Config-Key': providerConfigKey,
      'X-GitHub-Api-Version': options.apiVersion ?? DEFAULT_GITHUB_API_VERSION,
    },
  });
}

function resolveConnectionId(
  provider: GitHubProxyProvider,
  endpoint: string,
  explicitConnectionId?: string,
): string {
  const connectionId =
    explicitConnectionId?.trim() ??
    readProviderString(provider, 'connectionId') ??
    readProviderString(provider, 'defaultConnectionId');

  if (!connectionId) {
    throw new GitHubCommitFetchError(
      'Missing GitHub connection id. Pass options.connectionId or use a provider that exposes connectionId/defaultConnectionId.',
      {
        endpoint,
      },
    );
  }

  return connectionId;
}

function resolveProviderConfigKey(
  provider: GitHubProxyProvider,
  explicitProviderConfigKey?: string,
): string {
  return (
    explicitProviderConfigKey?.trim() ??
    readProviderString(provider, 'providerConfigKey') ??
    readProviderString(provider, 'defaultProviderConfigKey') ??
    DEFAULT_PROVIDER_CONFIG_KEY
  );
}

function readProviderString(
  provider: GitHubProxyProvider,
  key: keyof ConnectionAwareProvider,
): string | undefined {
  const value = (provider as ConnectionAwareProvider)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parsePullRequestCommitsResponse(
  response: ProxyResponse,
  endpoint: string,
): GitHubPullRequestCommit[] {
  ensureSuccessStatus(response, endpoint);

  const commits = expectArray(
    response.data,
    'GitHub pull request commits response',
    endpoint,
    response,
  );

  return commits.map((value, index) =>
    parsePullRequestCommit(value, `${endpoint} response item ${index}`, endpoint, response),
  );
}

function parseCommitDetailResponse(response: ProxyResponse, endpoint: string): GitHubCommitDetail {
  ensureSuccessStatus(response, endpoint);

  const commit = parsePullRequestCommit(
    response.data,
    'GitHub commit detail response',
    endpoint,
    response,
  ) as GitHubCommitDetail;

  commit.stats = parseCommitStats(commit.stats, `${endpoint}.stats`, endpoint, response);
  commit.files = expectArray(commit.files, `${endpoint}.files`, endpoint, response).map(
    (value, index) => parseCommitFile(value, `${endpoint}.files[${index}]`, endpoint, response),
  );

  return commit;
}

function ensureSuccessStatus(response: ProxyResponse, endpoint: string): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  throw new GitHubCommitFetchError(
    `GitHub request failed with status ${response.status}: ${describeResponseData(response.data)}`,
    {
      endpoint,
      responseData: response.data,
      status: response.status,
    },
  );
}

function parsePullRequestCommit(
  value: JsonValue | undefined,
  context: string,
  endpoint: string,
  response: ProxyResponse,
): GitHubPullRequestCommit {
  const commit = expectObject(value, context, endpoint, response) as GitHubPullRequestCommit;
  commit.sha = readString(commit, 'sha', context, endpoint, response);
  commit.commit = expectObject(commit.commit, `${context}.commit`, endpoint, response);
  commit.parents = expectArray(commit.parents, `${context}.parents`, endpoint, response).map(
    (parentValue, index) =>
      parseCommitParent(parentValue, `${context}.parents[${index}]`, endpoint, response),
  );

  if (commit.author !== undefined && commit.author !== null) {
    commit.author = expectObject(commit.author, `${context}.author`, endpoint, response);
  }

  if (commit.committer !== undefined && commit.committer !== null) {
    commit.committer = expectObject(commit.committer, `${context}.committer`, endpoint, response);
  }

  return commit;
}

function parseCommitParent(
  value: JsonValue,
  context: string,
  endpoint: string,
  response: ProxyResponse,
): GitHubCommitParent {
  const parent = expectObject(value, context, endpoint, response) as GitHubCommitParent;
  parent.sha = readString(parent, 'sha', context, endpoint, response);
  return parent;
}

function parseCommitStats(
  value: JsonValue | undefined,
  context: string,
  endpoint: string,
  response: ProxyResponse,
): GitHubCommitStats {
  const stats = expectObject(value, context, endpoint, response) as GitHubCommitStats;
  stats.additions = readNumber(stats, 'additions', context, endpoint, response);
  stats.deletions = readNumber(stats, 'deletions', context, endpoint, response);
  stats.total = readNumber(stats, 'total', context, endpoint, response);
  return stats;
}

function parseCommitFile(
  value: JsonValue,
  context: string,
  endpoint: string,
  response: ProxyResponse,
): GitHubCommitFile {
  const file = expectObject(value, context, endpoint, response) as GitHubCommitFile;
  file.filename = readString(file, 'filename', context, endpoint, response);
  file.status = readString(file, 'status', context, endpoint, response);
  file.additions = readNumber(file, 'additions', context, endpoint, response);
  file.deletions = readNumber(file, 'deletions', context, endpoint, response);
  file.changes = readNumber(file, 'changes', context, endpoint, response);
  return file;
}

function expectArray(
  value: JsonValue | undefined,
  context: string,
  endpoint: string,
  response: ProxyResponse,
): JsonValue[] {
  if (Array.isArray(value)) {
    return value;
  }

  throw new GitHubCommitFetchError(`${context} must be an array`, {
    endpoint,
    responseData: response.data,
    status: response.status,
  });
}

function expectObject(
  value: JsonValue | undefined,
  context: string,
  endpoint: string,
  response: ProxyResponse,
): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }

  throw new GitHubCommitFetchError(`${context} must be an object`, {
    endpoint,
    responseData: response.data,
    status: response.status,
  });
}

function readString(
  value: JsonObject,
  key: string,
  context: string,
  endpoint: string,
  response: ProxyResponse,
): string {
  const fieldValue = value[key];
  if (typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw new GitHubCommitFetchError(`${context}.${key} must be a string`, {
    endpoint,
    responseData: response.data,
    status: response.status,
  });
}

function readNumber(
  value: JsonObject,
  key: string,
  context: string,
  endpoint: string,
  response: ProxyResponse,
): number {
  const fieldValue = value[key];
  if (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) {
    return fieldValue;
  }

  throw new GitHubCommitFetchError(`${context}.${key} must be a finite number`, {
    endpoint,
    responseData: response.data,
    status: response.status,
  });
}

function extractNextPageEndpoint(
  headers: Record<string, string>,
  currentEndpoint: string,
): string | undefined {
  const linkHeader = readHeader(headers, 'link');
  if (!linkHeader) {
    return undefined;
  }

  for (const segment of linkHeader.split(',')) {
    const match = segment.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (!match || match[2] !== 'next') {
      continue;
    }

    try {
      const nextUrl = new URL(match[1], GITHUB_API_BASE_URL);
      return `${nextUrl.pathname}${nextUrl.search}`;
    } catch {
      throw new GitHubCommitFetchError('GitHub returned a malformed Link header for pagination', {
        endpoint: currentEndpoint,
      });
    }
  }

  return undefined;
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
  const expected = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) {
      return value;
    }
  }

  return undefined;
}

function normalizePerPage(perPage?: number): number {
  if (perPage === undefined) {
    return DEFAULT_PER_PAGE;
  }

  if (!Number.isInteger(perPage) || perPage < 1 || perPage > DEFAULT_PER_PAGE) {
    throw new Error(`perPage must be an integer between 1 and ${DEFAULT_PER_PAGE}`);
  }

  return perPage;
}

function describeResponseData(data: JsonValue | null): string {
  if (data === null) {
    return 'no response body';
  }

  if (typeof data === 'string') {
    return data;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }

  if (Array.isArray(data)) {
    return `array(${data.length})`;
  }

  const message = data.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  return 'unexpected response payload';
}
