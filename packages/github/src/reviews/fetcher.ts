import { GITHUB_API_BASE_URL } from '../config.js';
import type { GitHubProxyProvider, JsonObject, JsonValue, ProxyResponse } from '../types.js';

const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_PAGE_SIZE = 100;

export type RawGitHubReview = JsonObject;
export type RawGitHubReviewComment = JsonObject;

export interface GitHubFetchOptions {
  connectionId?: string;
  headers?: Record<string, string>;
  providerConfigKey?: string;
}

interface ConnectionAwareProvider extends GitHubProxyProvider {
  connectionId?: string;
  defaultConnectionId?: string;
  providerConfigKey?: string;
  defaultProviderConfigKey?: string;
  resolveConnectionId?: () => Promise<string> | string;
}

export class GitHubFetchError extends Error {
  readonly status?: number;
  readonly endpoint: string;
  readonly responseData?: JsonValue | null;

  constructor(message: string, options: { endpoint: string; status?: number; responseData?: JsonValue | null }) {
    super(message);
    this.name = 'GitHubFetchError';
    this.endpoint = options.endpoint;
    this.status = options.status;
    this.responseData = options.responseData;
  }
}

export async function fetchReviews(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  options: GitHubFetchOptions = {},
): Promise<RawGitHubReview[]> {
  return fetchPaginatedObjects(provider, `/repos/${owner}/${repo}/pulls/${number}/reviews`, options);
}

export async function fetchReviewComments(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  options: GitHubFetchOptions = {},
): Promise<RawGitHubReviewComment[]> {
  return fetchPaginatedObjects(provider, `/repos/${owner}/${repo}/pulls/${number}/comments`, options);
}

export async function fetchSingleReviewComments(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  reviewId: number,
  options: GitHubFetchOptions = {},
): Promise<RawGitHubReviewComment[]> {
  return fetchPaginatedObjects(
    provider,
    `/repos/${owner}/${repo}/pulls/${number}/reviews/${reviewId}/comments`,
    options,
  );
}

async function fetchPaginatedObjects(
  provider: GitHubProxyProvider,
  endpoint: string,
  options: GitHubFetchOptions,
): Promise<JsonObject[]> {
  const items: JsonObject[] = [];
  let page = 1;

  while (true) {
    const response = await requestGitHubPage(provider, endpoint, page, options);
    const pageItems = expectObjectArray(response.data, endpoint);
    items.push(...pageItems);

    if (!hasNextPage(response.headers) && pageItems.length < GITHUB_PAGE_SIZE) {
      break;
    }

    if (!hasNextPage(response.headers) && pageItems.length === 0) {
      break;
    }

    page += 1;
  }

  return items;
}

async function requestGitHubPage(
  provider: GitHubProxyProvider,
  endpoint: string,
  page: number,
  options: GitHubFetchOptions,
): Promise<ProxyResponse> {
  const response = await provider.proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint,
    connectionId: await resolveConnectionId(provider, options),
    headers: buildHeaders(provider, options),
    query: {
      page: String(page),
      per_page: String(GITHUB_PAGE_SIZE),
    },
  });

  if (response.status >= 400) {
    throw new GitHubFetchError(formatProviderError(response, endpoint), {
      endpoint,
      status: response.status,
      responseData: response.data,
    });
  }

  return response;
}

function buildHeaders(
  provider: GitHubProxyProvider,
  options: GitHubFetchOptions,
): Record<string, string> {
  const providerConfigKey = resolveProviderConfigKey(provider, options);

  return {
    Accept: 'application/vnd.github+json',
    ...(providerConfigKey ? { 'Provider-Config-Key': providerConfigKey } : {}),
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...options.headers,
  };
}

async function resolveConnectionId(
  provider: GitHubProxyProvider,
  options: GitHubFetchOptions,
): Promise<string> {
  const explicitConnectionId = options.connectionId?.trim();
  if (explicitConnectionId) {
    return explicitConnectionId;
  }

  const connectionAwareProvider = provider as ConnectionAwareProvider;
  const providerConnectionId =
    connectionAwareProvider.connectionId?.trim() ??
    connectionAwareProvider.defaultConnectionId?.trim();

  if (providerConnectionId) {
    return providerConnectionId;
  }

  if (connectionAwareProvider.resolveConnectionId) {
    const resolvedConnectionId = (await connectionAwareProvider.resolveConnectionId()).trim();
    if (resolvedConnectionId) {
      return resolvedConnectionId;
    }
  }

  throw new Error(
    'Missing GitHub connection id. Pass options.connectionId or provide connectionId/defaultConnectionId on the provider.',
  );
}

function resolveProviderConfigKey(
  provider: GitHubProxyProvider,
  options: GitHubFetchOptions,
): string | undefined {
  const explicitProviderConfigKey = options.providerConfigKey?.trim();
  if (explicitProviderConfigKey) {
    return explicitProviderConfigKey;
  }

  const connectionAwareProvider = provider as ConnectionAwareProvider;
  return (
    connectionAwareProvider.providerConfigKey?.trim() ??
    connectionAwareProvider.defaultProviderConfigKey?.trim()
  );
}

function expectObjectArray(data: JsonValue | null, endpoint: string): JsonObject[] {
  if (!Array.isArray(data)) {
    throw new GitHubFetchError(`GitHub returned a non-array response for ${endpoint}`, {
      endpoint,
      responseData: data,
    });
  }

  return data.map((value, index) => {
    if (!isJsonObject(value)) {
      throw new GitHubFetchError(
        `GitHub returned a non-object item at index ${index} for ${endpoint}`,
        {
          endpoint,
          responseData: value,
        },
      );
    }

    return value;
  });
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

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatProviderError(response: ProxyResponse, endpoint: string): string {
  const responseMessage = extractErrorMessage(response.data);
  return responseMessage
    ? `GitHub request failed for ${endpoint} with status ${response.status}: ${responseMessage}`
    : `GitHub request failed for ${endpoint} with status ${response.status}`;
}

function extractErrorMessage(data: JsonValue | null): string | undefined {
  if (!isJsonObject(data)) {
    return undefined;
  }

  const message = data.message;
  return typeof message === 'string' && message.trim() ? message : undefined;
}
