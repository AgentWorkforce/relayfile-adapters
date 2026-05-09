import {
  AtomicIndexExhaustedError,
  type AtomicReadResult,
  type AtomicUpsertOptions,
  isConflictError,
  readIndexWithRevision,
  upsertIndexAtomic,
  writeIndexWithRevision,
} from '@relayfile/adapter-core';

import type { IngestResult, VfsLike } from './files/content-fetcher.js';
import {
  buildRepoIndexFile,
  type GitHubRecordIndexRow,
  type GitHubRepoIndexRow,
  parseIndexRows,
} from './index-emitter.js';
import { githubReposIndexPath } from './path-mapper.js';

/**
 * GitHub-flavoured wrappers around the generic CAS upsert helpers.
 *
 * The generic primitives — `upsertIndexAtomic`, `isConflictError`,
 * `readIndexWithRevision`, `writeIndexWithRevision`, `AtomicIndexExhaustedError` —
 * now live in `@relayfile/adapter-core` so linear, notion, and any future
 * adapter can share a single source of truth. This module keeps the
 * github-specific record/repo index wrappers and continues to re-export
 * the primitives so existing in-package imports keep working.
 */

export {
  AtomicIndexExhaustedError,
  isConflictError,
  readIndexWithRevision,
  upsertIndexAtomic,
  writeIndexWithRevision,
};
export type { AtomicReadResult, AtomicUpsertOptions };

/**
 * CAS upsert for a per-repo record index (`issues/_index.json` /
 * `pulls/_index.json`). Returns an {@link IngestResult} so the call is a
 * drop-in replacement for the existing read-then-`writeTextFile` pattern.
 */
export async function atomicUpsertRecordIndex(
  vfs: VfsLike,
  path: string,
  merge: (rows: GitHubRecordIndexRow[]) => GitHubRecordIndexRow[],
  serialize: (rows: GitHubRecordIndexRow[]) => string,
  options?: AtomicUpsertOptions,
): Promise<IngestResult> {
  return runAtomicIndexWrite(
    vfs,
    path,
    (content) => parseIndexRows<GitHubRecordIndexRow>(content),
    merge,
    serialize,
    options,
  );
}

/**
 * CAS upsert for the global repos index (`/github/repos/_index.json`).
 */
export async function atomicUpsertRepoIndex(
  vfs: VfsLike,
  merge: (rows: GitHubRepoIndexRow[]) => GitHubRepoIndexRow[],
  options?: AtomicUpsertOptions,
): Promise<IngestResult> {
  const path = githubReposIndexPath();
  return runAtomicIndexWrite(
    vfs,
    path,
    (content) => parseIndexRows<GitHubRepoIndexRow>(content),
    merge,
    (rows) => buildRepoIndexFile(rows).content,
    options,
  );
}

async function runAtomicIndexWrite<TRow>(
  vfs: VfsLike,
  path: string,
  parse: (content: string | undefined) => TRow[],
  merge: (rows: TRow[]) => TRow[],
  serialize: (rows: TRow[]) => string,
  options?: AtomicUpsertOptions,
): Promise<IngestResult> {
  try {
    const { existedAtWrite } = await upsertIndexAtomic(
      vfs,
      path,
      parse,
      merge,
      serialize,
      options,
    );
    return {
      filesWritten: existedAtWrite ? 0 : 1,
      filesUpdated: existedAtWrite ? 1 : 0,
      filesDeleted: 0,
      paths: [path],
      errors: [],
    };
  } catch (error) {
    return {
      filesWritten: 0,
      filesUpdated: 0,
      filesDeleted: 0,
      paths: [],
      errors: [{ path, error: error instanceof Error ? error.message : String(error) }],
    };
  }
}
