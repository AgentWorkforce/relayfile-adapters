import { GITHUB_API_BASE_URL } from '../config.js';
import type { GitHubProxyProvider, JsonObject, JsonValue, ProxyResponse } from '../types.js';

const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_PAGE_SIZE = 100;

const PR_FILE_STATUSES = ['added', 'modified', 'removed', 'renamed'] as const;

type ConnectionAwareProvider = GitHubProxyProvider & {
  connectionId?: string;
  defaultConnectionId?: string;
  resolveConnectionId?: () => Promise<string> | string;
  getConnectionId?: () => Promise<string> | string;
};

type PRFileStatus = (typeof PR_FILE_STATUSES)[number];

interface GitHubPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface PullRequestFileMapping {
  vfsPath: string;
  githubPath: string;
  status: PRFileStatus;
  additions: number;
  deletions: number;
}

export async function mapPRFiles(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
): Promise<PullRequestFileMapping[]> {
  const trimmedOwner = requireNonEmpty(owner, 'owner');
  const trimmedRepo = requireNonEmpty(repo, 'repo');
  const prNumber = requirePositiveInteger(number, 'number');
  const connectionId = await resolveConnectionId(provider);

  const files: PullRequestFileMapping[] = [];
  let page = 1;

  while (true) {
    const response = await provider.proxy({
      method: 'GET',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/pulls/${prNumber}/files`,
      connectionId,
      headers: buildHeaders(),
      query: {
        page: String(page),
        per_page: String(GITHUB_PAGE_SIZE),
      },
    });

    assertSuccessfulResponse(
      response,
      `Failed to fetch pull request files for ${trimmedOwner}/${trimmedRepo}#${prNumber}`,
    );

    const pageFiles = parseGitHubPullRequestFiles(response.data);
    files.push(
      ...pageFiles.map((file) => ({
        vfsPath: buildVFSPath(trimmedOwner, trimmedRepo, prNumber, `files/${file.filename}`),
        githubPath: file.filename,
        status: normalizeStatus(file.status),
        additions: file.additions,
        deletions: file.deletions,
      })),
    );

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

export function buildVFSPath(
  owner: string,
  repo: string,
  number: number,
  subpath: string,
): string {
  const trimmedOwner = requireNonEmpty(owner, 'owner');
  const trimmedRepo = requireNonEmpty(repo, 'repo');
  const prNumber = requirePositiveInteger(number, 'number');
  const normalizedSubpath = normalizeSubpath(subpath);

  return `/github/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/pulls/${prNumber}/${normalizedSubpath}`;
}

function buildHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

async function resolveConnectionId(provider: GitHubProxyProvider): Promise<string> {
  const connectionAwareProvider = provider as ConnectionAwareProvider;
  const candidateConnectionId =
    connectionAwareProvider.connectionId?.trim() ??
    connectionAwareProvider.defaultConnectionId?.trim();

  if (candidateConnectionId) {
    return candidateConnectionId;
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
    'Missing GitHub connection id. Provide provider.connectionId, provider.defaultConnectionId, provider.resolveConnectionId(), or provider.getConnectionId().',
  );
}

function assertSuccessfulResponse(response: ProxyResponse, context: string): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  throw new Error(formatProviderError(context, response));
}

function parseGitHubPullRequestFiles(data: JsonValue | null): GitHubPullRequestFile[] {
  if (!Array.isArray(data)) {
    throw new Error('GitHub pull request files response must be an array');
  }

  return data.map((entry, index) => parseGitHubPullRequestFile(entry, index));
}

function parseGitHubPullRequestFile(value: JsonValue, index: number): GitHubPullRequestFile {
  const file = expectObject(value, `GitHub pull request files response[${index}]`);

  return {
    filename: readString(file, 'filename', `GitHub pull request files response[${index}]`),
    status: readString(file, 'status', `GitHub pull request files response[${index}]`),
    additions: readNonNegativeInteger(
      file,
      'additions',
      `GitHub pull request files response[${index}]`,
    ),
    deletions: readNonNegativeInteger(
      file,
      'deletions',
      `GitHub pull request files response[${index}]`,
    ),
  };
}

function normalizeStatus(status: string): PRFileStatus {
  const normalizedStatus = status.trim().toLowerCase();

  switch (normalizedStatus) {
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
    case 'modified':
    case 'changed':
    case 'unchanged':
      return 'modified';
    case 'renamed':
      return 'renamed';
    case 'copied':
      return 'added';
    default:
      throw new Error(`Unsupported GitHub pull request file status: ${status}`);
  }
}

function normalizeSubpath(subpath: string): string {
  const trimmedSubpath = requireNonEmpty(subpath, 'subpath').replace(/^\/+/, '');

  return trimmedSubpath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
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

function expectObject(value: JsonValue, context: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} must be an object`);
  }

  return value;
}

function readString(source: JsonObject, key: string, context: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new Error(`${context}.${key} must be a string`);
  }

  return value;
}

function readNonNegativeInteger(source: JsonObject, key: string, context: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${context}.${key} must be a non-negative integer`);
  }

  return value;
}

function hasNextPage(headers: Record<string, string>): boolean {
  const linkHeader = getHeader(headers, 'link');
  return linkHeader !== undefined && linkHeader.includes('rel="next"');
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const targetHeader = name.toLowerCase();

  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() === targetHeader) {
      return headerValue;
    }
  }

  return undefined;
}

function formatProviderError(context: string, response: ProxyResponse): string {
  const baseMessage = `${context} (status ${response.status})`;
  const responseData = response.data;

  if (responseData === null) {
    return baseMessage;
  }

  if (typeof responseData === 'string' && responseData.trim().length > 0) {
    return `${baseMessage}: ${responseData}`;
  }

  if (!Array.isArray(responseData) && typeof responseData === 'object') {
    const message = responseData.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return `${baseMessage}: ${message}`;
    }
  }

  return baseMessage;
}
