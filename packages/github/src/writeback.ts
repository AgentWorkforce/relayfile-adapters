import { withProxyRetry } from '@relayfile/adapter-core/http';
import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import { GITHUB_API_BASE_URL } from './config.js';
import { resources } from './resources.js';
import {
  GITHUB_REVIEW_EVENTS,
  GITHUB_REVIEW_SIDES,
  type AgentComment,
  type AgentReview,
  type AgentReviewMetadata,
  type GitHubIssueCommentWritebackInput,
  type GitHubIssueWritebackInput,
  type GitHubMergeMethod,
  type GitHubMergePullRequestWritebackInput,
  type GitHubRequestProvider,
  type GitHubCreateReviewInput,
  type JsonObject,
  type JsonValue,
  type ProxyRequest,
  type ProxyResponse,
  type WritebackPathTarget,
  type WritebackResult,
} from './types.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

const DEFAULT_PROVIDER_CONFIG_KEY = 'github-app-oauth';
// PR segment is emitted by `githubNumberSlug` as either a bare `<number>` or
// `<number>__<slug>` (when the PR title is known). Capture the leading number
// and tolerate an optional `__<slug>` suffix on the same segment.
const REVIEW_WRITEBACK_PATH =
  /^\/github\/repos\/([^/]+)\/([^/]+)\/pulls\/([1-9]\d*)(?:__[^/]+)?\/reviews\/([^/]+?)(?:\.json)?$/;
const MERGE_WRITEBACK_PATH =
  /^\/github\/repos\/([^/]+)\/([^/]+)\/pulls\/([1-9]\d*)(?:__[^/]+)?\/merge\.json$/;
const ISSUE_WRITEBACK_PATH =
  /^\/github\/repos\/([^/]+)\/([^/]+)\/issues\/([^/]+?)(?:\.json)?$/;
// Issue comments are directory records (`comments/<id>/meta.json`); accept the
// legacy flat leaf (`comments/<id>.json`) too so writebacks against a
// pre-migration mirror still resolve. Create drafts (`comments/<draft>.json`)
// continue to match via the bare `<segment>.json` alternative.
const ISSUE_COMMENT_WRITEBACK_PATH =
  /^\/github\/repos\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)(?:__[^/]+)?\/comments\/([^/]+?)(?:\.json|\/meta\.json)?$/;
// PR review comment reply — `POST /repos/{owner}/{repo}/pulls/{n}/comments/{comment_id}/replies`
const PR_COMMENT_REPLY_WRITEBACK_PATH =
  /^\/github\/repos\/([^/]+)\/([^/]+)\/pulls\/([1-9]\d*)(?:__[^/]+)?\/comments\/([1-9]\d*)\/replies(?:\/[^/]+(?:\.json)?)?$/;

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
  private readonly provider: GitHubRequestProvider;
  private readonly defaultConnectionId?: string;
  private readonly defaultProviderConfigKey: string;
  private readonly resolveConnectionId?: (workspaceId: string) => Promise<string> | string;

  constructor(provider: GitHubRequestProvider, options: GitHubWritebackHandlerOptions = {}) {
    this.provider = provider;
    this.defaultConnectionId = options.defaultConnectionId;
    this.defaultProviderConfigKey =
      options.defaultProviderConfigKey ?? DEFAULT_PROVIDER_CONFIG_KEY;
    this.resolveConnectionId = options.resolveConnectionId;
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

    const [, ownerSegment, repoSegment, prNumberSegment, reviewSegment] = match;
    const prNumber = Number.parseInt(prNumberSegment, 10);
    const reviewId = decodeURIComponent(reviewSegment.replace(/\.json$/, ''));
    const route = classifyWrite(path, resources);

    return {
      owner: decodeURIComponent(ownerSegment),
      repo: decodeURIComponent(repoSegment),
      prNumber,
      ...(route?.kind === 'patch' ? { reviewId } : {}),
    };
  }

  async submitReview(
    owner: string,
    repo: string,
    prNumber: number,
    review: AgentReview,
    provider: GitHubRequestProvider = this.provider,
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

    return withProxyRetry(provider).proxy({
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
      const mergeTarget = extractMergeTarget(path);
      if (mergeTarget) {
        const payload = parseMergePayload(content);
        const response = await this.mergePullRequest(mergeTarget, payload, workspaceId);
        if (response.status >= 400) {
          return {
            success: false,
            error: formatProviderError(response, 'GitHub pull request merge failed'),
          };
        }
        const externalId = extractMergeSha(response.data);
        return {
          success: true,
          ...(externalId ? { externalId } : {}),
        };
      }

      const target = this.extractWritebackTarget(path);
      const reviewId = target.reviewId;
      if (reviewId) {
        const payload = parseReviewUpdatePayload(content);
        const response = await this.updateReview({ ...target, reviewId }, payload, workspaceId);
        if (response.status >= 400) {
          return {
            success: false,
            error: formatProviderError(response),
          };
        }
        return {
          success: true,
          externalId: extractReviewId(response.data) ?? target.reviewId,
        };
      }
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
    review: AgentReview,
  ): Promise<string> {
    return this.resolveConnectionIdFromMetadata(workspaceId, review.metadata);
  }

  private async resolveConnectionIdFromMetadata(
    workspaceId: string,
    metadata?: AgentReviewMetadata,
  ): Promise<string> {
    const metadataConnectionId = metadata?.connectionId?.trim();
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

  private async updateReview(
    target: WritebackPathTarget & { reviewId: string },
    payload: { body: string; metadata?: AgentReviewMetadata },
    workspaceId: string,
  ): Promise<ProxyResponse> {
    const connectionId = payload.metadata?.connectionId?.trim() || (await this.resolveConnectionIdFromWorkspace(workspaceId, { body: payload.body, comments: [], event: 'COMMENT', metadata: payload.metadata }));
    return withProxyRetry(this.provider).proxy({
      method: 'PATCH',
      baseUrl: GITHUB_API_BASE_URL,
      endpoint: `/repos/${target.owner}/${target.repo}/pulls/${target.prNumber}/reviews/${encodeURIComponent(target.reviewId)}`,
      connectionId,
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'Provider-Config-Key': payload.metadata?.providerConfigKey ?? this.defaultProviderConfigKey,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: { body: payload.body },
    });
  }

  private async mergePullRequest(
    target: { owner: string; repo: string; prNumber: number },
    payload: GitHubMergePullRequestWritebackInput,
    workspaceId: string,
  ): Promise<ProxyResponse> {
    const request = buildMergePullRequest(target, payload);
    const connectionId = await this.resolveConnectionIdFromMetadata(workspaceId, payload.metadata);
    return withProxyRetry(this.provider).proxy({
      ...request,
      connectionId,
      headers: {
        ...request.headers,
        'Provider-Config-Key': payload.metadata?.providerConfigKey ?? this.defaultProviderConfigKey,
      },
    });
  }
}

/**
 * Build a `DELETE /repos/{owner}/{repo}/pulls/{n}/reviews/{id}` request.
 *
 * Caller contract — the returned `ProxyRequest.connectionId` is left as the
 * empty string. Unlike `submitReview`/`updateReview` (which run inside the
 * `GitHubWritebackHandler` instance and resolve a connection id from the
 * configured workspace), this is a free function with no instance state, so
 * the caller must populate `connectionId` from its own metadata before
 * invoking the request. This matches the pattern used by every other
 * adapter's `resolveDeleteRequest`.
 */
export function resolveDeleteRequest(path: string): ProxyRequest {
  const match = path.match(REVIEW_WRITEBACK_PATH);
  const route = classifyWrite(path, resources, { fsEvent: 'delete' });
  if (!match || route?.kind !== 'delete') {
    throw new Error(`Unsupported GitHub delete writeback path: ${path}`);
  }
  const [, ownerSegment, repoSegment, prNumberSegment, reviewSegment] = match;
  return {
    method: 'DELETE',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${decodeURIComponent(ownerSegment)}/${decodeURIComponent(repoSegment)}/pulls/${Number.parseInt(prNumberSegment, 10)}/reviews/${encodeURIComponent(decodeURIComponent(reviewSegment.replace(/\.json$/, '')))}`,
    connectionId: '',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };
}

export function resolveWritebackRequest(path: string, content: string): ProxyRequest {
  const mergeTarget = extractMergeTarget(path);
  if (mergeTarget) {
    return buildMergePullRequest(mergeTarget, parseMergePayload(content));
  }

  const route = classifyWrite(path, resources);

  if (route?.resource.name === 'issues') {
    const match = path.match(ISSUE_WRITEBACK_PATH);
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new Error(`Unsupported GitHub issue writeback path: ${path}`);
    }
    const owner = decodeGitHubPathSegment(match[1], 'owner');
    const repo = decodeGitHubPathSegment(match[2], 'repo');
    if (route.kind === 'create') {
      return buildIssueCreateRequest(owner, repo, content);
    }
    if (route.kind === 'patch') {
      const issueNumber = parsePositiveIntegerSegment(match[3], 'issue number');
      return buildIssueUpdateRequest(owner, repo, issueNumber, content);
    }
  }

  if (route?.resource.name === 'issue-comments') {
    const match = path.match(ISSUE_COMMENT_WRITEBACK_PATH);
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
      throw new Error(`Unsupported GitHub issue comment writeback path: ${path}`);
    }
    const owner = decodeGitHubPathSegment(match[1], 'owner');
    const repo = decodeGitHubPathSegment(match[2], 'repo');
    const issueNumber = Number.parseInt(match[3], 10);
    if (route.kind === 'create') {
      return buildIssueCommentCreateRequest(owner, repo, issueNumber, content);
    }
    if (route.kind === 'patch') {
      const commentId = parsePositiveIntegerSegment(match[4], 'comment id');
      return buildIssueCommentUpdateRequest(owner, repo, commentId, content);
    }
  }

  if (route?.resource.name === 'replies') {
    const match = path.match(PR_COMMENT_REPLY_WRITEBACK_PATH);
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
      throw new Error(`Unsupported GitHub PR comment reply writeback path: ${path}`);
    }
    const owner = decodeGitHubPathSegment(match[1], 'owner');
    const repo = decodeGitHubPathSegment(match[2], 'repo');
    const prNumber = Number.parseInt(match[3], 10);
    const commentId = Number.parseInt(match[4], 10);
    return buildPrCommentReplyRequest(owner, repo, prNumber, commentId, content);
  }

  throw new Error(
    `Unsupported GitHub writeback path: ${path}. Expected an issue, issue comment, pull request review, pull request merge file, or pull request review comment reply.`,
  );
}

function extractMergeTarget(path: string): { owner: string; repo: string; prNumber: number } | undefined {
  const match = path.match(MERGE_WRITEBACK_PATH);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }
  return {
    owner: decodeGitHubPathSegment(match[1], 'owner'),
    repo: decodeGitHubPathSegment(match[2], 'repo'),
    prNumber: Number.parseInt(match[3], 10),
  };
}

function buildMergePullRequest(
  target: { owner: string; repo: string; prNumber: number },
  payload: GitHubMergePullRequestWritebackInput,
): ProxyRequest {
  const body: JsonObject = {};
  if (payload.method !== undefined) body.merge_method = payload.method;
  if (payload.commitTitle !== undefined) body.commit_title = payload.commitTitle;
  if (payload.commitMessage !== undefined) body.commit_message = payload.commitMessage;
  if (payload.sha !== undefined) body.sha = payload.sha;
  return {
    method: 'PUT',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${target.owner}/${target.repo}/pulls/${target.prNumber}/merge`,
    connectionId: '',
    headers: githubJsonHeaders(),
    body,
  };
}

function buildIssueCreateRequest(owner: string, repo: string, content: string): ProxyRequest {
  const payload = parseIssuePayload(content, 'GitHub issue create payload');
  if (!payload.title) {
    throw new Error('GitHub issue create payload.title must be a non-empty string');
  }
  return {
    method: 'POST',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${owner}/${repo}/issues`,
    connectionId: '',
    headers: githubJsonHeaders(),
    body: compactIssuePayload(payload),
  };
}

function buildIssueUpdateRequest(
  owner: string,
  repo: string,
  issueNumber: number,
  content: string,
): ProxyRequest {
  const payload = parseIssuePayload(content, 'GitHub issue update payload');
  const body = compactIssuePayload(payload);
  if (Object.keys(body).length === 0) {
    throw new Error('GitHub issue update payload requires at least one mutable field');
  }
  return {
    method: 'PATCH',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${owner}/${repo}/issues/${issueNumber}`,
    connectionId: '',
    headers: githubJsonHeaders(),
    body,
  };
}

function buildIssueCommentCreateRequest(
  owner: string,
  repo: string,
  issueNumber: number,
  content: string,
): ProxyRequest {
  const payload = parseIssueCommentPayload(content, 'GitHub issue comment create payload');
  return {
    method: 'POST',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    connectionId: '',
    headers: githubJsonHeaders(),
    body: payload,
  };
}

function buildIssueCommentUpdateRequest(
  owner: string,
  repo: string,
  commentId: number,
  content: string,
): ProxyRequest {
  const payload = parseIssueCommentPayload(content, 'GitHub issue comment update payload');
  return {
    method: 'PATCH',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${owner}/${repo}/issues/comments/${commentId}`,
    connectionId: '',
    headers: githubJsonHeaders(),
    body: payload,
  };
}

function buildPrCommentReplyRequest(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  content: string,
): ProxyRequest {
  const payload = parseIssueCommentPayload(content, 'GitHub PR comment reply payload');
  return {
    method: 'POST',
    baseUrl: GITHUB_API_BASE_URL,
    endpoint: `/repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
    connectionId: '',
    headers: githubJsonHeaders(),
    body: payload,
  };
}

function parseIssuePayload(content: string, context: string): GitHubIssueWritebackInput {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse failure';
    throw new Error(`Invalid issue JSON: ${message}`);
  }

  const object = expectObject(parsed, context);
  rejectReadOnlyFields(object);
  const title = optionalTrimmedString(object.title, `${context}.title`);
  const body = optionalTrimmedString(object.body, `${context}.body`);
  const labels = optionalStringArray(object.labels, `${context}.labels`);
  const assignees = optionalStringArray(object.assignees, `${context}.assignees`);
  const milestone = optionalMilestone(object.milestone, `${context}.milestone`);
  const state = optionalIssueState(object.state, `${context}.state`);

  return { title, body, labels, assignees, milestone, state };
}

function parseIssueCommentPayload(
  content: string,
  context: string,
): GitHubIssueCommentWritebackInput {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content) as JsonValue;
  } catch {
    const body = content.trim();
    if (!body) {
      throw new Error(`${context}.body must be a non-empty string`);
    }
    return { body };
  }

  if (typeof parsed === 'string') {
    const body = parsed.trim();
    if (!body) {
      throw new Error(`${context}.body must be a non-empty string`);
    }
    return { body };
  }

  const object = expectObject(parsed, context);
  rejectReadOnlyFields(object);
  return { body: readString(object, 'body', context) };
}

function parseMergePayload(content: string): GitHubMergePullRequestWritebackInput {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse failure';
    throw new Error(`Invalid pull request merge JSON: ${message}`);
  }

  const object = expectObject(parsed, 'Pull request merge payload');
  rejectReadOnlyFields(object);
  const method = optionalMergeMethod(
    object.method ?? object.merge_method,
    'Pull request merge payload.method',
  );
  const commitTitle =
    optionalTrimmedString(object.commitTitle, 'Pull request merge payload.commitTitle') ??
    optionalTrimmedString(object.commit_title, 'Pull request merge payload.commit_title');
  const commitMessage =
    optionalTrimmedString(object.commitMessage, 'Pull request merge payload.commitMessage') ??
    optionalTrimmedString(object.commit_message, 'Pull request merge payload.commit_message');
  const sha = optionalTrimmedString(object.sha, 'Pull request merge payload.sha');
  const metadataValue = object.metadata;
  const metadata = metadataValue === undefined ? undefined : parseReviewMetadata(metadataValue);

  return {
    ...(method ? { method } : {}),
    ...(commitTitle ? { commitTitle } : {}),
    ...(commitMessage ? { commitMessage } : {}),
    ...(sha ? { sha } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function compactIssuePayload(payload: GitHubIssueWritebackInput): JsonObject {
  const body: JsonObject = {};
  if (payload.title !== undefined) body.title = payload.title;
  if (payload.body !== undefined) body.body = payload.body;
  if (payload.labels !== undefined) body.labels = payload.labels;
  if (payload.assignees !== undefined) body.assignees = payload.assignees;
  if (payload.milestone !== undefined) body.milestone = payload.milestone;
  if (payload.state !== undefined) body.state = payload.state;
  return body;
}

function githubJsonHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function parsePositiveIntegerSegment(segment: string, field: string): number {
  const decoded = decodeGitHubPathSegment(segment.replace(/\.json$/, ''), field);
  const numberSegment = decoded.split('__')[0] ?? decoded;
  const value = Number.parseInt(numberSegment, 10);
  if (!Number.isInteger(value) || value < 1 || String(value) !== numberSegment) {
    throw new Error(`GitHub ${field} must be a positive integer`);
  }
  return value;
}

function decodeGitHubPathSegment(encoded: string, field: string): string {
  const decoded = decodeURIComponent(encoded);
  if (decoded.includes('/')) {
    throw new Error(`Invalid GitHub ${field} in writeback path: encoded path separators are not allowed`);
  }
  return decoded;
}

function parseReviewUpdatePayload(content: string): { body: string; metadata?: AgentReviewMetadata } {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse failure';
    throw new Error(`Invalid review update JSON: ${message}`);
  }
  const object = expectObject(parsed, 'Review update payload');
  rejectReadOnlyFields(object);
  const body = readString(object, 'body', 'Review update payload');
  const metadataValue = object.metadata;
  const metadata = metadataValue === undefined ? undefined : parseReviewMetadata(metadataValue);
  return { body, metadata };
}

const READ_ONLY_FIELDS = new Set([
  'id',
  'node_id',
  'html_url',
  'pull_request_url',
  'createdAt',
  'updatedAt',
  'submitted_at',
  'url',
  'identifier',
  'provider',
  'objectType',
  'objectId',
  'workspaceId',
  'connectionId',
  '_webhook',
  '_connection',
]);

function rejectReadOnlyFields(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
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

function optionalStringArray(value: JsonValue | undefined, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings when provided`);
  }
  const strings = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`${fieldName}[${index}] must be a non-empty string`);
    }
    return entry;
  });
  return strings;
}

function optionalMilestone(value: JsonValue | undefined, fieldName: string): number | string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  throw new Error(`${fieldName} must be a positive integer or string when provided`);
}

function optionalIssueState(value: JsonValue | undefined, fieldName: string): 'open' | 'closed' | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'open' || value === 'closed') {
    return value;
  }
  throw new Error(`${fieldName} must be either open or closed when provided`);
}

function optionalMergeMethod(value: JsonValue | undefined, fieldName: string): GitHubMergeMethod | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'merge' || value === 'squash' || value === 'rebase') {
    return value;
  }
  throw new Error(`${fieldName} must be one of merge, squash, rebase when provided`);
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

function extractMergeSha(value: JsonValue | null): string | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return undefined;
  }

  const responseObject = value as JsonObject;
  const sha = responseObject.sha;
  return typeof sha === 'string' && sha.trim().length > 0 ? sha : undefined;
}

function formatProviderError(
  response: ProxyResponse,
  baseMessage = `GitHub review submission failed with status ${response.status}`,
): string {
  const failureMessage = baseMessage.includes(String(response.status))
    ? baseMessage
    : `${baseMessage} with status ${response.status}`;
  const responseData = response.data;

  if (responseData === null) {
    return failureMessage;
  }

  if (typeof responseData === 'string' && responseData.trim().length > 0) {
    return `${failureMessage}: ${responseData}`;
  }

  if (!Array.isArray(responseData) && typeof responseData === 'object') {
    const message = responseData.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return `${failureMessage}: ${message}`;
    }
  }

  return failureMessage;
}

function formatThrownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown writeback failure';
}

export function createGitHubWritebackHandler(
  provider: GitHubRequestProvider,
  options?: GitHubWritebackHandlerOptions,
): GitHubWritebackHandler {
  return new GitHubWritebackHandler(provider, options);
}
