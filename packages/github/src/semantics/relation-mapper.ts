import type { FileSemantics } from './property-mapper.js';

type ParentReference =
  | string
  | {
      sha?: string | null;
    }
  | null
  | undefined;

export function mapPRRelations(
  owner: string,
  repo: string,
  number: number | string,
): FileSemantics['relations'] {
  const prRoot = buildPRRoot(owner, repo, number);

  return [
    buildRepoRoot(owner, repo),
    `${prRoot}/commits/`,
    `${prRoot}/reviews/`,
    `${prRoot}/checks/`,
  ];
}

export function mapCommitRelations(
  owner: string,
  repo: string,
  prNumber: number | string,
  sha: string,
  parents: readonly ParentReference[] = [],
): FileSemantics['relations'] {
  void sha;

  const prRoot = buildPRRoot(owner, repo, prNumber);

  return uniqueRelations([
    `${prRoot}/meta.json`,
    ...extractParentShas(parents).map(
      (parentSha) => `${prRoot}/commits/${encodePathSegment(parentSha)}.json`,
    ),
  ]);
}

export function mapReviewRelations(
  owner: string,
  repo: string,
  prNumber: number | string,
  reviewId: number | string,
): FileSemantics['relations'] {
  const prRoot = buildPRRoot(owner, repo, prNumber);

  return [`${prRoot}/meta.json`, `${prRoot}/reviews/${encodePathSegment(reviewId)}/comments/`];
}

export function mapIssueRelations(
  owner: string,
  repo: string,
  number: number | string,
): FileSemantics['relations'] {
  const repoRoot = buildRepoRoot(owner, repo);
  const issueNumber = encodePathSegment(number);

  return [repoRoot, `${repoRoot}issues/${issueNumber}/comments/`];
}

function buildRepoRoot(owner: string, repo: string): string {
  return `/github/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/`;
}

function buildPRRoot(owner: string, repo: string, prNumber: number | string): string {
  return `${buildRepoRoot(owner, repo)}pulls/${encodePathSegment(prNumber)}`;
}

function encodePathSegment(value: number | string): string {
  return encodeURIComponent(String(value));
}

function extractParentShas(parents: readonly ParentReference[]): string[] {
  return parents.flatMap((parent) => {
    if (typeof parent === 'string') {
      return parent.trim() ? [parent] : [];
    }

    if (!parent || typeof parent.sha !== 'string' || !parent.sha.trim()) {
      return [];
    }

    return [parent.sha];
  });
}

function uniqueRelations(relations: readonly string[]): string[] {
  return [...new Set(relations)];
}
