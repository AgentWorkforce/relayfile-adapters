import {
  linearCyclesIndexPath,
  linearCommentsIndexPath,
  linearIssuesIndexPath,
  linearLabelsIndexPath,
  linearMilestonesIndexPath,
  linearProjectsIndexPath,
  linearRootIndexPath,
  linearRoadmapsIndexPath,
  linearStatesIndexPath,
  linearTeamsIndexPath,
  linearUsersIndexPath,
} from './path-mapper.js';
import type { LinearBaseIndexRow, LinearIssueIndexRow } from './queries.js';

export type LinearIndexBucket =
  | 'comments'
  | 'cycles'
  | 'issues'
  | 'labels'
  | 'milestones'
  | 'projects'
  | 'roadmaps'
  | 'states'
  | 'teams'
  | 'users';

export interface LinearIndexFile {
  path: string;
  contentType: 'application/json; charset=utf-8';
  content: string;
}

export interface LinearRootIndexRow {
  id: string;
  title: string;
}

/**
 * Build `/linear/_index.json` — a static listing of top-level resource
 * roots the Linear adapter exposes. Mirrors the slack pattern so an agent
 * can `ls /linear/` and discover the available buckets.
 */
export function buildLinearRootIndexFile(
  rows: LinearRootIndexRow[] = [
    { id: 'issues', title: 'Issues' },
    { id: 'comments', title: 'Comments' },
    { id: 'labels', title: 'Labels' },
    { id: 'teams', title: 'Teams' },
    { id: 'users', title: 'Users' },
    { id: 'projects', title: 'Projects' },
    { id: 'states', title: 'Workflow States' },
    { id: 'cycles', title: 'Cycles' },
    { id: 'milestones', title: 'Milestones' },
    { id: 'roadmaps', title: 'Roadmaps' },
  ],
): LinearIndexFile {
  return {
    path: linearRootIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(rows)}\n`,
  };
}

export function buildLinearIndexFile(
  bucket: 'comments' | 'cycles' | 'labels' | 'milestones' | 'projects' | 'roadmaps' | 'teams' | 'users',
  rows: LinearBaseIndexRow[],
): LinearIndexFile;
export function buildLinearIndexFile(
  bucket: 'states',
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
    case 'labels':
      return linearLabelsIndexPath();
    case 'comments':
      return linearCommentsIndexPath();
    case 'cycles':
      return linearCyclesIndexPath();
    case 'milestones':
      return linearMilestonesIndexPath();
    case 'projects':
      return linearProjectsIndexPath();
    case 'states':
      return linearStatesIndexPath();
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
