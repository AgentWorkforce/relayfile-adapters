export type GitHubOperationMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type GitHubOperationQueryValue = string | number | boolean | undefined;

const DEFAULT_PER_PAGE = 100;

export interface GitHubOperation {
  method: GitHubOperationMethod;
  path: string;
  query?: Record<string, GitHubOperationQueryValue>;
  body?: unknown;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubPaginationInput {
  per_page?: number;
  page?: number;
}

export interface GitHubListIssuesInput extends GitHubRepoRef, GitHubPaginationInput {
  state?: 'open' | 'closed' | 'all';
  labels?: string | string[];
  since?: string;
  assignee?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
}

export interface GitHubListPullRequestsInput extends GitHubRepoRef, GitHubPaginationInput {
  state?: 'open' | 'closed' | 'all';
  base?: string;
  head?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
}

export interface GitHubListCommentsInput extends GitHubRepoRef, GitHubPaginationInput {
  number: number;
  since?: string;
}

export interface GitHubListReleasesInput extends GitHubRepoRef, GitHubPaginationInput {}

export interface GitHubListReposInput extends GitHubPaginationInput {
  org?: string;
  type?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
}

export interface GitHubPullRequestRef extends GitHubRepoRef {
  number: number;
}

export interface GitHubSearchIssuesInput extends GitHubPaginationInput {
  query: string;
  repoSlug?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface GitHubSearchReposInput extends GitHubPaginationInput {
  query: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export function listIssues(input: GitHubListIssuesInput): GitHubOperation {
  return {
    method: 'GET',
    path: buildRepoPath(input, '/issues'),
    query: compactQuery({
      state: input.state ?? 'all',
      labels: serializeLabels(input.labels),
      since: normalizeOptionalString(input.since),
      assignee: normalizeOptionalString(input.assignee),
      sort: normalizeOptionalString(input.sort),
      direction: input.direction,
      ...paginationQuery(input),
    }),
  };
}

export function listPullRequests(input: GitHubListPullRequestsInput): GitHubOperation {
  return {
    method: 'GET',
    path: buildRepoPath(input, '/pulls'),
    query: compactQuery({
      state: input.state ?? 'all',
      base: normalizeOptionalString(input.base),
      head: normalizeOptionalString(input.head),
      sort: normalizeOptionalString(input.sort),
      direction: input.direction,
      ...paginationQuery(input),
    }),
  };
}

export function listComments(input: GitHubListCommentsInput): GitHubOperation {
  return {
    method: 'GET',
    path: `${buildRepoPath(input, '/issues')}/${formatPositiveInteger(input.number, 'number')}/comments`,
    query: compactQuery({
      since: normalizeOptionalString(input.since),
      ...paginationQuery(input),
    }),
  };
}

export function listReleases(input: GitHubListReleasesInput): GitHubOperation {
  return {
    method: 'GET',
    path: buildRepoPath(input, '/releases'),
    query: compactQuery(paginationQuery(input)),
  };
}

export function getRepository(input: GitHubRepoRef): GitHubOperation {
  return {
    method: 'GET',
    path: buildRepoPath(input),
  };
}

export function listOrgs(input: GitHubPaginationInput = {}): GitHubOperation {
  return {
    method: 'GET',
    path: '/user/orgs',
    query: compactQuery(paginationQuery(input)),
  };
}

export function listRepos(input: GitHubListReposInput = {}): GitHubOperation {
  const org = normalizeOptionalString(input.org);

  return {
    method: 'GET',
    path: org ? `/orgs/${encodePathSegment(org, 'org')}/repos` : '/user/repos',
    query: compactQuery({
      type: normalizeOptionalString(input.type),
      sort: normalizeOptionalString(input.sort),
      direction: input.direction,
      ...paginationQuery(input),
    }),
  };
}

export function getPull(input: GitHubPullRequestRef): GitHubOperation {
  return {
    method: 'GET',
    path: `${buildRepoPath(input, '/pulls')}/${formatPositiveInteger(input.number, 'number')}`,
  };
}

// Diff vs. JSON content is transport-specific and should be selected by the caller's Accept header.
export function getPullDiff(input: GitHubPullRequestRef): GitHubOperation {
  return getPull(input);
}

export function searchIssues(input: GitHubSearchIssuesInput): GitHubOperation {
  const query = requireNonEmptyString(input.query, 'query');
  const repoSlug = normalizeOptionalString(input.repoSlug);

  return {
    method: 'GET',
    path: '/search/issues',
    query: compactQuery({
      q: repoSlug ? `${query} repo:${repoSlug}` : query,
      sort: normalizeOptionalString(input.sort),
      order: input.order,
      ...paginationQuery(input),
    }),
  };
}

export function searchRepos(input: GitHubSearchReposInput): GitHubOperation {
  return {
    method: 'GET',
    path: '/search/repositories',
    query: compactQuery({
      q: `${requireNonEmptyString(input.query, 'query')} in:name`,
      sort: normalizeOptionalString(input.sort),
      order: input.order,
      ...paginationQuery(input),
    }),
  };
}

function buildRepoPath(input: GitHubRepoRef, suffix = ''): string {
  return `/repos/${encodePathSegment(input.owner, 'owner')}/${encodePathSegment(input.repo, 'repo')}${suffix}`;
}

function paginationQuery(input: GitHubPaginationInput): Record<'per_page' | 'page', number | undefined> {
  return {
    per_page: normalizePositiveInteger(input.per_page, 'per_page') ?? DEFAULT_PER_PAGE,
    page: normalizePositiveInteger(input.page, 'page'),
  };
}

function serializeLabels(labels: string | string[] | undefined): string | undefined {
  if (typeof labels === 'string') {
    return normalizeOptionalString(labels);
  }

  if (!Array.isArray(labels)) {
    return undefined;
  }

  const normalized = labels
    .map((label) => normalizeOptionalString(label))
    .filter((label): label is string => label !== undefined);

  return normalized.length > 0 ? normalized.join(',') : undefined;
}

function compactQuery(
  query: Record<string, GitHubOperationQueryValue>,
): Record<string, GitHubOperationQueryValue> | undefined {
  const entries = Object.entries(query).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function encodePathSegment(value: string, fieldName: string): string {
  return encodeURIComponent(requireNonEmptyString(value, fieldName));
}

function requireNonEmptyString(value: string, fieldName: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`GitHub ${fieldName} must be a non-empty string`);
  }

  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizePositiveInteger(value: number | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`GitHub ${fieldName} must be a positive integer`);
  }

  return value;
}

function formatPositiveInteger(value: number, fieldName: string): string {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`GitHub ${fieldName} must be a positive integer`);
  }

  return String(value);
}
