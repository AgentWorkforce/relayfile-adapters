import {
  githubRepoIssuesIndexPath,
  githubRepoPullsIndexPath,
  githubReposIndexPath,
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
}

export interface GitHubIndexFile {
  path: string;
  contentType: 'application/json; charset=utf-8';
  content: string;
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
      return undefined;
    }
  }

  return undefined;
}

function parseIndexRows<T>(content: string | undefined): T[] {
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
