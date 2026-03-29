import type { IngestResult } from '../types.js';
export type { IngestResult };

export interface WebhookAdapter {
  ingestPullRequest(payload: Record<string, unknown>): Promise<IngestResult>;
  updatePullRequest(payload: Record<string, unknown>): Promise<IngestResult>;
  closePullRequest(payload: Record<string, unknown>): Promise<IngestResult>;
  ingestReview(payload: Record<string, unknown>): Promise<IngestResult>;
  ingestReviewComment(payload: Record<string, unknown>): Promise<IngestResult>;
  ingestPushCommits(payload: Record<string, unknown>): Promise<IngestResult>;
  ingestIssue(payload: Record<string, unknown>): Promise<IngestResult>;
  closeIssue(payload: Record<string, unknown>): Promise<IngestResult>;
  ingestCheckRun(payload: Record<string, unknown>): Promise<IngestResult>;
}

export type WebhookHandler = (
  adapter: WebhookAdapter,
  payload: Record<string, unknown>,
) => Promise<IngestResult>;

export const EVENT_MAP: Record<string, WebhookHandler> = {
  'pull_request.opened': (adapter, payload) => adapter.ingestPullRequest(payload),
  'pull_request.synchronize': (adapter, payload) => adapter.updatePullRequest(payload),
  'pull_request.closed': (adapter, payload) => adapter.closePullRequest(payload),
  'pull_request_review.submitted': (adapter, payload) => adapter.ingestReview(payload),
  'pull_request_review_comment.created': (adapter, payload) =>
    adapter.ingestReviewComment(payload),
  push: (adapter, payload) => adapter.ingestPushCommits(payload),
  'issues.opened': (adapter, payload) => adapter.ingestIssue(payload),
  'issues.closed': (adapter, payload) => adapter.closeIssue(payload),
  'check_run.completed': (adapter, payload) => adapter.ingestCheckRun(payload),
};

export function extractEventKey(
  headers: Headers | Record<string, string | string[] | undefined>,
  payload: Record<string, unknown>,
): string {
  const eventName = readHeader(headers, 'x-github-event');
  const action = typeof payload.action === 'string' ? payload.action : undefined;

  if (!eventName) {
    return action ?? '';
  }

  return action ? `${eventName}.${action}` : eventName;
}

export function extractRepoInfo(
  payload: Record<string, unknown>,
): { owner: string; repo: string; number?: number } {
  const repository = asRecord(payload.repository);
  const [ownerFromFullName, repoFromFullName] = splitFullName(repository?.full_name);
  const owner =
    ownerFromFullName ??
    readNestedString(repository, 'owner', 'login') ??
    readNestedString(repository, 'owner', 'name') ??
    '';
  const repo = repoFromFullName ?? readString(repository, 'name') ?? '';

  const pullRequest = asRecord(payload.pull_request);
  const issue = asRecord(payload.issue);
  const number = readNumber(pullRequest, 'number') ?? readNumber(issue, 'number');

  return number === undefined ? { owner, repo } : { owner, repo, number };
}

function readHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  headerName: string,
): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(headerName) ?? headers.get(headerName.toLowerCase()) ?? undefined;
  }

  const wanted = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) {
      continue;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      return value[0];
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' ? value : undefined;
}

function readNestedString(
  record: Record<string, unknown> | undefined,
  key: string,
  nestedKey: string,
): string | undefined {
  return readString(asRecord(record?.[key]), nestedKey);
}

function splitFullName(fullName: unknown): [string | undefined, string | undefined] {
  if (typeof fullName !== 'string') {
    return [undefined, undefined];
  }

  const [owner, repo] = fullName.split('/', 2);
  return [owner || undefined, repo || undefined];
}
