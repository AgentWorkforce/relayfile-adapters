import type { GitLabDiffEntry } from '../types.js';

export interface ParsedDiffFile {
  additions: number;
  deletions: number;
  patch: string;
  path: string;
  status: 'deleted' | 'modified' | 'new' | 'renamed';
}

function computeFileStatus(entry: GitLabDiffEntry): ParsedDiffFile['status'] {
  if (entry.new_file) {
    return 'new';
  }
  if (entry.deleted_file) {
    return 'deleted';
  }
  if (entry.renamed_file) {
    return 'renamed';
  }
  return 'modified';
}

function buildFileHeader(entry: GitLabDiffEntry): string {
  const oldPath = entry.old_path;
  const newPath = entry.new_path;
  const fromPath = entry.deleted_file ? '/dev/null' : `a/${oldPath}`;
  const toPath = entry.new_file ? '/dev/null' : `b/${newPath}`;

  return [
    `diff --git a/${oldPath} b/${newPath}`,
    `--- ${fromPath}`,
    `+++ ${toPath}`,
  ].join('\n');
}

function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

export function renderMergeRequestPatch(entries: GitLabDiffEntry[]): string {
  return entries
    .map((entry) => `${buildFileHeader(entry)}\n${entry.diff.trimEnd()}`.trimEnd())
    .join('\n\n')
    .trim();
}

export function parseDiffEntries(entries: GitLabDiffEntry[]): ParsedDiffFile[] {
  return entries.map((entry) => {
    const counts = countDiffLines(entry.diff);
    return {
      ...counts,
      path: entry.new_path,
      patch: `${buildFileHeader(entry)}\n${entry.diff.trimEnd()}`.trimEnd(),
      status: computeFileStatus(entry),
    };
  });
}
