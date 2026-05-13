import {
  linearCyclesIndexPath,
  linearCommentsIndexPath,
  linearIssuesIndexPath,
  linearMilestonesIndexPath,
  linearProjectsIndexPath,
  linearRoadmapsIndexPath,
  linearTeamsIndexPath,
  linearUsersIndexPath,
} from './path-mapper.js';
import type { LinearBaseIndexRow, LinearIssueIndexRow } from './queries.js';

export type LinearIndexBucket =
  | 'comments'
  | 'cycles'
  | 'issues'
  | 'milestones'
  | 'projects'
  | 'roadmaps'
  | 'teams'
  | 'users';

export interface LinearIndexFile {
  path: string;
  contentType: 'application/json; charset=utf-8';
  content: string;
}

export function buildLinearIndexFile(
  bucket: 'comments' | 'cycles' | 'milestones' | 'projects' | 'roadmaps' | 'teams' | 'users',
  rows: LinearBaseIndexRow[],
): LinearIndexFile;
export function buildLinearIndexFile(
  bucket: 'issues',
  rows: LinearIssueIndexRow[],
): LinearIndexFile;
export function buildLinearIndexFile(
  bucket: LinearIndexBucket,
  rows: Array<LinearBaseIndexRow | LinearIssueIndexRow>,
): LinearIndexFile {
  const sortedRows = [...rows].sort(compareIndexRows(bucket));
  return {
    path: indexPathForBucket(bucket),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(sortedRows)}\n`,
  };
}

function indexPathForBucket(bucket: LinearIndexBucket): string {
  switch (bucket) {
    case 'issues':
      return linearIssuesIndexPath();
    case 'comments':
      return linearCommentsIndexPath();
    case 'cycles':
      return linearCyclesIndexPath();
    case 'milestones':
      return linearMilestonesIndexPath();
    case 'projects':
      return linearProjectsIndexPath();
    case 'roadmaps':
      return linearRoadmapsIndexPath();
    case 'users':
      return linearUsersIndexPath();
    case 'teams':
      return linearTeamsIndexPath();
  }
}

function compareIndexRows(bucket: LinearIndexBucket) {
  return (left: LinearBaseIndexRow | LinearIssueIndexRow, right: LinearBaseIndexRow | LinearIssueIndexRow): number => {
    if (left.updated !== right.updated) {
      return right.updated.localeCompare(left.updated);
    }
    return left.id.localeCompare(right.id);
  };
}
