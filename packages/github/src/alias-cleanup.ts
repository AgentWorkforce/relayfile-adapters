import { cleanupStaleAliases, readAliasKeyFromContent } from '@relayfile/adapter-core';

import type { VfsLike } from './files/content-fetcher.js';
import { githubNumberedByTitleAliasPath } from './path-mapper.js';

/**
 * Removes the stale `by-title` alias left behind when an issue or pull
 * request title changes between ingests (issue #106).
 *
 * Prior state comes from the mirror itself: the title-independent `by-id`
 * alias stores the canonical bytes of the previous record version. Callers
 * read it *before* overwriting it and pass the bytes as `previousContent`.
 * The previous title is extracted from that snapshot, the alias paths the
 * previous version may occupy (base + collision variants) are derived, and
 * each candidate is deleted only when its bytes still match the previous
 * snapshot — proving it belonged to this record and not to a different
 * record sharing the slug, and never touching the freshly written alias.
 *
 * Relayfile contract: a title change is an alias cleanup, not a record
 * deletion — only `by-title` alias paths are ever deleted here; canonical
 * record files are never candidates.
 *
 * No-ops when the VFS exposes no delete capability or when prior state is
 * unavailable. Never throws — a leftover stale alias is benign, failing the
 * ingest is not.
 */
export async function cleanupStaleGitHubTitleAliases(
  vfs: VfsLike,
  owner: string,
  repo: string,
  kind: 'issues' | 'pulls',
  number: number,
  previousContent: string | undefined,
  keepPaths: readonly string[],
): Promise<string[]> {
  if (previousContent === undefined) {
    return [];
  }

  const deleteFile = resolveVfsDelete(vfs);
  if (!deleteFile) {
    return [];
  }

  const previousTitle = readAliasKeyFromContent(previousContent, 'title');
  if (!previousTitle?.trim()) {
    return [];
  }

  const candidatePaths: string[] = [];
  try {
    candidatePaths.push(
      githubNumberedByTitleAliasPath(owner, repo, kind, previousTitle, number),
      githubNumberedByTitleAliasPath(owner, repo, kind, previousTitle, number, true),
    );
  } catch {
    // Previous title slugs to an empty string — no alias was emitted for it.
    return [];
  }

  const { deletedPaths } = await cleanupStaleAliases(
    {
      readFile: (path) => readVfsContentForCleanup(vfs, path),
      deleteFile,
    },
    {
      previousContent,
      candidatePaths,
      keepPaths,
    },
  );

  return deletedPaths;
}

function resolveVfsDelete(vfs: VfsLike): ((path: string) => Promise<unknown>) | undefined {
  const remover = vfs.deleteFile ?? vfs.delete;
  if (!remover) {
    return undefined;
  }
  return async (path: string) => remover.call(vfs, path);
}

async function readVfsContentForCleanup(vfs: VfsLike, path: string): Promise<string | undefined> {
  const reader = vfs.readFile ?? vfs.read ?? vfs.get;
  if (!reader) {
    return undefined;
  }

  try {
    const value = await reader.call(vfs, path);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}
