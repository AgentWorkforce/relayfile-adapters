/**
 * Stale alias lifecycle cleanup (issue #106).
 *
 * Adapters mirror provider records to a canonical path plus lookup aliases
 * (`by-title/…`, `by-name/…`). Aliases duplicate the canonical bytes
 * verbatim, and the title-independent `by-id` alias is rewritten on every
 * ingest — so the bytes sitting at the `by-id` alias path *before* a
 * re-ingest are a faithful snapshot of the previous record version. That
 * snapshot is the prior state consumed here: callers read it before
 * overwriting, derive the candidate alias paths the previous version may
 * occupy (base + collision variants), and this helper deletes every
 * candidate that still holds the previous record bytes.
 *
 * Content equality is the ownership proof: a candidate is deleted only when
 * its bytes match `previousContent`. This guarantees we never delete
 * (a) an alias owned by a different record that happens to share a slug
 * (collision case), (b) the freshly written alias for the current version
 * (its bytes are the new content), or (c) anything when the previous
 * version was never mirrored.
 *
 * Relayfile contract: a title change is an alias cleanup, never a record
 * deletion. Callers must only pass alias paths as candidates — canonical
 * record paths are never deleted by this helper's callers.
 *
 * See also `PriorAliasReader` in `emit-auxiliary` — the same "by-id alias
 * as prior-state anchor" convention for adapters built on the auxiliary
 * emitter client. This module is the IO-agnostic deletion side, usable
 * with both `RelayFileClientLike` and duck-typed `VfsLike` backends.
 */

export interface StaleAliasCleanupIo {
  /** Returns file content, or `undefined` when missing/unreadable. */
  readFile(path: string): Promise<string | undefined> | string | undefined;
  /** Deletes the file at `path`. */
  deleteFile(path: string): Promise<unknown> | unknown;
}

export interface StaleAliasCleanupInput {
  /**
   * Bytes of the record as previously mirrored — read from a
   * title-independent alias (e.g. `by-id/…`) before it was overwritten.
   */
  previousContent: string;
  /**
   * Alias paths the previous record version may occupy. Derive from the
   * previous title/name (base + collision variants).
   */
  candidatePaths: readonly string[];
  /**
   * Alias paths belonging to the current record version. Never deleted,
   * even when a candidate path matches.
   */
  keepPaths?: readonly string[];
}

export interface StaleAliasCleanupResult {
  deletedPaths: string[];
  errors: Array<{ path: string; error: string }>;
}

/**
 * Deletes stale alias files left behind when a record's alias-relevant
 * field (title/name) changed between ingests. Failures are captured per
 * path and never thrown — a leftover stale alias is benign, while failing
 * the surrounding ingest is not.
 */
export async function cleanupStaleAliases(
  io: StaleAliasCleanupIo,
  input: StaleAliasCleanupInput,
): Promise<StaleAliasCleanupResult> {
  const result: StaleAliasCleanupResult = { deletedPaths: [], errors: [] };
  const keep = new Set(input.keepPaths ?? []);
  const seen = new Set<string>();

  for (const candidate of input.candidatePaths) {
    if (!candidate || keep.has(candidate) || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    let existing: string | undefined;
    try {
      existing = await io.readFile(candidate);
    } catch (error) {
      result.errors.push({ path: candidate, error: formatError(error) });
      continue;
    }

    if (existing === undefined || existing !== input.previousContent) {
      continue;
    }

    try {
      await io.deleteFile(candidate);
      result.deletedPaths.push(candidate);
    } catch (error) {
      result.errors.push({ path: candidate, error: formatError(error) });
    }
  }

  return result;
}

/**
 * Extracts a top-level string field from mirrored JSON record content.
 * Returns `undefined` when the content is not parseable JSON or the field
 * is missing/non-string — callers treat that as "no prior alias to clean".
 */
export function readAliasKeyFromContent(content: string, ...fieldPath: readonly string[]): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return undefined;
  }

  for (const field of fieldPath) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[field];
  }

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
