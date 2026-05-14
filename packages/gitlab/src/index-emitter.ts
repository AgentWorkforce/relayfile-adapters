import {
  gitLabProjectResourceIndexPath,
  gitLabProjectsIndexPath,
  gitLabRootIndexPath,
  type GitLabIndexedResourceType,
} from './path-mapper.js';

export interface GitLabProjectIndexRow {
  id: string;
  title: string;
  updated: string;
}

export interface GitLabRecordIndexRow {
  id: string;
  title: string;
  updated: string;
  iid?: number;
  sha?: string;
  state?: string;
  status?: string;
  ref?: string;
}

export interface GitLabRootIndexRow {
  id: string;
  title: string;
}

export interface GitLabIndexFile {
  path: string;
  contentType: 'application/json; charset=utf-8';
  content: string;
}

export function buildGitLabRootIndexFile(
  rows: GitLabRootIndexRow[] = [{ id: 'projects', title: 'Projects' }],
): GitLabIndexFile {
  return {
    path: gitLabRootIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(rows)}\n`,
  };
}

export function buildGitLabProjectsIndexFile(rows: readonly GitLabProjectIndexRow[]): GitLabIndexFile {
  return {
    path: gitLabProjectsIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
  };
}

export function buildGitLabProjectResourceIndexFile(
  projectPath: string,
  objectType: GitLabIndexedResourceType,
  rows: readonly GitLabRecordIndexRow[],
): GitLabIndexFile {
  return {
    path: gitLabProjectResourceIndexPath(projectPath, objectType),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
  };
}

export function upsertGitLabIndexRow<T extends { id: string }>(rows: readonly T[], row: T): T[] {
  return [...rows.filter((existing) => existing.id !== row.id), row];
}

function compareIndexRows(left: { id: string; updated?: string }, right: { id: string; updated?: string }): number {
  const leftUpdated = left.updated ?? '';
  const rightUpdated = right.updated ?? '';
  if (leftUpdated !== rightUpdated) {
    return rightUpdated.localeCompare(leftUpdated);
  }
  return left.id.localeCompare(right.id);
}
