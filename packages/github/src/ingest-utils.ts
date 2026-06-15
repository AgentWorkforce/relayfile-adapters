import type { IngestResult, VfsLike } from './files/content-fetcher.js';

/**
 * Shared VFS / {@link IngestResult} helpers used by both the webhook handlers
 * (`index.ts`) and the materialization mappers (`issues/issue-mapper.ts`). Kept
 * in one place so the two call sites cannot drift apart.
 */

export function createEmptyIngestResult(): IngestResult {
  return {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
  };
}

export function mergeIngestResults(...results: IngestResult[]): IngestResult {
  return results.reduce<IngestResult>((combined, result) => {
    combined.filesWritten += result.filesWritten;
    combined.filesUpdated += result.filesUpdated;
    combined.filesDeleted += result.filesDeleted;
    combined.paths.push(...result.paths);
    combined.errors.push(...result.errors);
    return combined;
  }, createEmptyIngestResult());
}

/**
 * Best-effort existence check across the VFS method surface. Returns `false`
 * (never throws) when the path is absent or no probe method is available, so
 * callers can treat the result as a plain boolean.
 */
export async function vfsPathExists(vfs: VfsLike, path: string): Promise<boolean> {
  if (typeof vfs.exists === 'function') {
    return Boolean(await vfs.exists(path));
  }
  if (typeof vfs.has === 'function') {
    return Boolean(await vfs.has(path));
  }
  if (typeof vfs.stat === 'function') {
    try {
      const value = await vfs.stat(path);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  }
  for (const reader of [vfs.readFile, vfs.read, vfs.get]) {
    if (!reader) {
      continue;
    }
    try {
      const value = await reader.call(vfs, path);
      return value !== null && value !== undefined;
    } catch {
      return false;
    }
  }
  return false;
}
