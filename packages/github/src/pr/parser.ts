import { GITHUB_API_BASE_URL } from '../config.js';
import type {
  GitHubProxyProvider,
  JsonObject,
  JsonValue,
  ProxyResponse,
} from '../types.js';

const GITHUB_API_VERSION = '2022-11-28';

interface ProviderWithConnectionDefaults extends GitHubProxyProvider {
  connectionId?: string;
  defaultConnectionId?: string;
}

export interface ParsePullRequestOptions {
  connectionId?: string;
  headers?: Record<string, string>;
}

export interface GitHubLabel {
  color: string;
  default: boolean;
  description: null | string;
  id: number;
  name: string;
}

export interface GitHubRepositoryRef {
  full_name: string;
  html_url: string;
  id: number;
  name: string;
  private: boolean;
}

export interface GitHubPullRequestRef {
  label: string;
  ref: string;
  repo: GitHubRepositoryRef | null;
  sha: string;
}

export interface GitHubUser {
  avatar_url: null | string;
  html_url: null | string;
  id: number;
  login: string;
  type: string;
}

export interface GitHubPR {
  base: GitHubPullRequestRef;
  body: null | string;
  closed_at: null | string;
  created_at: string;
  diff_url: null | string;
  draft: boolean;
  head: GitHubPullRequestRef;
  html_url: null | string;
  labels: GitHubLabel[];
  merged: boolean;
  merged_at: null | string;
  number: number;
  patch_url: null | string;
  state: string;
  title: string;
  updated_at: string;
  user: GitHubUser | null;
}

export interface PullRequestLabel {
  color: string;
  default: boolean;
  description: null | string;
  id: number;
  name: string;
}

export interface PullRequestRepository {
  fullName: string;
  htmlUrl: string;
  id: number;
  name: string;
  private: boolean;
}

export interface PullRequestRef {
  label: string;
  ref: string;
  repo: PullRequestRepository | null;
  sha: string;
}

export interface PullRequestAuthor {
  avatarUrl: null | string;
  htmlUrl: null | string;
  id: number;
  login: string;
  type: string;
}

export interface PullRequestMetadata {
  author: PullRequestAuthor | null;
  base: PullRequestRef;
  body: null | string;
  closedAt: null | string;
  createdAt: string;
  diffUrl: null | string;
  draft: boolean;
  head: PullRequestRef;
  htmlUrl: null | string;
  labels: PullRequestLabel[];
  merged: boolean;
  mergedAt: null | string;
  number: number;
  patchUrl: null | string;
  state: string;
  title: string;
  updatedAt: string;
}

export class PullRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PullRequestError';
  }
}

export class PullRequestConfigurationError extends PullRequestError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PullRequestConfigurationError';
  }
}

export class PullRequestProviderError extends PullRequestError {
  readonly response?: ProxyResponse;
  readonly status?: number;

  constructor(message: string, options?: ErrorOptions & { response?: ProxyResponse; status?: number }) {
    super(message, options);
    this.name = 'PullRequestProviderError';
    this.response = options?.response;
    this.status = options?.status;
  }
}

export class PullRequestParseError extends PullRequestError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PullRequestParseError';
  }
}

export async function parsePullRequest(
  provider: GitHubProxyProvider,
  owner: string,
  repo: string,
  number: number,
  options: ParsePullRequestOptions = {},
): Promise<PullRequestMetadata> {
  const trimmedOwner = requireNonEmpty(owner, 'owner');
  const trimmedRepo = requireNonEmpty(repo, 'repo');
  const prNumber = requirePositiveInteger(number, 'number');
  const connectionId = resolveConnectionId(provider, options.connectionId);

  let response: ProxyResponse;
  try {
    response = await provider.proxy({
      method: 'GET',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/pulls/${prNumber}`,
      connectionId,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        ...options.headers,
      },
    });
  } catch (error) {
    throw new PullRequestProviderError(
      `Failed to fetch pull request ${trimmedOwner}/${trimmedRepo}#${prNumber}`,
      { cause: error },
    );
  }

  if (response.status >= 400) {
    throw new PullRequestProviderError(
      `GitHub pull request fetch failed for ${trimmedOwner}/${trimmedRepo}#${prNumber}: ${formatProviderError(response)}`,
      {
        response,
        status: response.status,
      },
    );
  }

  const pullRequest = parseGitHubPullRequest(response.data);
  return toPullRequestMetadata(pullRequest);
}

function parseGitHubPullRequest(value: JsonValue | null): GitHubPR {
  const prObject = expectObject(value, 'Pull request response');

  return {
    number: readPositiveInteger(prObject, 'number', 'Pull request response'),
    title: readString(prObject, 'title', 'Pull request response'),
    body: readNullableString(prObject, 'body', 'Pull request response'),
    state: readString(prObject, 'state', 'Pull request response'),
    draft: readBoolean(prObject, 'draft', 'Pull request response'),
    merged: readBoolean(prObject, 'merged', 'Pull request response'),
    created_at: readString(prObject, 'created_at', 'Pull request response'),
    updated_at: readString(prObject, 'updated_at', 'Pull request response'),
    closed_at: readNullableString(prObject, 'closed_at', 'Pull request response'),
    merged_at: readNullableString(prObject, 'merged_at', 'Pull request response'),
    html_url: readNullableString(prObject, 'html_url', 'Pull request response'),
    diff_url: readNullableString(prObject, 'diff_url', 'Pull request response'),
    patch_url: readNullableString(prObject, 'patch_url', 'Pull request response'),
    user: readNullableUser(prObject.user, 'Pull request response.user'),
    labels: readLabels(prObject.labels, 'Pull request response.labels'),
    head: readPullRequestRef(prObject.head, 'Pull request response.head'),
    base: readPullRequestRef(prObject.base, 'Pull request response.base'),
  };
}

function toPullRequestMetadata(pullRequest: GitHubPR): PullRequestMetadata {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    body: pullRequest.body,
    state: pullRequest.state,
    draft: pullRequest.draft,
    merged: pullRequest.merged,
    createdAt: pullRequest.created_at,
    updatedAt: pullRequest.updated_at,
    closedAt: pullRequest.closed_at,
    mergedAt: pullRequest.merged_at,
    htmlUrl: pullRequest.html_url,
    diffUrl: pullRequest.diff_url,
    patchUrl: pullRequest.patch_url,
    author:
      pullRequest.user === null
        ? null
        : {
            id: pullRequest.user.id,
            login: pullRequest.user.login,
            type: pullRequest.user.type,
            avatarUrl: pullRequest.user.avatar_url,
            htmlUrl: pullRequest.user.html_url,
          },
    labels: pullRequest.labels.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      description: label.description,
      default: label.default,
    })),
    head: toPullRequestRef(pullRequest.head),
    base: toPullRequestRef(pullRequest.base),
  };
}

function toPullRequestRef(ref: GitHubPullRequestRef): PullRequestRef {
  return {
    label: ref.label,
    ref: ref.ref,
    sha: ref.sha,
    repo:
      ref.repo === null
        ? null
        : {
            id: ref.repo.id,
            name: ref.repo.name,
            fullName: ref.repo.full_name,
            private: ref.repo.private,
            htmlUrl: ref.repo.html_url,
          },
  };
}

function readPullRequestRef(value: JsonValue | null | undefined, context: string): GitHubPullRequestRef {
  const refObject = expectObject(value, context);

  return {
    label: readString(refObject, 'label', context),
    ref: readString(refObject, 'ref', context),
    sha: readString(refObject, 'sha', context),
    repo: readNullableRepositoryRef(refObject.repo, `${context}.repo`),
  };
}

function readNullableRepositoryRef(
  value: JsonValue | null | undefined,
  context: string,
): GitHubRepositoryRef | null {
  if (value === null || value === undefined) {
    return null;
  }

  const repoObject = expectObject(value, context);
  return {
    id: readPositiveInteger(repoObject, 'id', context),
    name: readString(repoObject, 'name', context),
    full_name: readString(repoObject, 'full_name', context),
    private: readBoolean(repoObject, 'private', context),
    html_url: readString(repoObject, 'html_url', context),
  };
}

function readNullableUser(value: JsonValue | null | undefined, context: string): GitHubUser | null {
  if (value === null || value === undefined) {
    return null;
  }

  const userObject = expectObject(value, context);
  return {
    id: readPositiveInteger(userObject, 'id', context),
    login: readString(userObject, 'login', context),
    type: readString(userObject, 'type', context),
    avatar_url: readNullableString(userObject, 'avatar_url', context),
    html_url: readNullableString(userObject, 'html_url', context),
  };
}

function readLabels(value: JsonValue | null | undefined, context: string): GitHubLabel[] {
  if (!Array.isArray(value)) {
    throw new PullRequestParseError(`${context} must be an array`);
  }

  return value.map((labelValue, index) => {
    const labelContext = `${context}[${index}]`;
    const labelObject = expectObject(labelValue, labelContext);

    return {
      id: readPositiveInteger(labelObject, 'id', labelContext),
      name: readString(labelObject, 'name', labelContext),
      color: readString(labelObject, 'color', labelContext),
      default: readBoolean(labelObject, 'default', labelContext),
      description: readNullableString(labelObject, 'description', labelContext),
    };
  });
}

function resolveConnectionId(provider: GitHubProxyProvider, configuredConnectionId?: string): string {
  const fromOptions = configuredConnectionId?.trim();
  if (fromOptions) {
    return fromOptions;
  }

  const providerWithDefaults = provider as ProviderWithConnectionDefaults;
  const fromProvider = providerWithDefaults.connectionId?.trim();
  if (fromProvider) {
    return fromProvider;
  }

  const fromProviderDefault = providerWithDefaults.defaultConnectionId?.trim();
  if (fromProviderDefault) {
    return fromProviderDefault;
  }

  throw new PullRequestConfigurationError(
    'Missing GitHub connection id. Pass options.connectionId or provide provider.connectionId/defaultConnectionId.',
  );
}

function formatProviderError(response: ProxyResponse): string {
  const message = extractProviderMessage(response.data);
  return message ? `${response.status} ${message}` : `${response.status}`;
}

function extractProviderMessage(value: JsonValue | null): null | string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }

  const message = value.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }

  return null;
}

function expectObject(value: JsonValue | null | undefined, context: string): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new PullRequestParseError(`${context} must be an object`);
  }

  return value;
}

function readString(object: JsonObject, key: string, context: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PullRequestParseError(`${context}.${key} must be a non-empty string`);
  }

  return value;
}

function readNullableString(object: JsonObject, key: string, context: string): null | string {
  const value = object[key];
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new PullRequestParseError(`${context}.${key} must be a string or null`);
  }

  return value;
}

function readBoolean(object: JsonObject, key: string, context: string): boolean {
  const value = object[key];
  if (typeof value !== 'boolean') {
    throw new PullRequestParseError(`${context}.${key} must be a boolean`);
  }

  return value;
}

function readPositiveInteger(object: JsonObject, key: string, context: string): number {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new PullRequestParseError(`${context}.${key} must be a positive integer`);
  }

  return value;
}

function requireNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new PullRequestConfigurationError(`${name} must be a non-empty string`);
  }

  return trimmed;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new PullRequestConfigurationError(`${name} must be a positive integer`);
  }

  return value;
}
