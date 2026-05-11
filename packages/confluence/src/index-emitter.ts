import {
  confluencePagesIndexPath,
  confluenceSpacesIndexPath,
} from './path-mapper.js';
import type { ConfluenceBaseIndexRow, ConfluencePageIndexRow, ConfluenceSpaceIndexRow } from './queries.js';

export type ConfluenceIndexBucket = 'pages' | 'spaces';

export interface ConfluenceIndexFile {
  path: string;
  contentType: 'application/json; charset=utf-8';
  content: string;
}

export function buildConfluenceIndexFile(
  bucket: 'pages',
  rows: ConfluencePageIndexRow[],
): ConfluenceIndexFile;
export function buildConfluenceIndexFile(
  bucket: 'spaces',
  rows: ConfluenceSpaceIndexRow[],
): ConfluenceIndexFile;
export function buildConfluenceIndexFile(
  bucket: ConfluenceIndexBucket,
  rows: Array<ConfluenceBaseIndexRow>,
): ConfluenceIndexFile {
  const sortedRows = [...rows].sort(compareIndexRows());
  return {
    path: indexPathForBucket(bucket),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(sortedRows)}\n`,
  };
}

function indexPathForBucket(bucket: ConfluenceIndexBucket): string {
  switch (bucket) {
    case 'pages':
      return confluencePagesIndexPath();
    case 'spaces':
      return confluenceSpacesIndexPath();
  }
}

function compareIndexRows() {
  return (left: ConfluenceBaseIndexRow, right: ConfluenceBaseIndexRow): number => {
    if (left.updated !== right.updated) {
      return right.updated.localeCompare(left.updated);
    }
    return left.id.localeCompare(right.id);
  };
}
