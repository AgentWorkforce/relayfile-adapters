/**
 * Pure path computation for GitHub VFS layout.
 *
 * Zero external dependencies — safe to import in any environment
 * (Next.js bundle, edge runtime, tests) without pulling in
 * adapter-core, @relayfile/sdk, or any other heavy dependency.
 *
 * Follows the same pattern as @relayfile/adapter-linear/path-mapper
 * and @relayfile/adapter-slack/path-mapper.
 */

export const GITHUB_PATH_ROOT = '/github';

export const GITHUB_OBJECT_TYPES = [
  'check_run',
  'commit',
  'issue',
  'pull_request',
  'repository',
  'review',
  'review_comment',
] as const;

export type GitHubPathObjectType = (typeof GITHUB_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, GitHubPathObjectType>> = {
  check_run: 'check_run',
  checkrun: 'check_run',
  checks: 'check_run',
  commit: 'commit',
  commits: 'commit',
  issue: 'issue',
  issues: 'issue',
  pr: 'pull_request',
  pull: 'pull_request',
  pull_request: 'pull_request',
  pullrequest: 'pull_request',
  pulls: 'pull_request',
  repo: 'repository',
  repository: 'repository',
  review: 'review',
  review_comment: 'review_comment',
  reviews: 'review',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`GitHub ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeGitHubPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function normalizeGitHubObjectType(objectType: string): GitHubPathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported GitHub object type: ${objectType}`);
  }
  return mapped;
}

/**
 * Normalize a Nango sync model name to a canonical GitHub object type.
 *
 * Nango models use PascalCase names like "Repo", "PullRequest", "Issue".
 * This maps them to the snake_case types used by the adapter.
 */
const NANGO_MODEL_ALIASES: Readonly<Record<string, GitHubPathObjectType>> = {
  Repo: 'repository',
  Repository: 'repository',
  PullRequest: 'pull_request',
  Issue: 'issue',
  Review: 'review',
  ReviewComment: 'review_comment',
  CheckRun: 'check_run',
  Commit: 'commit',
};

export function normalizeNangoGitHubModel(model: string): GitHubPathObjectType {
  const fromNango = NANGO_MODEL_ALIASES[model];
  if (fromNango) {
    return fromNango;
  }
  return normalizeGitHubObjectType(model);
}

export function githubRepoPrefix(owner: string, repo: string): string {
  return `${GITHUB_PATH_ROOT}/repos/${encodeGitHubPathSegment(owner)}/${encodeGitHubPathSegment(repo)}`;
}

export function githubRepositoryMetadataPath(owner: string, repo: string): string {
  return `${githubRepoPrefix(owner, repo)}/metadata.json`;
}

export function githubPullRequestPath(owner: string, repo: string, number: string): string {
  return `${githubRepoPrefix(owner, repo)}/pulls/${assertNonEmptySegment(number, 'PR number')}/metadata.json`;
}

export function githubIssuePath(owner: string, repo: string, number: string): string {
  return `${githubRepoPrefix(owner, repo)}/issues/${assertNonEmptySegment(number, 'issue number')}/metadata.json`;
}

export function githubReviewPath(owner: string, repo: string, reviewId: string): string {
  return `${githubRepoPrefix(owner, repo)}/reviews/${assertNonEmptySegment(reviewId, 'review id')}.json`;
}

export function githubReviewCommentPath(owner: string, repo: string, commentId: string): string {
  return `${githubRepoPrefix(owner, repo)}/comments/${assertNonEmptySegment(commentId, 'comment id')}.json`;
}

export function githubCheckRunPath(owner: string, repo: string, checkRunId: string): string {
  return `${githubRepoPrefix(owner, repo)}/checks/${assertNonEmptySegment(checkRunId, 'check run id')}.json`;
}

export function githubCommitPath(owner: string, repo: string, sha: string): string {
  return `${githubRepoPrefix(owner, repo)}/commits/${assertNonEmptySegment(sha, 'commit sha')}/metadata.json`;
}

/**
 * Compute a GitHub VFS path from an object type, object ID, and repo context.
 *
 * If owner/repo are not provided, falls back to a generic path.
 */
export function computeGitHubPath(
  objectType: string,
  objectId: string,
  context?: { owner?: string; repo?: string },
): string {
  const normalizedType = normalizeGitHubObjectType(objectType);
  const owner = context?.owner?.trim();
  const repo = context?.repo?.trim();

  if (!owner || !repo) {
    // Fallback: no repo context — use a generic path
    return `${GITHUB_PATH_ROOT}/${normalizedType}/${encodeGitHubPathSegment(objectId)}.json`;
  }

  switch (normalizedType) {
    case 'repository':
      return githubRepositoryMetadataPath(owner, repo);
    case 'pull_request':
      return githubPullRequestPath(owner, repo, objectId);
    case 'issue':
      return githubIssuePath(owner, repo, objectId);
    case 'review':
      return githubReviewPath(owner, repo, objectId);
    case 'review_comment':
      return githubReviewCommentPath(owner, repo, objectId);
    case 'check_run':
      return githubCheckRunPath(owner, repo, objectId);
    case 'commit':
      return githubCommitPath(owner, repo, objectId);
  }
}

export { GITHUB_PATH_ROOT as GITHUB_ROOT };
