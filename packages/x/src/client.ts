import { createHash } from 'node:crypto';

import {
  xPostPath,
  type XSearchMode,
} from './path-mapper.js';
import type {
  XPost,
  XSearchApiResponse,
  XSearchBundle,
  XSearchCostEstimate,
  XSearchCostPolicy,
  XSearchRequest,
  XSearchResult,
  XSearchRun,
  XUser,
} from './types.js';

export type FetchLike = (url: string, init?: {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}>;

type XSearchResponse = Awaited<ReturnType<FetchLike>>;

class XSearchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`X search request timed out after ${timeoutMs}ms`);
    this.name = 'XSearchTimeoutError';
  }
}

export interface XSearchClientOptions {
  bearerToken: string;
  fetch?: FetchLike;
  baseUrl?: string;
  requestTimeoutMs?: number;
  now?: () => Date;
}

export const X_DEFAULT_POST_READ_UNIT_USD = 0.005;
export const X_DEFAULT_USER_READ_UNIT_USD = 0.010;
export const X_DEFAULT_MAX_POST_READS = 100;
export const X_DEFAULT_MAX_USER_READS = 25;
export const X_ABSOLUTE_MAX_POST_READS = 1_000;
export const X_ABSOLUTE_MAX_PAGES = 10;
export const X_MIN_SEARCH_PAGE_SIZE = 10;
export const X_RECENT_QUERY_MAX_LENGTH = 512;
export const X_ARCHIVE_QUERY_MAX_LENGTH = 1024;
export const X_OPTIONAL_TOKEN_MAX_LENGTH = 256;
export const X_FIELD_LIST_MAX_ITEMS = 32;
export const X_FIELD_NAME_MAX_LENGTH = 64;
export const X_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export const X_DEFAULT_TWEET_FIELDS = [
  'author_id',
  'conversation_id',
  'created_at',
  'entities',
  'lang',
  'public_metrics',
  'referenced_tweets',
  'text',
] as const;

export const X_DEFAULT_EXPANSIONS = ['author_id'] as const;
export const X_DEFAULT_USER_FIELDS = ['id', 'name', 'username', 'verified', 'verified_type'] as const;
const X_USER_HYDRATING_EXPANSIONS = new Set([
  'author_id',
  'entities.mentions.username',
  'referenced_tweets.id.author_id',
]);

export function estimateXSearchCost(input: {
  posts: number;
  users?: number;
  policy?: XSearchCostPolicy;
}): XSearchCostEstimate {
  const policy = input.policy ?? {};
  const postReadUnitUsd = policy.postReadUnitUsd ?? X_DEFAULT_POST_READ_UNIT_USD;
  const userReadUnitUsd = policy.userReadUnitUsd ?? X_DEFAULT_USER_READ_UNIT_USD;
  const maxPostReads = policy.maxPostReads ?? input.posts;
  const maxUserReads = policy.maxUserReads ?? input.users ?? 0;
  const posts = Math.max(0, Math.min(input.posts, maxPostReads));
  const users = Math.max(0, Math.min(input.users ?? 0, maxUserReads));
  const estimatedUsd = roundUsd(posts * postReadUnitUsd + users * userReadUnitUsd);
  return {
    posts,
    users,
    postReadUnitUsd,
    userReadUnitUsd,
    estimatedUsd,
    cappedByBudget: policy.budgetUsd !== undefined && estimatedUsd > policy.budgetUsd,
    cappedByMaxResults: posts < input.posts || users < (input.users ?? 0),
  };
}

export function deriveXSearchId(query: string, mode: XSearchMode = 'recent'): string {
  return createHash('sha256').update(`${mode}\0${query}`).digest('hex').slice(0, 16);
}

export class XSearchClient {
  private readonly bearerToken: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly now: () => Date;

  constructor(options: XSearchClientOptions) {
    this.bearerToken = options.bearerToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis) as FetchLike;
    this.baseUrl = validateXBaseUrl(options.baseUrl ?? 'https://api.x.com');
    this.requestTimeoutMs = validateRequestTimeoutMs(options.requestTimeoutMs ?? X_DEFAULT_REQUEST_TIMEOUT_MS);
    this.now = options.now ?? (() => new Date());
  }

  async search(request: XSearchRequest): Promise<XSearchBundle> {
    const mode = validateXSearchMode(request.mode);
    const normalizedRequest = validateSearchRequest(request, mode);
    const searchId = normalizedRequest.id ?? deriveXSearchId(normalizedRequest.query, mode);
    const title = normalizedRequest.title ?? normalizedRequest.query;
    const requestedAt = this.now().toISOString();
    const policy = normalizedRequest.costPolicy ?? {};
    validateCostPolicy(policy);
    const requestedMaxResults = validateOptionalNonNegativeInteger(request.maxResults, 'maxResults');
    const policyMaxPostReads = validateOptionalNonNegativeInteger(policy.maxPostReads, 'costPolicy.maxPostReads');
    const maxResults = Math.min(
      requestedMaxResults ?? policyMaxPostReads ?? X_DEFAULT_MAX_POST_READS,
      policyMaxPostReads ?? X_ABSOLUTE_MAX_POST_READS,
      X_ABSOLUTE_MAX_POST_READS,
    );
    if (maxResults > 0 && maxResults < X_MIN_SEARCH_PAGE_SIZE) {
      throw new RangeError(`maxResults must be 0 or at least ${X_MIN_SEARCH_PAGE_SIZE}`);
    }
    const maxUsers = validateOptionalNonNegativeInteger(policy.maxUserReads, 'costPolicy.maxUserReads')
      ?? X_DEFAULT_MAX_USER_READS;

    const posts: XPost[] = [];
    const usersById = new Map<string, XUser>();
    const rawResponses: XSearchApiResponse[] = [];
    let nextToken: string | undefined = normalizedRequest.nextToken;
    let totalEstimatedUsd = 0;
    let pagesFetched = 0;
    const hasUserExpansion = requestsUserExpansion(normalizedRequest.expansions ?? X_DEFAULT_EXPANSIONS);

    while (posts.length < maxResults && pagesFetched < X_ABSOLUTE_MAX_PAGES) {
      const remaining = maxResults - posts.length;
      const pageSize = Math.min(endpointPageSize(mode), Math.max(X_MIN_SEARCH_PAGE_SIZE, remaining));
      const nextPagePostEstimate = pageSize;
      const nextPageUserEstimate = hasUserExpansion
        ? Math.max(0, Math.min(maxUsers - usersById.size, pageSize))
        : 0;
      const nextPageCost = estimateXSearchCost({
        posts: nextPagePostEstimate,
        users: nextPageUserEstimate,
        policy,
      }).estimatedUsd;
      if (policy.budgetUsd !== undefined && roundUsd(totalEstimatedUsd + nextPageCost) > policy.budgetUsd) {
        break;
      }

      const url = buildSearchUrl(this.baseUrl, normalizedRequest, mode, pageSize, nextToken);
      const timeout = this.startRequestTimeout();
      let response: XSearchResponse;
      let json: unknown;
      try {
        response = await this.fetchWithTimeout(url, timeout);
        if (!response.ok) {
          const errorBody = await this.readErrorBodyWithTimeout(response, timeout);
          throw new Error(`X search request failed with ${response.status} ${response.statusText}: ${summarizeXErrorBody(errorBody)}`);
        }
        json = await this.readJsonWithTimeout(response, timeout);
      } finally {
        timeout.clear();
      }

      const parsed = parseSearchApiResponse(json);
      pagesFetched += 1;
      rawResponses.push(parsed);
      const pagePosts = parsed.data ?? [];
      for (const post of pagePosts) {
        if (posts.length >= maxResults) break;
        posts.push(post);
      }
      for (const user of parsed.includes?.users ?? []) {
        if (usersById.size >= maxUsers) break;
        usersById.set(user.id, user);
      }
      totalEstimatedUsd = estimateXSearchCost({ posts: posts.length, users: usersById.size, policy }).estimatedUsd;
      nextToken = parsed.meta?.next_token;
      if (!nextToken || pagePosts.length === 0) {
        break;
      }
    }

    const users = [...usersById.values()];
    const costEstimate = estimateXSearchCost({ posts: posts.length, users: users.length, policy });
    const endpoint = mode === 'archive' ? '/2/tweets/search/all' : '/2/tweets/search/recent';
    const run: XSearchRun = {
      id: searchId,
      title,
      query: normalizedRequest.query,
      mode,
      requestedAt,
      ...(nextToken ? { nextToken } : {}),
      resultCount: posts.length,
      costEstimate,
      ...(policy.budgetUsd !== undefined ? { budgetUsd: policy.budgetUsd } : {}),
      source: {
        provider: 'x',
        endpoint,
        docs: 'https://docs.x.com/x-api/posts/search/introduction',
      },
    };
    const results: XSearchResult[] = posts.map((post, index) => ({
      id: post.id,
      searchId,
      postId: post.id,
      rank: index + 1,
      matchedAt: requestedAt,
      canonicalPath: xPostPath(post.id, post.text),
      query: normalizedRequest.query,
    }));

    return { run, posts, users, results, rawResponses };
  }

  private startRequestTimeout(): {
    controller: AbortController;
    expired: Promise<never>;
    clear(): void;
  } {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new XSearchTimeoutError(this.requestTimeoutMs));
      }, this.requestTimeoutMs);
    });
    return {
      controller,
      expired,
      clear() {
        if (timeout) clearTimeout(timeout);
      },
    };
  }

  private async fetchWithTimeout(
    url: string,
    timeout: { controller: AbortController; expired: Promise<never> },
  ): ReturnType<FetchLike> {
    return Promise.race([
      this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
        signal: timeout.controller.signal,
      }),
      timeout.expired,
    ]);
  }

  private async readJsonWithTimeout(
    response: XSearchResponse,
    timeout: { expired: Promise<never> },
  ): Promise<unknown> {
    return Promise.race([
      response.json(),
      timeout.expired,
    ]);
  }

  private async readErrorBodyWithTimeout(
    response: XSearchResponse,
    timeout: { expired: Promise<never> },
  ): Promise<unknown> {
    try {
      return await this.readJsonWithTimeout(response, timeout);
    } catch (error) {
      if (error instanceof XSearchTimeoutError) throw error;
      return 'provider returned a non-JSON error body';
    }
  }
}

function validateXBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'api.x.com') {
    throw new Error('X baseUrl must use the https://api.x.com origin');
  }
  return url.origin;
}

function validateRequestTimeoutMs(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new RangeError('requestTimeoutMs must be a positive finite integer');
  }
  return value;
}

function validateXSearchMode(value: unknown): XSearchMode {
  if (value === undefined) return 'recent';
  if (value === 'recent' || value === 'archive') return value;
  throw new RangeError('mode must be either "recent" or "archive"');
}

function summarizeXErrorBody(value: unknown): string {
  let summary: string;
  if (isRecord(value)) {
    const title = typeof value.title === 'string' ? value.title : undefined;
    const detail = typeof value.detail === 'string' ? value.detail : undefined;
    const errors = Array.isArray(value.errors)
      ? value.errors
        .filter(isRecord)
        .map((error) => [error.title, error.detail, error.message].filter((part): part is string => typeof part === 'string').join(': '))
        .filter(Boolean)
      : [];
    summary = [title, detail, ...errors].filter(Boolean).join('; ') || 'provider returned an error body';
  } else {
    summary = String(value);
  }
  return summary.length > 300 ? `${summary.slice(0, 300)}...` : summary;
}

function validateSearchRequest(request: XSearchRequest, mode: XSearchMode): XSearchRequest {
  const query = validateQuery(request.query, mode);
  return {
    ...request,
    query,
    ...(request.id !== undefined ? { id: validateOptionalToken(request.id, 'id') } : {}),
    ...(request.title !== undefined ? { title: validateOptionalFreeText(request.title, 'title', 256) } : {}),
    ...(request.nextToken !== undefined ? { nextToken: validateOptionalToken(request.nextToken, 'nextToken') } : {}),
    ...(request.sinceId !== undefined ? { sinceId: validateSnowflake(request.sinceId, 'sinceId') } : {}),
    ...(request.untilId !== undefined ? { untilId: validateSnowflake(request.untilId, 'untilId') } : {}),
    ...(request.startTime !== undefined ? { startTime: validateIsoDateTime(request.startTime, 'startTime') } : {}),
    ...(request.endTime !== undefined ? { endTime: validateIsoDateTime(request.endTime, 'endTime') } : {}),
    ...(request.expansions !== undefined ? { expansions: validateFieldList(request.expansions, 'expansions') } : {}),
    ...(request.tweetFields !== undefined ? { tweetFields: validateFieldList(request.tweetFields, 'tweetFields') } : {}),
    ...(request.userFields !== undefined ? { userFields: validateFieldList(request.userFields, 'userFields') } : {}),
    ...(request.mediaFields !== undefined ? { mediaFields: validateFieldList(request.mediaFields, 'mediaFields') } : {}),
  };
}

function validateQuery(query: string, mode: XSearchMode): string {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new RangeError('query must be a non-empty string');
  }
  const maxLength = mode === 'archive' ? X_ARCHIVE_QUERY_MAX_LENGTH : X_RECENT_QUERY_MAX_LENGTH;
  if (trimmed.length > maxLength) {
    throw new RangeError(`query must be ${maxLength} characters or fewer for ${mode} search`);
  }
  return trimmed;
}

function validateOptionalFreeText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new RangeError(`${label} must be a non-empty string when provided`);
  }
  if (trimmed.length > maxLength) {
    throw new RangeError(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function validateOptionalToken(value: string, label: string): string {
  const trimmed = validateOptionalFreeText(value, label, X_OPTIONAL_TOKEN_MAX_LENGTH);
  if (!/^[A-Za-z0-9._:-]+$/u.test(trimmed)) {
    throw new RangeError(`${label} contains unsupported characters`);
  }
  return trimmed;
}

function validateSnowflake(value: string, label: string): string {
  const trimmed = validateOptionalFreeText(value, label, 32);
  if (!/^\d+$/u.test(trimmed)) {
    throw new RangeError(`${label} must be a numeric X id`);
  }
  return trimmed;
}

function validateIsoDateTime(value: string, label: string): string {
  const trimmed = validateOptionalFreeText(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(trimmed) || Number.isNaN(Date.parse(trimmed))) {
    throw new RangeError(`${label} must be an ISO-8601 timestamp`);
  }
  return trimmed;
}

function validateFieldList(values: readonly string[], label: string): readonly string[] {
  if (values.length > X_FIELD_LIST_MAX_ITEMS) {
    throw new RangeError(`${label} must contain ${X_FIELD_LIST_MAX_ITEMS} items or fewer`);
  }
  return values.map((value, index) => {
    const trimmed = validateOptionalFreeText(value, `${label}[${index}]`, X_FIELD_NAME_MAX_LENGTH);
    if (!/^[a-z][a-z0-9_.]*$/u.test(trimmed)) {
      throw new RangeError(`${label}[${index}] contains unsupported characters`);
    }
    return trimmed;
  });
}

function buildSearchUrl(
  baseUrl: string,
  request: XSearchRequest,
  mode: XSearchMode,
  maxResults: number,
  nextToken: string | undefined,
): string {
  const endpoint = mode === 'archive' ? '/2/tweets/search/all' : '/2/tweets/search/recent';
  const url = new URL(endpoint, baseUrl);
  url.searchParams.set('query', request.query);
  url.searchParams.set('max_results', String(maxResults));
  setListParam(url, 'tweet.fields', request.tweetFields ?? X_DEFAULT_TWEET_FIELDS);
  const expansions = request.expansions ?? X_DEFAULT_EXPANSIONS;
  setListParam(url, 'expansions', expansions);
  if (requestsUserExpansion(expansions)) {
    setListParam(url, 'user.fields', request.userFields ?? X_DEFAULT_USER_FIELDS);
  }
  setListParam(url, 'media.fields', request.mediaFields);
  setOptionalParam(url, 'pagination_token', nextToken);
  setOptionalParam(url, 'since_id', request.sinceId);
  setOptionalParam(url, 'until_id', request.untilId);
  setOptionalParam(url, 'start_time', request.startTime);
  setOptionalParam(url, 'end_time', request.endTime);
  return url.toString();
}

function endpointPageSize(mode: XSearchMode): number {
  return mode === 'archive' ? 500 : 100;
}

function validateOptionalNonNegativeInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative integer`);
  }
  return value;
}

function validateOptionalNonNegativeNumber(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`);
  }
}

function validateCostPolicy(policy: XSearchCostPolicy): void {
  validateOptionalNonNegativeInteger(policy.maxPostReads, 'costPolicy.maxPostReads');
  validateOptionalNonNegativeInteger(policy.maxUserReads, 'costPolicy.maxUserReads');
  validateOptionalNonNegativeNumber(policy.budgetUsd, 'costPolicy.budgetUsd');
  validateOptionalNonNegativeNumber(policy.postReadUnitUsd, 'costPolicy.postReadUnitUsd');
  validateOptionalNonNegativeNumber(policy.userReadUnitUsd, 'costPolicy.userReadUnitUsd');
}

function requestsUserExpansion(expansions: readonly string[]): boolean {
  return expansions.some((expansion) => (
    X_USER_HYDRATING_EXPANSIONS.has(expansion)
    || expansion.endsWith('_user_id')
  ));
}

function setListParam(url: URL, key: string, value: readonly string[] | undefined): void {
  if (value && value.length > 0) {
    url.searchParams.set(key, value.join(','));
  }
}

function setOptionalParam(url: URL, key: string, value: string | undefined): void {
  if (value !== undefined && value.trim()) {
    url.searchParams.set(key, value);
  }
}

function parseSearchApiResponse(value: unknown): XSearchApiResponse {
  if (!isRecord(value)) {
    throw new Error('X search response must be a JSON object.');
  }
  const data = Array.isArray(value.data) ? value.data.filter(isXPost) : undefined;
  const includes = isRecord(value.includes) ? value.includes : undefined;
  const users = includes && Array.isArray(includes.users) ? includes.users.filter(isXUser) : undefined;
  const tweets = includes && Array.isArray(includes.tweets) ? includes.tweets.filter(isXPost) : undefined;
  const media = includes && Array.isArray(includes.media) ? includes.media.filter(isRecord) : undefined;
  const places = includes && Array.isArray(includes.places) ? includes.places.filter(isRecord) : undefined;
  const polls = includes && Array.isArray(includes.polls) ? includes.polls.filter(isRecord) : undefined;
  const meta = isRecord(value.meta) ? value.meta : undefined;
  const errors = Array.isArray(value.errors) ? value.errors.filter(isRecord) : undefined;
  return {
    ...(data ? { data } : {}),
    ...(includes ? {
      includes: {
        ...(users ? { users } : {}),
        ...(tweets ? { tweets } : {}),
        ...(media ? { media } : {}),
        ...(places ? { places } : {}),
        ...(polls ? { polls } : {}),
      },
    } : {}),
    ...(meta ? { meta: normalizeMeta(meta) } : {}),
    ...(errors ? { errors } : {}),
  };
}

function normalizeMeta(meta: Record<string, unknown>) {
  return {
    ...(typeof meta.newest_id === 'string' ? { newest_id: meta.newest_id } : {}),
    ...(typeof meta.oldest_id === 'string' ? { oldest_id: meta.oldest_id } : {}),
    ...(typeof meta.result_count === 'number' ? { result_count: meta.result_count } : {}),
    ...(typeof meta.next_token === 'string' ? { next_token: meta.next_token } : {}),
  };
}

function isXPost(value: unknown): value is XPost {
  return isRecord(value) && typeof value.id === 'string' && typeof value.text === 'string';
}

function isXUser(value: unknown): value is XUser {
  return isRecord(value) && typeof value.id === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function roundUsd(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}
