import { GITHUB_API_BASE_URL } from '../config.js';
import type { GitHubRequestProvider, JsonObject, JsonValue, ProxyResponse } from '../types.js';

const CHECK_RUNS_PER_PAGE = 100;
const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
} as const;

type ConnectionIdResolver = (() => Promise<string> | string) | undefined;

export interface GitHubCheckRunProvider extends GitHubRequestProvider {
  connectionId?: string;
  defaultConnectionId?: string;
  getConnectionId?: ConnectionIdResolver;
}

export interface CheckRunListResponse {
  total_count: number;
  check_runs: JsonObject[];
}

export async function fetchCheckRuns(
  provider: GitHubCheckRunProvider,
  owner: string,
  repo: string,
  sha: string,
  connectionId?: string,
): Promise<CheckRunListResponse> {
  const resolvedConnectionId = await resolveConnectionId(provider, connectionId);
  const allCheckRuns: JsonObject[] = [];
  let page = 1;
  let totalCount = 0;

  while (true) {
    const response = await provider.proxy({
      method: 'GET',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${owner}/${repo}/commits/${sha}/check-runs`,
      connectionId: resolvedConnectionId,
      headers: GITHUB_API_HEADERS,
      query: {
        page: String(page),
        per_page: String(CHECK_RUNS_PER_PAGE),
      },
    });

    const payload = expectObjectResponse(response, 'GitHub check runs response');
    const pageCheckRuns = readObjectArray(payload, 'check_runs', 'GitHub check runs response');
    totalCount = readNonNegativeInteger(payload, 'total_count', 'GitHub check runs response');
    allCheckRuns.push(...pageCheckRuns);

    if (pageCheckRuns.length < CHECK_RUNS_PER_PAGE || allCheckRuns.length >= totalCount) {
      break;
    }

    page += 1;
  }

  return {
    total_count: totalCount,
    check_runs: allCheckRuns,
  };
}

export async function fetchCheckRunDetail(
  provider: GitHubCheckRunProvider,
  owner: string,
  repo: string,
  checkRunId: number | string,
  connectionId?: string,
): Promise<JsonObject> {
  const resolvedConnectionId = await resolveConnectionId(provider, connectionId);
  const response = await provider.proxy({
    method: 'GET',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${owner}/${repo}/check-runs/${checkRunId}`,
    connectionId: resolvedConnectionId,
    headers: GITHUB_API_HEADERS,
  });

  return expectObjectResponse(response, 'GitHub check run detail response');
}

export function getHeadSHA(prMeta: unknown): string {
  const metadata = expectObject(prMeta, 'Pull request metadata');
  const candidateValues = [
    metadata.headSha,
    metadata.sha,
    readNestedValue(metadata, ['head', 'sha']),
    readNestedValue(metadata, ['head_commit', 'id']),
    readNestedValue(metadata, ['pull_request', 'head', 'sha']),
    readNestedValue(metadata, ['pullRequest', 'head', 'sha']),
  ];

  for (const value of candidateValues) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  throw new Error(
    'Pull request metadata is missing a head SHA. Expected head.sha, pull_request.head.sha, pullRequest.head.sha, or headSha.',
  );
}

async function resolveConnectionId(
  provider: GitHubCheckRunProvider,
  explicitConnectionId?: string,
): Promise<string> {
  if (explicitConnectionId?.trim()) {
    return explicitConnectionId.trim();
  }

  if (provider.connectionId?.trim()) {
    return provider.connectionId.trim();
  }

  if (provider.defaultConnectionId?.trim()) {
    return provider.defaultConnectionId.trim();
  }

  const resolved = await provider.getConnectionId?.();
  if (resolved?.trim()) {
    return resolved.trim();
  }

  throw new Error(
    'Missing GitHub connection id. Pass connectionId explicitly or provide provider.connectionId, provider.defaultConnectionId, or provider.getConnectionId().',
  );
}

function expectObjectResponse(response: ProxyResponse, context: string): JsonObject {
  if (response.status >= 400) {
    throw new Error(`${context} failed with status ${response.status}`);
  }

  return expectObject(response.data, context);
}

function expectObject(value: JsonValue | unknown, context: string): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} must be an object`);
  }

  return value as JsonObject;
}

function readObjectArray(source: JsonObject, key: string, context: string): JsonObject[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${key} must be an array`);
  }

  return value.map((entry, index) => expectObject(entry, `${context}.${key}[${index}]`));
}

function readNonNegativeInteger(source: JsonObject, key: string, context: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${context}.${key} must be a non-negative integer`);
  }

  return value;
}

function readNestedValue(source: JsonObject, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = source;

  for (const segment of path) {
    if (!current || Array.isArray(current) || typeof current !== 'object') {
      return undefined;
    }

    current = (current as JsonObject)[segment];
  }

  return current;
}
