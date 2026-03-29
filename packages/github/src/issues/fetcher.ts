import type {
  GitHubProxyProvider,
  JsonObject,
  JsonValue,
  ProxyResponse,
} from '../types.js';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_PAGE_SIZE = 100;

type GitHubIssue = JsonObject & {
  pull_request?: JsonObject | null;
};

type GitHubIssueComment = JsonObject;

type ConnectionAwareProvider = GitHubProxyProvider & {
  readonly connectionId?: string;
  readonly defaultConnectionId?: string;
};

export async function fetchIssue(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  connectionId?: string,
): Promise<GitHubIssue> {
  const endpoint = buildIssueEndpoint(owner, repo, number);
  const response = await provider.proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint,
    connectionId: resolveConnectionId(provider, connectionId),
    headers: buildGitHubHeaders(),
  });

  assertSuccessfulResponse(response, `Failed to fetch issue ${owner}/${repo}#${number}`);
  return expectObject(response.data, `GitHub issue ${owner}/${repo}#${number}`) as GitHubIssue;
}

export async function fetchIssueComments(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  connectionId?: string,
): Promise<GitHubIssueComment[]> {
  const resolvedConnectionId = resolveConnectionId(provider, connectionId);
  const comments: GitHubIssueComment[] = [];
  let nextEndpoint: string | null = `${buildIssueEndpoint(owner, repo, number)}/comments?per_page=${GITHUB_PAGE_SIZE}`;

  while (nextEndpoint) {
    const response = await provider.proxy({
      method: 'GET',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: nextEndpoint,
      connectionId: resolvedConnectionId,
      headers: buildGitHubHeaders(),
    });

    assertSuccessfulResponse(
      response,
      `Failed to fetch issue comments for ${owner}/${repo}#${number}`,
    );
    comments.push(...expectObjectArray(response.data, 'GitHub issue comments response'));
    nextEndpoint = extractNextEndpoint(response.headers);
  }

  return comments;
}

export function isActualIssue(issue: GitHubIssue): boolean {
  return issue.pull_request === undefined || issue.pull_request === null;
}

function buildIssueEndpoint(owner: string, repo: string, number: number): string {
  return `/repos/${encodePathSegment(owner, 'owner')}/${encodePathSegment(repo, 'repo')}/issues/${formatIssueNumber(number)}`;
}

function buildGitHubHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

function encodePathSegment(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`GitHub ${fieldName} must be a non-empty string`);
  }

  return encodeURIComponent(trimmed);
}

function formatIssueNumber(value: number): string {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('GitHub issue number must be a positive integer');
  }

  return String(value);
}

function resolveConnectionId(
  provider: GitHubProxyProvider,
  connectionId?: string,
): string {
  const explicitConnectionId = connectionId?.trim();
  if (explicitConnectionId) {
    return explicitConnectionId;
  }

  const providerWithConnection = provider as ConnectionAwareProvider;
  const providerConnectionId = providerWithConnection.connectionId?.trim();
  if (providerConnectionId) {
    return providerConnectionId;
  }

  const defaultConnectionId = providerWithConnection.defaultConnectionId?.trim();
  if (defaultConnectionId) {
    return defaultConnectionId;
  }

  throw new Error(
    'Missing GitHub connection id. Pass connectionId explicitly or provide connectionId/defaultConnectionId on the provider.',
  );
}

function assertSuccessfulResponse(response: ProxyResponse, context: string): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  throw new Error(formatProviderError(context, response));
}

function expectObject(value: JsonValue | null, context: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} must be an object`);
  }

  return value;
}

function expectObjectArray(value: JsonValue | null, context: string): JsonObject[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }

  return value.map((entry, index) => expectObject(entry, `${context}[${index}]`));
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

function extractNextEndpoint(headers: Record<string, string>): string | null {
  const linkHeader = getHeader(headers, 'link');
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(',')) {
    if (!part.includes('rel="next"')) {
      continue;
    }

    const match = part.match(/<([^>]+)>/);
    if (!match) {
      return null;
    }

    const nextUrl = new URL(match[1], GITHUB_API_BASE_URL);
    return `${nextUrl.pathname}${nextUrl.search}`;
  }

  return null;
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const targetName = name.toLowerCase();

  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() === targetName) {
      return headerValue;
    }
  }

  return undefined;
}
