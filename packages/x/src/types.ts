import type { XSearchMode } from './path-mapper.js';

export interface XPublicMetrics {
  retweet_count?: number;
  reply_count?: number;
  like_count?: number;
  quote_count?: number;
  bookmark_count?: number;
  impression_count?: number;
}

export interface XReferencedPost {
  type: 'retweeted' | 'quoted' | 'replied_to';
  id: string;
}

export interface XPost {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  lang?: string;
  possibly_sensitive?: boolean;
  public_metrics?: XPublicMetrics;
  referenced_tweets?: XReferencedPost[];
  entities?: Record<string, unknown>;
  attachments?: Record<string, unknown>;
  edit_history_tweet_ids?: string[];
  [key: string]: unknown;
}

export interface XUser {
  id: string;
  username?: string;
  name?: string;
  verified?: boolean;
  verified_type?: string;
  profile_image_url?: string;
  description?: string;
  public_metrics?: XPublicMetrics;
  [key: string]: unknown;
}

export interface XSearchCostPolicy {
  /**
   * Hard cap for a single search run. The adapter estimates with configured
   * unit costs before each page request and stops before crossing this value.
   */
  budgetUsd?: number;
  /** Default pay-per-use Post read cost visible in the X developer console. */
  postReadUnitUsd?: number;
  /** Default pay-per-use User read cost visible in the X developer console. */
  userReadUnitUsd?: number;
  /** Maximum posts to return for a run, independent of budget. */
  maxPostReads?: number;
  /** Maximum included users to retain. Keeps author hydration from dominating spend. */
  maxUserReads?: number;
}

export interface XSearchRequest {
  id?: string;
  title?: string;
  query: string;
  mode?: XSearchMode;
  maxResults?: number;
  nextToken?: string;
  sinceId?: string;
  untilId?: string;
  startTime?: string;
  endTime?: string;
  expansions?: readonly string[];
  tweetFields?: readonly string[];
  userFields?: readonly string[];
  mediaFields?: readonly string[];
  costPolicy?: XSearchCostPolicy;
}

export interface XSearchCostEstimate {
  posts: number;
  users: number;
  postReadUnitUsd: number;
  userReadUnitUsd: number;
  estimatedUsd: number;
  cappedByBudget: boolean;
  cappedByMaxResults: boolean;
}

export interface XSearchRun {
  id: string;
  title: string;
  query: string;
  mode: XSearchMode;
  requestedAt: string;
  nextToken?: string;
  resultCount: number;
  costEstimate: XSearchCostEstimate;
  budgetUsd?: number;
  source: {
    provider: 'x';
    endpoint: '/2/tweets/search/recent' | '/2/tweets/search/all';
    docs: string;
  };
}

export interface XSearchResult {
  id: string;
  searchId: string;
  postId: string;
  rank: number;
  matchedAt: string;
  canonicalPath?: string;
  query: string;
}

export interface XSearchResponseMeta {
  newest_id?: string;
  oldest_id?: string;
  result_count?: number;
  next_token?: string;
}

export interface XSearchApiResponse {
  data?: XPost[];
  includes?: {
    users?: XUser[];
    tweets?: XPost[];
    media?: Record<string, unknown>[];
    places?: Record<string, unknown>[];
    polls?: Record<string, unknown>[];
  };
  meta?: XSearchResponseMeta;
  errors?: Record<string, unknown>[];
}

export interface XSearchBundle {
  run: XSearchRun;
  posts: XPost[];
  users: XUser[];
  results: XSearchResult[];
  rawResponses: XSearchApiResponse[];
}

export interface XIndexRow {
  id: string;
  title: string;
  updated: string;
}

export interface XSearchIndexRow extends XIndexRow {
  query: string;
  mode: XSearchMode;
  resultCount: number;
  estimatedUsd: number;
}

export interface XPostIndexRow extends XIndexRow {
  authorId?: string;
  username?: string;
  conversationId?: string;
  lang?: string;
  likeCount?: number;
  replyCount?: number;
  repostCount?: number;
}

export interface XUserIndexRow extends XIndexRow {
  username?: string;
  verified?: boolean;
}
