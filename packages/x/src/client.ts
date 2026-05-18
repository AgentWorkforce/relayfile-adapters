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
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}>;

export interface XSearchClientOptions {
  bearerToken: string;
  fetch?: FetchLike;
  baseUrl?: string;
  now?: () => Date;
}

export const X_DEFAULT_POST_READ_UNIT_USD = 0.005;
export const X_DEFAULT_USER_READ_UNIT_USD = 0.010;
export const X_DEFAULT_MAX_POST_READS = 100;
export const X_DEFAULT_MAX_USER_READS = 25;

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
  private readonly now: () => Date;

  constructor(options: XSearchClientOptions) {
    this.bearerToken = options.bearerToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis) as FetchLike;
    this.baseUrl = options.baseUrl ?? 'https://api.x.com';
    this.now = options.now ?? (() => new Date());
  }

  async search(request: XSearchRequest): Promise<XSearchBundle> {
    const mode = request.mode ?? 'recent';
    const searchId = request.id ?? deriveXSearchId(request.query, mode);
    const title = request.title ?? request.query;
    const requestedAt = this.now().toISOString();
    const policy = request.costPolicy ?? {};
    const maxResults = Math.min(
      request.maxResults ?? policy.maxPostReads ?? X_DEFAULT_MAX_POST_READS,
      policy.maxPostReads ?? Number.POSITIVE_INFINITY,
    );
    const maxUsers = policy.maxUserReads ?? X_DEFAULT_MAX_USER_READS;

    const posts: XPost[] = [];
    const usersById = new Map<string, XUser>();
    const rawResponses: XSearchApiResponse[] = [];
    let nextToken: string | undefined = request.nextToken;
    let totalEstimatedUsd = 0;

    while (posts.length < maxResults) {
      const pageSize = Math.min(endpointPageSize(mode), maxResults - posts.length);
      const nextPagePostEstimate = pageSize;
      const nextPageUserEstimate = Math.max(0, Math.min(maxUsers - usersById.size, pageSize));
      const nextPageCost = estimateXSearchCost({
        posts: nextPagePostEstimate,
        users: nextPageUserEstimate,
        policy,
      }).estimatedUsd;
      if (policy.budgetUsd !== undefined && roundUsd(totalEstimatedUsd + nextPageCost) > policy.budgetUsd) {
        break;
      }

      const url = buildSearchUrl(this.baseUrl, request, mode, pageSize, nextToken);
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(`X search request failed with ${response.status} ${response.statusText}: ${JSON.stringify(json)}`);
      }

      const parsed = parseSearchApiResponse(json);
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
      query: request.query,
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
      query: request.query,
    }));

    return { run, posts, users, results, rawResponses };
  }
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
  setListParam(url, 'expansions', request.expansions ?? X_DEFAULT_EXPANSIONS);
  setListParam(url, 'user.fields', request.userFields ?? X_DEFAULT_USER_FIELDS);
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
  const meta = isRecord(value.meta) ? value.meta : undefined;
  const errors = Array.isArray(value.errors) ? value.errors.filter(isRecord) : undefined;
  return {
    ...(data ? { data } : {}),
    ...(includes ? { includes: { ...(users ? { users } : {}), ...(tweets ? { tweets } : {}) } } : {}),
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
