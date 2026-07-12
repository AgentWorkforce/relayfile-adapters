import {
  githubRepoIssuesIndexPath,
  githubRepoPullsIndexPath,
  githubReposIndexPath,
  githubRootIndexPath,
} from './path-mapper.js';
import type { VfsLike } from './files/content-fetcher.js';

export interface GitHubRepoIndexRow {
  id: string;
  title: string;
  updated: string;
}

export interface GitHubRecordIndexRow extends GitHubRepoIndexRow {
  number: number;
  state: string;
  // Label names carried inline so label-gated consumers (e.g. the factory's
  // `factory`-label gate) can filter on the index without reading every
  // `meta.json`. Additive field — older readers ignore it. See issue #176.
  labels?: string[];
  assigneeKeys?: string[];
  creatorKey?: string;
  priority?: string;
  // Merge lifecycle carried inline (pull requests only) so time-windowed
  // consumers — e.g. a "what merged in the last 24h" digest — can filter the
  // index alone without opening every `meta.json`. `merged` is true once the PR
  // has a merge timestamp; `mergedAt` is the ISO 8601 `merged_at`. Both are
  // omitted for issues and for unmerged PRs. Additive — older readers ignore it.
  merged?: boolean;
  mergedAt?: string;
}

/** Add merge lifecycle fields to a pull-request index row when GitHub supplies a timestamp. */
export function pullRequestMergeIndexFields(
  mergedAt: string | null | undefined,
): Partial<Pick<GitHubRecordIndexRow, 'merged' | 'mergedAt'>> {
  const normalized = mergedAt?.trim();
  return normalized ? { merged: true, mergedAt: normalized } : {};
}

export interface GitHubRootIndexRow {
  id: string;
  title: string;
}

export interface GitHubIndexFile {
  path: string;
  contentType: 'application/json; charset=utf-8';
  content: string;
}

/**
 * Build `/github/_index.json` — a static listing of top-level resource roots
 * the GitHub adapter exposes. Mirrors the slack pattern so an agent can
 * `ls /github/` and orient.
 */
export function buildGitHubRootIndexFile(
  rows: GitHubRootIndexRow[] = [{ id: 'repos', title: 'Repositories' }],
): GitHubIndexFile {
  return {
    path: githubRootIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(rows)}\n`,
  };
}

export function buildRepoIndexFile(rows: GitHubRepoIndexRow[]): GitHubIndexFile {
  return {
    path: githubReposIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareRepoRows))}\n`,
  };
}

export function buildRepoIssuesIndexFile(
  owner: string,
  repo: string,
  rows: GitHubRecordIndexRow[],
): GitHubIndexFile {
  return {
    path: githubRepoIssuesIndexPath(owner, repo),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareRecordRows))}\n`,
  };
}

export function buildRepoPullsIndexFile(
  owner: string,
  repo: string,
  rows: GitHubRecordIndexRow[],
): GitHubIndexFile {
  return {
    path: githubRepoPullsIndexPath(owner, repo),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareRecordRows))}\n`,
  };
}

export async function readRepoIndexRows(
  vfs: VfsLike,
): Promise<GitHubRepoIndexRow[]> {
  return parseIndexRows<GitHubRepoIndexRow>(await readVfsText(vfs, githubReposIndexPath()));
}

export async function readRecordIndexRows(
  vfs: VfsLike,
  path: string,
): Promise<GitHubRecordIndexRow[]> {
  return parseIndexRows<GitHubRecordIndexRow>(await readVfsText(vfs, path));
}

export function upsertRepoIndexRow(
  rows: GitHubRepoIndexRow[],
  row: GitHubRepoIndexRow,
): GitHubRepoIndexRow[] {
  return upsertIndexRow(rows, row);
}

export function upsertRecordIndexRow(
  rows: GitHubRecordIndexRow[],
  row: GitHubRecordIndexRow,
): GitHubRecordIndexRow[] {
  return upsertIndexRow(rows, row);
}

function compareRepoRows(left: GitHubRepoIndexRow, right: GitHubRepoIndexRow): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

function compareRecordRows(left: GitHubRecordIndexRow, right: GitHubRecordIndexRow): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  if (left.number !== right.number) {
    return left.number - right.number;
  }
  return left.id.localeCompare(right.id);
}

async function readVfsText(vfs: VfsLike, path: string): Promise<string | undefined> {
  for (const reader of [vfs.readFile, vfs.read, vfs.get]) {
    if (!reader) {
      continue;
    }

    try {
      const value = await reader.call(vfs, path);
      if (typeof value === 'string') {
        return value;
      }
    } catch {
      // A throwing reader should not abort the loop — fall through to the
      // next available reader so we still surface text from working backends.
      continue;
    }
  }

  return undefined;
}

export function parseIndexRows<T>(content: string | undefined): T[] {
  if (!content) {
    return [];
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function upsertIndexRow<T extends { id: string }>(rows: T[], row: T): T[] {
  return [...rows.filter((existing) => existing.id !== row.id), row];
}
