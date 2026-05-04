export const GITHUB_PATH_ROOT = '/github';
const GITHUB_ROOT = '/github/repos';

function slugify(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function encodeRepoSegment(value: string): string {
  return encodeURIComponent(value);
}

export function encodeGitHubPathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Path segment must be non-empty');
  }
  return encodeURIComponent(trimmed);
}

export function githubNumberSlug(number: number | string, title?: string): string {
  const numberSegment = String(number).trim();
  const slug = title ? slugify(title) : '';
  return slug ? `${numberSegment}--${slug}` : numberSegment;
}

export function githubRepoPrefix(owner: string, repo: string): string {
  return `${GITHUB_ROOT}/${encodeRepoSegment(owner)}/${encodeRepoSegment(repo)}`;
}

export function githubRepositoryMetadataPath(owner: string, repo: string): string {
  return `${githubRepoPrefix(owner, repo)}/metadata.json`;
}

export function githubIssuePath(
  owner: string,
  repo: string,
  issueNumber: number | string,
  title?: string,
): string {
  return `${GITHUB_ROOT}/${encodeRepoSegment(owner)}/${encodeRepoSegment(repo)}/issues/${githubNumberSlug(issueNumber, title)}/metadata.json`;
}

export function githubPullRequestPath(
  owner: string,
  repo: string,
  prNumber: number | string,
  title?: string,
): string {
  return `${GITHUB_ROOT}/${encodeRepoSegment(owner)}/${encodeRepoSegment(repo)}/pulls/${githubNumberSlug(prNumber, title)}/metadata.json`;
}

export function githubPullRequestRoot(
  owner: string,
  repo: string,
  prNumber: number | string,
  title?: string,
): string {
  return `${GITHUB_ROOT}/${encodeRepoSegment(owner)}/${encodeRepoSegment(repo)}/pulls/${githubNumberSlug(prNumber, title)}`;
}

export function githubReviewPath(owner: string, repo: string, reviewId: number | string): string {
  return `${githubRepoPrefix(owner, repo)}/reviews/${reviewId}.json`;
}

export function githubReviewCommentPath(owner: string, repo: string, commentId: number | string): string {
  return `${githubRepoPrefix(owner, repo)}/comments/${commentId}.json`;
}

export function githubCheckRunPath(owner: string, repo: string, checkRunId: number | string): string {
  return `${githubRepoPrefix(owner, repo)}/checks/${checkRunId}.json`;
}

export function githubCommitPath(owner: string, repo: string, sha: string): string {
  return `${githubRepoPrefix(owner, repo)}/commits/${sha}/metadata.json`;
}

const OBJECT_TYPE_ALIASES: Record<string, string> = {
  pr: 'pull_request',
  pulls: 'pull_request',
  pull: 'pull_request',
  pullrequest: 'pull_request',
  pull_request: 'pull_request',
  issue: 'issue',
  issues: 'issue',
  repository: 'repository',
  repo: 'repository',
  review: 'review',
  review_comment: 'review_comment',
  check_run: 'check_run',
  checkrun: 'check_run',
  commit: 'commit',
};

export function normalizeGitHubObjectType(type: string): string {
  const normalized = type.toLowerCase().trim();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported GitHub object type: ${type}`);
  }
  return mapped;
}

export function tryNormalizeGitHubObjectType(type: string): string | undefined {
  try {
    return normalizeGitHubObjectType(type);
  } catch {
    return undefined;
  }
}

const NANGO_MODEL_MAP: Record<string, string> = {
  Repo: 'repository',
  Repository: 'repository',
  PullRequest: 'pull_request',
  Issue: 'issue',
  Review: 'review',
  ReviewComment: 'review_comment',
  CheckRun: 'check_run',
  Commit: 'commit',
};

export function normalizeNangoGitHubModel(model: string): string {
  const mapped = NANGO_MODEL_MAP[model];
  if (mapped) return mapped;
  return normalizeGitHubObjectType(model);
}

export interface GitHubPathContext {
  owner?: string;
  repo?: string;
}

export function computeGitHubPath(
  objectType: string,
  objectId: string,
  context?: GitHubPathContext,
): string {
  const normalizedType = tryNormalizeGitHubObjectType(objectType);
  if (!normalizedType) {
    const sanitized = objectType.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return `${GITHUB_PATH_ROOT}/${sanitized}/${objectId}.json`;
  }

  const owner = context?.owner;
  const repo = context?.repo;

  if (!owner || !repo) {
    return `${GITHUB_PATH_ROOT}/${normalizedType}/${objectId}.json`;
  }

  switch (normalizedType) {
    case 'pull_request':
      return githubPullRequestPath(owner, repo, objectId);
    case 'issue':
      return githubIssuePath(owner, repo, objectId);
    case 'repository':
      return githubRepositoryMetadataPath(owner, repo);
    case 'review':
      return githubReviewPath(owner, repo, objectId);
    case 'review_comment':
      return githubReviewCommentPath(owner, repo, objectId);
    case 'check_run':
      return githubCheckRunPath(owner, repo, objectId);
    case 'commit':
      return githubCommitPath(owner, repo, objectId);
    default:
      return `${GITHUB_PATH_ROOT}/${normalizedType}/${objectId}.json`;
  }
}
