import type {
  ConnectionProvider as RelayConnectionProvider,
  WritebackItem,
} from '@relayfile/sdk';

import { GITHUB_API_BASE_URL } from './config.js';
import {
  GITHUB_REVIEW_EVENTS,
  GITHUB_REVIEW_SIDES,
  type AgentComment,
  type AgentReview,
  type GitHubCreateReviewInput,
  type GitHubProxyProvider,
  type JsonObject,
  type JsonValue,
  type ProxyResponse,
  type WritebackPathTarget,
  type WritebackResult,
} from './types.js';

const DEFAULT_PROVIDER_CONFIG_KEY = 'github-app-oauth';
const REVIEW_WRITEBACK_PATH =
  /^\/github\/repos\/([^/]+)\/([^/]+)\/pulls\/([1-9]\d*)\/reviews\/[^/]+(?:\.json)?$/;

interface GitHubReviewResponse {
  id: number;
}

interface GitHubWritebackHandlerOptions {
  defaultConnectionId?: string;
  defaultProviderConfigKey?: string;
  resolveConnectionId?: (workspaceId: string) => Promise<string> | string;
}

/**
 * Handles Relayfile writebacks that target GitHub pull request reviews.
 *
 * @see https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request
 */
export class GitHubWritebackHandler {
  private readonly provider: GitHubProxyProvider;
  private readonly defaultConnectionId?: string;
  private readonly defaultProviderConfigKey: string;
  private readonly resolveConnectionId?: (workspaceId: string) => Promise<string> | string;

  constructor(provider: GitHubProxyProvider, options: GitHubWritebackHandlerOptions = {}) {
    this.provider = provider;
    this.defaultConnectionId = options.defaultConnectionId;
    this.defaultProviderConfigKey =
      options.defaultProviderConfigKey ?? DEFAULT_PROVIDER_CONFIG_KEY;
    this.resolveConnectionId = options.resolveConnectionId;
  }

  canHandle(path: string): boolean {
    return path.startsWith('/github/');
  }

  async execute(item: WritebackItem, provider: RelayConnectionProvider): Promise<void> {
    const connectionId = await this.resolveConnectionIdFromWorkspace(item.workspaceId);
    const target = this.extractWritebackTarget(item.path);
    const response = await provider.proxy({
      method: 'POST',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${target.owner}/${target.repo}/pulls/${target.prNumber}/reviews`,
      connectionId,
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'Provider-Config-Key': this.defaultProviderConfigKey,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (response.status >= 400) {
      throw new Error(formatQueuedWritebackError(item.path, response));
    }
  }

  parseReviewPayload(content: string): AgentReview {
    let parsed: JsonValue;

    try {
      parsed = JSON.parse(content) as JsonValue;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown JSON parse failure';
      throw new Error(`Invalid review JSON: ${message}`);
    }

    const reviewObject = expectObject(parsed, 'Review payload');
    const event = expectReviewEvent(readString(reviewObject, 'event', 'Review payload'));
    const body = readString(reviewObject, 'body', 'Review payload');
    const commentsValue = reviewObject.comments;
    if (!Array.isArray(commentsValue)) {
      throw new Error('Review payload.comments must be an array');
    }

    const comments = commentsValue.map((commentValue, index) =>
      parseAgentComment(commentValue, index),
    );

    const metadataValue = reviewObject.metadata;
    const metadata = metadataValue === undefined ? undefined : parseReviewMetadata(metadataValue);

    return {
      event,
      body,
      comments,
      metadata,
    };
  }

  toGitHubReview(review: AgentReview): GitHubCreateReviewInput {
    return {
      event: review.event,
      body: review.body,
      comments: review.comments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: comment.side,
        body: buildCommentBody(comment),
      })),
    };
  }

  extractWritebackTarget(path: string): WritebackPathTarget {
    const match = path.match(REVIEW_WRITEBACK_PATH);
    if (!match) {
      throw new Error(
        `Unsupported GitHub writeback path: ${path}. Expected /github/repos/{owner}/{repo}/pulls/{n}/reviews/...`,
      );
    }

    const [, ownerSegment, repoSegment, prNumberSegment] = match;
    const prNumber = Number.parseInt(prNumberSegment, 10);

    return {
      owner: decodeURIComponent(ownerSegment),
      repo: decodeURIComponent(repoSegment),
      prNumber,
    };
  }

  async submitReview(
    owner: string,
    repo: string,
    prNumber: number,
    review: AgentReview,
    provider: GitHubProxyProvider = this.provider,
    connectionId?: string,
  ): Promise<ProxyResponse> {
    const mappedReview = this.toGitHubReview(review);
    const resolvedConnectionId =
      connectionId ?? review.metadata?.connectionId?.trim() ?? this.defaultConnectionId;

    if (!resolvedConnectionId) {
      throw new Error(
        'Missing GitHub connection id. Provide metadata.connectionId or configure the handler with a resolver/default.',
      );
    }

    const payload = createSubmitPayload(mappedReview, review.metadata?.commitSha);

    return provider.proxy({
      method: 'POST',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      connectionId: resolvedConnectionId,
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'Provider-Config-Key':
          review.metadata?.providerConfigKey ?? this.defaultProviderConfigKey,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: payload,
    });
  }

  async handleWriteback(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<WritebackResult> {
    try {
      const target = this.extractWritebackTarget(path);
      const review = this.parseReviewPayload(content);
      const connectionId = await this.resolveConnectionIdFromWorkspace(workspaceId, review);
      const response = await this.submitReview(
        target.owner,
        target.repo,
        target.prNumber,
        review,
        this.provider,
        connectionId,
      );

      if (response.status >= 400) {
        return {
          success: false,
          error: formatProviderError(response),
        };
      }

      const externalId = extractReviewId(response.data);
      if (!externalId) {
        return {
          success: false,
          error: 'GitHub review submission succeeded but did not return a review id',
        };
      }

      return {
        success: true,
        externalId,
      };
    } catch (error) {
      return {
        success: false,
        error: formatThrownError(error),
      };
    }
  }

  async writeBack(
    workspaceId: string,
    path: string,
    content: string,
  ): Promise<WritebackResult> {
    return this.handleWriteback(workspaceId, path, content);
  }

  private async resolveConnectionIdFromWorkspace(
    workspaceId: string,
    review?: AgentReview,
  ): Promise<string> {
    const metadataConnectionId = review?.metadata?.connectionId?.trim();
    if (metadataConnectionId) {
      return metadataConnectionId;
    }

    if (this.resolveConnectionId) {
      const resolved = await this.resolveConnectionId(workspaceId);
      const trimmed = resolved.trim();
      if (trimmed) {
        return trimmed;
      }
    }

    if (this.defaultConnectionId) {
      return this.defaultConnectionId;
    }

    throw new Error(
      `Missing GitHub connection id for workspace ${workspaceId}. Configure resolveConnectionId or defaultConnectionId.`,
    );
  }
}

function parseAgentComment(value: JsonValue, index: number): AgentComment {
  const context = `Review payload.comments[${index}]`;
  const commentObject = expectObject(value, context);
  const path = readString(commentObject, 'path', context);
  const line = readPositiveInteger(commentObject, 'line', context);
  const body = readString(commentObject, 'body', context);
  const side = commentObject.side === undefined ? 'RIGHT' : expectReviewSide(commentObject.side);
  const suggestion =
    commentObject.suggestion === undefined
      ? undefined
      : readOptionalString(commentObject, 'suggestion', context);

  return {
    path,
    line,
    side,
    body,
    suggestion,
  };
}

function parseReviewMetadata(value: JsonValue): AgentReview['metadata'] {
  const metadataObject = expectObject(value, 'Review payload.metadata');

  return {
    commitSha: optionalTrimmedString(metadataObject.commitSha, 'Review payload.metadata.commitSha'),
    connectionId: optionalTrimmedString(
      metadataObject.connectionId,
      'Review payload.metadata.connectionId',
    ),
    providerConfigKey: optionalTrimmedString(
      metadataObject.providerConfigKey,
      'Review payload.metadata.providerConfigKey',
    ),
  };
}

function readString(source: JsonObject, key: string, context: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }

  return value;
}

function readOptionalString(source: JsonObject, key: string, context: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string when provided`);
  }

  return value;
}

function optionalTrimmedString(value: JsonValue | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string when provided`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPositiveInteger(source: JsonObject, key: string, context: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${context}.${key} must be a positive integer`);
  }

  return value;
}

function expectObject(value: JsonValue, context: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${context} must be an object`);
  }

  return value;
}

function expectReviewEvent(value: string): AgentReview['event'] {
  if (GITHUB_REVIEW_EVENTS.includes(value as AgentReview['event'])) {
    return value as AgentReview['event'];
  }

  throw new Error(`Review payload.event must be one of ${GITHUB_REVIEW_EVENTS.join(', ')}`);
}

function expectReviewSide(value: JsonValue): AgentComment['side'] {
  if (typeof value === 'string' && GITHUB_REVIEW_SIDES.includes(value as AgentComment['side'])) {
    return value as AgentComment['side'];
  }

  throw new Error(`Review comment.side must be one of ${GITHUB_REVIEW_SIDES.join(', ')}`);
}

function buildCommentBody(comment: AgentComment): string {
  if (!comment.suggestion) {
    return comment.body;
  }

  return `${comment.body}\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``;
}

function createSubmitPayload(
  review: GitHubCreateReviewInput,
  commitSha?: string,
): JsonObject {
  const payload: JsonObject = {
    event: review.event,
    body: review.body,
    comments: review.comments.map(
      (comment): JsonObject => ({
        path: comment.path,
        line: comment.line,
        side: comment.side,
        body: comment.body,
      }),
    ),
  };

  if (commitSha) {
    payload.commit_id = commitSha;
  }

  return payload;
}

function extractReviewId(value: JsonValue | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const responseObject = expectObject(value, 'GitHub review response') as JsonObject;
  const id = responseObject.id;
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    return undefined;
  }

  const typedId: GitHubReviewResponse['id'] = id;
  return String(typedId);
}

function formatProviderError(response: ProxyResponse): string {
  const baseMessage = `GitHub review submission failed with status ${response.status}`;
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

function formatQueuedWritebackError(
  path: string,
  response: { status: number; data: unknown },
): string {
  const baseMessage = `GitHub writeback failed for ${path} with status ${response.status}`;
  const responseData = response.data;

  if (responseData === null) {
    return baseMessage;
  }

  if (typeof responseData === 'string' && responseData.trim().length > 0) {
    return `${baseMessage}: ${responseData}`;
  }

  if (!Array.isArray(responseData) && typeof responseData === 'object') {
    const message = (responseData as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return `${baseMessage}: ${message}`;
    }
  }

  return baseMessage;
}

function formatThrownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown writeback failure';
}

export function createGitHubWritebackHandler(
  provider: GitHubProxyProvider,
  options?: GitHubWritebackHandlerOptions,
): GitHubWritebackHandler {
  return new GitHubWritebackHandler(provider, options);
}
