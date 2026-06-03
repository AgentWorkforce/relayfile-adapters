import { createHash } from 'node:crypto';
import { aliasCollisionSuffix, slugifyAlias } from './alias-slug.js';

export const GITHUB_PATH_ROOT = '/github';
const GITHUB_ROOT = '/github/repos';

export interface NameWithIdOptions {
  existingNames?: Set<string>;
}

export interface ParseNameWithIdResult {
  humanReadable: string | null;
  id: string;
  ext: string | null;
}

const MAX_HUMAN_READABLE_LENGTH = 80;

function slugify(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]+/g, '');
  const slug = ascii
    .replace(/^-+|-+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  if (slug.length <= MAX_HUMAN_READABLE_LENGTH) {
    return slug;
  }

  const truncated = slug.slice(0, MAX_HUMAN_READABLE_LENGTH);
  const cutIndex = truncated.lastIndexOf('-');
  const bounded = cutIndex > 0 ? truncated.slice(0, cutIndex) : truncated;
  return bounded.replace(/^-+|-+$/g, '');
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
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

// GitHub uses `<id>__<slug>` segments so `parseNameWithId` round-trips correctly:
// the leading token before `__` is the id; the trailing token is the human-readable slug.
export function nameWithId(humanReadable: string | undefined, id: string, opts: NameWithIdOptions = {}): string {
  const normalizedId = encodeGitHubPathSegment(id);
  const slug = humanReadable ? slugify(humanReadable) : '';
  if (!slug) {
    return normalizedId;
  }

  const existingNames = opts.existingNames;
  const candidate = `${normalizedId}__${slug}`;
  if (existingNames?.has(candidate)) {
    const hashedSlug = `${slug}-${shortHash(normalizedId)}`;
    const hashedCandidate = `${normalizedId}__${hashedSlug}`;
    existingNames.add(hashedCandidate);
    return hashedCandidate;
  }

  existingNames?.add(candidate);
  return candidate;
}

// For GitHub `<number>__<slug>` segments, `id` is the leading number and `humanReadable` is the trailing slug.
export function parseNameWithId(filename: string): ParseNameWithIdResult {
  const extIndex = filename.lastIndexOf('.');
  const ext = extIndex > 0 && extIndex < filename.length - 1 ? filename.slice(extIndex + 1) : null;
  const basename = ext ? filename.slice(0, extIndex) : filename;
  const separatorIndex = basename.lastIndexOf('__');

  if (separatorIndex <= 0 || separatorIndex === basename.length - 2) {
    return {
      humanReadable: null,
      id: basename,
      ext,
    };
  }

  return {
    humanReadable: basename.slice(separatorIndex + 2),
    id: basename.slice(0, separatorIndex),
    ext,
  };
}

// GitHub collision tracking keys on the full `<number>__<slug>` directory name, unlike `nameWithId`, which tracks only the slug stem.
export function githubNumberSlug(number: number | string, title?: string, opts: NameWithIdOptions = {}): string {
  const numberSegment = String(number).trim();
  const slug = title ? slugify(title) : '';
  if (!slug) {
    return numberSegment;
  }

  const existingNames = opts.existingNames;
  const candidate = `${numberSegment}__${slug}`;
  if (existingNames?.has(candidate)) {
    const hashedSlug = `${slug}-${shortHash(numberSegment)}`;
    const hashedCandidate = `${numberSegment}__${hashedSlug}`;
    existingNames.add(hashedCandidate);
    return hashedCandidate;
  }

  existingNames?.add(candidate);
  return candidate;
}

export function githubRepoPrefix(owner: string, repo: string): string {
  return `${GITHUB_ROOT}/${encodeRepoSegment(owner)}/${encodeRepoSegment(repo)}`;
}

export function githubReposIndexPath(): string {
  return `${GITHUB_ROOT}/_index.json`;
}

export function githubRootIndexPath(): string {
  return `${GITHUB_PATH_ROOT}/_index.json`;
}

export function githubRepositoryMetaPath(owner: string, repo: string): string {
  return `${githubRepoPrefix(owner, repo)}/meta.json`;
}

/**
 * @deprecated Legacy repository canonical retained for reader/delete compatibility.
 * Use githubRepositoryMetaPath for newly emitted repository records.
 */
export function githubRepositoryMetadataPath(owner: string, repo: string): string {
  return `${githubRepoPrefix(owner, repo)}/metadata.json`;
}

export function githubIssuePath(
  owner: string,
  repo: string,
  issueNumber: number | string,
  title?: string,
): string {
  return `${GITHUB_ROOT}/${encodeRepoSegment(owner)}/${encodeRepoSegment(repo)}/issues/${githubNumberSlug(issueNumber, title)}/meta.json`;
}

export function githubRepoIssuesIndexPath(owner: string, repo: string): string {
  return `${githubRepoPrefix(owner, repo)}/issues/_index.json`;
}

export function githubPullRequestPath(
  owner: string,
  repo: string,
  prNumber: number | string,
  title?: string,
): string {
  return `${GITHUB_ROOT}/${encodeRepoSegment(owner)}/${encodeRepoSegment(repo)}/pulls/${githubNumberSlug(prNumber, title)}/meta.json`;
}

export function githubRepoPullsIndexPath(owner: string, repo: string): string {
  return `${githubRepoPrefix(owner, repo)}/pulls/_index.json`;
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
  return `${githubRepoPrefix(owner, repo)}/reviews/${encodeGitHubPathSegment(String(reviewId))}.json`;
}

export function githubReviewCommentPath(owner: string, repo: string, commentId: number | string): string {
  return `${githubRepoPrefix(owner, repo)}/comments/${encodeGitHubPathSegment(String(commentId))}.json`;
}

export function githubCheckRunPath(owner: string, repo: string, checkRunId: number | string): string {
  return `${githubRepoPrefix(owner, repo)}/checks/${encodeGitHubPathSegment(String(checkRunId))}.json`;
}

export function githubDeploymentStatusPath(
  owner: string,
  repo: string,
  deploymentId: number | string,
  deploymentStatusId: number | string,
): string {
  return `${githubRepoPrefix(owner, repo)}/deployments/${encodeGitHubPathSegment(
    String(deploymentId),
  )}/statuses/${encodeGitHubPathSegment(String(deploymentStatusId))}.json`;
}

export function githubDeploymentStatusByStatusAliasPath(
  owner: string,
  repo: string,
  status: string,
  deploymentStatusId: number | string,
): string {
  return `${githubAliasRepoPrefix(owner, repo)}/deployments/by-status/${encodeGitHubPathSegment(
    slugifyAlias(status),
  )}/${encodeGitHubPathSegment(String(deploymentStatusId))}.json`;
}

export function githubCommitPath(owner: string, repo: string, sha: string): string {
  return `${githubRepoPrefix(owner, repo)}/commits/${encodeGitHubPathSegment(sha)}/metadata.json`;
}

export function githubAliasRepoPrefix(owner: string, repo: string): string {
  return `${GITHUB_ROOT}/${encodeRepoSegment(`${owner}__${repo}`)}`;
}

/**
 * @deprecated Legacy title-only alias retained for reader/delete compatibility.
 * Use githubNumberedByTitleAliasPath for newly emitted aliases.
 */
export function githubByTitleAliasPath(
  owner: string,
  repo: string,
  kind: 'issues' | 'pulls',
  title: string,
  number: number | string,
  colliding = false,
): string {
  const slug = slugifyAlias(title);
  if (!slug) {
    throw new Error('GitHub alias title must slug to a non-empty string');
  }

  const filename = colliding ? `${slug}-${aliasCollisionSuffix(String(number))}` : slug;
  return `${githubAliasRepoPrefix(owner, repo)}/${kind}/by-title/${encodeGitHubPathSegment(filename)}.json`;
}

/**
 * Number-suffixed by-title alias for newly emitted issue and PR mirrors.
 */
export function githubNumberedByTitleAliasPath(
  owner: string,
  repo: string,
  kind: 'issues' | 'pulls',
  title: string,
  number: number | string,
  colliding = false,
): string {
  const slug = slugifyAlias(title);
  if (!slug) {
    // TODO(issue #106): define empty-slug fallback/skip behavior for emoji-only or punctuation-only GitHub titles instead of throwing.
    throw new Error('GitHub alias title must slug to a non-empty string');
  }

  const aliasSlug = colliding ? `${slug}-${aliasCollisionSuffix(String(number))}` : slug;
  const filename = `${aliasSlug}__${String(number)}`;
  return `${githubAliasRepoPrefix(owner, repo)}/${kind}/by-title/${encodeGitHubPathSegment(filename)}.json`;
}

/**
 * @deprecated Use githubByTitleAliasPath for legacy read/delete compatibility
 * and githubNumberedByTitleAliasPath for newly emitted aliases.
 */
export const githubLegacyByTitleAliasPath = githubByTitleAliasPath;

export function githubByIdAliasPath(
  owner: string,
  repo: string,
  kind: 'issues' | 'pulls',
  number: number | string,
): string {
  return `${githubAliasRepoPrefix(owner, repo)}/${kind}/by-id/${encodeGitHubPathSegment(String(number))}.json`;
}

export function githubByStateAliasPath(
  owner: string,
  repo: string,
  kind: 'issues' | 'pulls',
  state: string,
  number: number | string,
): string {
  return `${githubAliasRepoPrefix(owner, repo)}/${kind}/by-state/${encodeGitHubPathSegment(
    slugifyAlias(state),
  )}/${encodeGitHubPathSegment(String(number))}.json`;
}

export function githubByAssigneeAliasPath(
  owner: string,
  repo: string,
  kind: 'issues' | 'pulls',
  assignee: string,
  number: number | string,
): string {
  return `${githubAliasRepoPrefix(owner, repo)}/${kind}/by-assignee/${encodeGitHubPathSegment(
    slugifyAlias(assignee),
  )}/${encodeGitHubPathSegment(String(number))}.json`;
}

export function githubByCreatorAliasPath(
  owner: string,
  repo: string,
  kind: 'issues' | 'pulls',
  creator: string,
  number: number | string,
): string {
  return `${githubAliasRepoPrefix(owner, repo)}/${kind}/by-creator/${encodeGitHubPathSegment(
    slugifyAlias(creator),
  )}/${encodeGitHubPathSegment(String(number))}.json`;
}

export function githubByPriorityAliasPath(
  owner: string,
  repo: string,
  kind: 'issues' | 'pulls',
  priority: string,
  number: number | string,
): string {
  return `${githubAliasRepoPrefix(owner, repo)}/${kind}/by-priority/${encodeGitHubPathSegment(
    slugifyAlias(priority),
  )}/${encodeGitHubPathSegment(String(number))}.json`;
}

export function githubByEditedAliasPath(
  owner: string,
  repo: string,
  kind: 'issues' | 'pulls',
  editedDate: string,
  number: number | string,
): string {
  return `${githubAliasRepoPrefix(owner, repo)}/${kind}/by-edited/${encodeGitHubPathSegment(
    editedDate,
  )}/${encodeGitHubPathSegment(String(number))}.json`;
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
  deployment_status: 'deployment_status',
  deploymentstatus: 'deployment_status',
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
  DeploymentStatus: 'deployment_status',
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
  deploymentId?: number | string;
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
      return githubRepositoryMetaPath(owner, repo);
    case 'review':
      return githubReviewPath(owner, repo, objectId);
    case 'review_comment':
      return githubReviewCommentPath(owner, repo, objectId);
    case 'check_run':
      return githubCheckRunPath(owner, repo, objectId);
    case 'deployment_status':
      return githubDeploymentStatusPath(
        owner,
        repo,
        context?.deploymentId ?? 'deployment-unknown',
        objectId,
      );
    case 'commit':
      return githubCommitPath(owner, repo, objectId);
    default:
      return `${GITHUB_PATH_ROOT}/${normalizedType}/${objectId}.json`;
  }
}
