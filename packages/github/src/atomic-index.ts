import type { IngestResult, VfsLike } from './files/content-fetcher.js';
import {
  buildRepoIndexFile,
  type GitHubRecordIndexRow,
  type GitHubRepoIndexRow,
  parseIndexRows,
} from './index-emitter.js';
import { githubReposIndexPath } from './path-mapper.js';

/**
 * Optimistic compare-and-swap (CAS) upsert for `_index.json` files.
 *
 * Concurrent ingestions can race when the read-modify-write pattern
 * `read existing rows -> upsert -> write` is not atomic: two writers read
 * the same baseline, each compute their own merged result, and the second
 * write silently overwrites the first row.
 *
 * The helper reads both content and the file revision (when the VFS
 * exposes that metadata), submits a write tagged with `baseRevision`, and
 * retries the read-merge-write loop on conflict. Backends without revision
 * support degrade to plain read-modify-write — the race remains in those
 * legacy backends but is not regressed by this helper.
 */

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 50;

export interface AtomicUpsertOptions {
  /**
   * Maximum number of CAS attempts before throwing
   * {@link AtomicIndexExhaustedError}. Defaults to 5.
   */
  maxAttempts?: number;
  /**
   * Linear backoff base in milliseconds. Each retry waits
   * `baseDelayMs * attemptNumber`. Defaults to 50ms.
   */
  baseDelayMs?: number;
  /**
   * Optional sleep override, primarily exposed for tests so they don't have
   * to wait on real timers.
   */
  sleep?: (ms: number) => Promise<void>;
}

export interface AtomicReadResult<TContent> {
  content: TContent | undefined;
  revision: string;
}

export class AtomicIndexExhaustedError extends Error {
  readonly path: string;
  readonly attempts: number;

  constructor(path: string, attempts: number, cause?: unknown) {
    super(
      `atomic index upsert exceeded ${attempts} attempts for ${path}` +
        (cause instanceof Error ? `: ${cause.message}` : ''),
    );
    this.name = 'AtomicIndexExhaustedError';
    this.path = path;
    this.attempts = attempts;
    if (cause !== undefined) {
      // Preserve the underlying cause for diagnostics without forcing
      // dependents to introspect a bespoke field.
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Read a text file plus its revision from the VFS.
 *
 * - If the VFS reader returns `{ content, revision }`, both are surfaced.
 * - If the reader returns a plain string, revision falls back to `"0"`
 *   (sentinel meaning "no prior revision known").
 * - If the file is missing, `content` is `undefined` and revision is `"0"`.
 */
export async function readIndexWithRevision(
  vfs: VfsLike,
  path: string,
): Promise<AtomicReadResult<string>> {
  for (const reader of [vfs.readFile, vfs.read, vfs.get]) {
    if (!reader) {
      continue;
    }

    try {
      const value = await reader.call(vfs, path);
      if (value === null || value === undefined) {
        continue;
      }
      if (typeof value === 'string') {
        return { content: value, revision: '0' };
      }
      if (typeof value === 'object') {
        const record = value as { content?: unknown; revision?: unknown };
        const content = typeof record.content === 'string' ? record.content : undefined;
        const revision = typeof record.revision === 'string' ? record.revision : '0';
        if (content !== undefined) {
          return { content, revision };
        }
      }
    } catch {
      // A throwing reader should not abort the loop — fall through to the
      // next available reader so we still surface text from working backends.
      continue;
    }
  }

  return { content: undefined, revision: '0' };
}

/**
 * Write a text file via any of the writer aliases the VFS exposes, passing
 * `baseRevision` so revision-aware backends can perform a compare-and-swap.
 *
 * The third argument is positional rather than an options bag because the
 * majority of legacy VFS shims spread the call as `(path, content, ...rest)`
 * and ignore extra positional args; switching to an object would silently
 * regress them.
 */
export async function writeIndexWithRevision(
  vfs: VfsLike,
  path: string,
  content: string,
  baseRevision: string,
): Promise<void> {
  const writer =
    vfs.writeFile ?? vfs.write ?? vfs.put ?? vfs.set ?? vfs.upsert;

  if (!writer) {
    throw new Error(
      'VFS object must expose one of writeFile(path, content), write(path, content), put(path, content), set(path, content), or upsert(path, content).',
    );
  }

  // Pass `baseRevision` as a 3rd positional options arg so revision-aware
  // VFS shims (e.g. relayfile-client) can perform a CAS write. Legacy shims
  // ignore the extra positional arg, so this is safe.
  const variadicWriter = writer as unknown as (
    this: VfsLike,
    path: string,
    content: string,
    options?: { baseRevision?: string },
  ) => Promise<unknown> | unknown;
  await variadicWriter.call(vfs, path, content, { baseRevision });
}

/**
 * Detect a relayfile / VFS revision-conflict error without taking a hard
 * dependency on the SDK error class — we duck-type on the standard shapes:
 *
 * - `RevisionConflictError` from `@relayfile/sdk` (`name === 'RevisionConflictError'`).
 * - HTTP 409 responses surfaced as plain Errors with a `status` field.
 * - Errors carrying a `code === 'revision_conflict'` field.
 */
export function isConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };

  if (candidate.name === 'RevisionConflictError') {
    return true;
  }
  if (candidate.status === 409 || candidate.statusCode === 409) {
    return true;
  }
  if (candidate.code === 'revision_conflict') {
    return true;
  }
  return false;
}

/**
 * Upsert a JSON-encoded `_index.json` file using optimistic CAS retries.
 *
 * The caller supplies `parse` (string -> rows), `merge` (rows -> rows), and
 * `serialize` (rows -> bytes). Each attempt re-reads the existing rows, runs
 * `merge` against them (so concurrent rows added by another writer survive),
 * and writes with the just-observed revision as `baseRevision`. On conflict
 * we back off linearly and try again, up to {@link AtomicUpsertOptions.maxAttempts}.
 */
export async function upsertIndexAtomic<TRow>(
  vfs: VfsLike,
  path: string,
  parse: (content: string | undefined) => TRow[],
  merge: (rows: TRow[]) => TRow[],
  serialize: (rows: TRow[]) => string,
  options: AtomicUpsertOptions = {},
): Promise<{ existedAtWrite: boolean }> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  if (maxAttempts < 1) {
    throw new Error('upsertIndexAtomic: maxAttempts must be >= 1');
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { content, revision } = await readIndexWithRevision(vfs, path);
    const merged = merge(parse(content));
    const next = serialize(merged);

    try {
      await writeIndexWithRevision(vfs, path, next, revision);
      // The read that produced the winning baseRevision is authoritative for
      // existed-vs-new accounting: another writer cannot have raced us between
      // this read and the matching CAS write without us seeing a conflict and
      // looping.
      return { existedAtWrite: content !== undefined };
    } catch (error) {
      if (!isConflictError(error)) {
        throw error;
      }
      lastError = error;
      // Re-read on conflict; another writer beat us. Linear backoff prevents
      // tight-looping a single hot index path while still resolving quickly.
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelayMs * (attempt + 1));
      }
    }
  }

  throw new AtomicIndexExhaustedError(path, maxAttempts, lastError);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
