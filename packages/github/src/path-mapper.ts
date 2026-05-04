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

export function githubNumberSlug(number: number | string, title?: string): string {
  const numberSegment = String(number).trim();
  const slug = title ? slugify(title) : '';
  return slug ? `${numberSegment}--${slug}` : numberSegment;
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
