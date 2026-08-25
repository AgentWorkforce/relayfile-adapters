import {
  githubCommitPath,
  githubRepoCommitsIndexPath,
  githubRepoIssuesIndexPath,
  githubRepoPullsIndexPath,
  githubReposIndexPath,
  githubRootIndexPath,
} from './path-mapper.js';
import type { VfsLike } from './files/content-fetcher.js';

export interface GitHubRepoIndexRow {
  id: string;
  title: string;
  updated: string;
}

export interface GitHubRecordIndexRow extends GitHubRepoIndexRow {
  number: number;
  state: string;
  // Label names carried inline so label-gated consumers (e.g. the factory's
  // `factory`-label gate) can filter on the index without reading every
  // `meta.json`. Additive field — older readers ignore it. See issue #176.
  labels?: string[];
  assigneeKeys?: string[];
  creatorKey?: string;
  priority?: string;
  // Merge lifecycle carried inline (pull requests only) so time-windowed
  // consumers — e.g. a "what merged in the last 24h" digest — can filter the
  // index alone without opening every `meta.json`. `merged` is true once the PR
  // has a merge timestamp; `mergedAt` is the ISO 8601 `merged_at`. Both are
  // omitted for issues and for unmerged PRs. Additive — older readers ignore it.
  merged?: boolean;
  mergedAt?: string;
  // Source branch name (pull requests only). GitHub returns `head.ref` on every
  // row of `GET /repos/{owner}/{repo}/pulls`, and branch name is the primary
  // signal consumers use to answer "which PR implements this issue?". Carrying
  // it inline lets a consumer resolve that from the index alone instead of
  // opening every pull record. Absent on issue rows, and absent on pull rows
  // written before this field existed. Additive — older readers ignore it.
  // See issue #271.
  headRef?: string;
}

export interface GitHubCommitIndexRow extends GitHubRepoIndexRow {
  sha: string;
  message: string;
  authorLogin: string;
  committedAt: string;
  canonicalPath: string;
}

export interface GitHubCommitIndexInput {
  sha: string;
  message?: string | null;
  authorLogin?: string | null;
  committedAt?: string | null;
}

export function buildGitHubCommitIndexRow(
  owner: string,
  repo: string,
  input: GitHubCommitIndexInput,
): GitHubCommitIndexRow {
  const message = input.message?.split('\n')[0]?.trim() ?? '';
  const committedAt = input.committedAt?.trim() ?? '';
  return {
    id: input.sha,
    title: message || input.sha,
    updated: committedAt,
    sha: input.sha,
    message,
    authorLogin: input.authorLogin?.trim() ?? '',
    committedAt,
    canonicalPath: githubCommitPath(owner, repo, input.sha),
  };
}

/** Add merge lifecycle fields to a pull-request index row when GitHub supplies a timestamp. */
export function pullRequestMergeIndexFields(
  mergedAt: string | null | undefined,
): Partial<Pick<GitHubRecordIndexRow, 'merged' | 'mergedAt'>> {
  const normalized = mergedAt?.trim();
  return normalized ? { merged: true, mergedAt: normalized } : {};
}

export interface GitHubRootIndexRow {
  id: string;
  title: string;
}

export interface GitHubIndexFile {
  path: string;
  contentType: 'application/json; charset=utf-8';
  content: string;
}

/**
 * Build `/github/_index.json` — a static listing of top-level resource roots
 * the GitHub adapter exposes. Mirrors the slack pattern so an agent can
 * `ls /github/` and orient.
 */
export function buildGitHubRootIndexFile(
  rows: GitHubRootIndexRow[] = [{ id: 'repos', title: 'Repositories' }],
): GitHubIndexFile {
  return {
    path: githubRootIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(rows)}\n`,
  };
}

export function buildRepoIndexFile(rows: GitHubRepoIndexRow[]): GitHubIndexFile {
  return {
    path: githubReposIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareRepoRows))}\n`,
  };
}

export function buildRepoIssuesIndexFile(
  owner: string,
  repo: string,
  rows: GitHubRecordIndexRow[],
): GitHubIndexFile {
  return {
    path: githubRepoIssuesIndexPath(owner, repo),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareRecordRows))}\n`,
  };
}

export function buildRepoPullsIndexFile(
  owner: string,
  repo: string,
  rows: GitHubRecordIndexRow[],
): GitHubIndexFile {
  return {
    path: githubRepoPullsIndexPath(owner, repo),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareRecordRows))}\n`,
  };
}

export function buildRepoCommitsIndexFile(
  owner: string,
  repo: string,
  rows: GitHubCommitIndexRow[],
): GitHubIndexFile {
  return {
    path: githubRepoCommitsIndexPath(owner, repo),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify([...rows].sort(compareRepoRows))}\n`,
  };
}

export async function readRepoIndexRows(
  vfs: VfsLike,
): Promise<GitHubRepoIndexRow[]> {
  const path = githubReposIndexPath();
  return normalizeRepoIndexRows(parseIndexRows<unknown>(await readVfsText(vfs, path), { path }));
}

export async function readRecordIndexRows(
  vfs: VfsLike,
  path: string,
): Promise<GitHubRecordIndexRow[]> {
  return normalizeRecordIndexRows(parseIndexRows<unknown>(await readVfsText(vfs, path), { path }));
}

export function upsertRepoIndexRow(
  rows: GitHubRepoIndexRow[],
  row: GitHubRepoIndexRow,
): GitHubRepoIndexRow[] {
  return upsertIndexRow(rows, row);
}

export function upsertRecordIndexRow(
  rows: GitHubRecordIndexRow[],
  row: GitHubRecordIndexRow,
): GitHubRecordIndexRow[] {
  return upsertIndexRow(rows, row);
}

export function upsertCommitIndexRow(
  rows: GitHubCommitIndexRow[],
  row: GitHubCommitIndexRow,
): GitHubCommitIndexRow[] {
  return upsertIndexRow(rows, row);
}

function compareRepoRows(left: GitHubRepoIndexRow, right: GitHubRepoIndexRow): number {
  // `?? ''` guards rows recovered from an older on-disk index, which may be
  // missing `updated`/`id` entirely. Sorting must never throw on ingest.
  const leftUpdated = left.updated ?? '';
  const rightUpdated = right.updated ?? '';
  if (leftUpdated !== rightUpdated) {
    return rightUpdated.localeCompare(leftUpdated);
  }
  return (left.id ?? '').localeCompare(right.id ?? '');
}

function compareRecordRows(left: GitHubRecordIndexRow, right: GitHubRecordIndexRow): number {
  const leftUpdated = left.updated ?? '';
  const rightUpdated = right.updated ?? '';
  if (leftUpdated !== rightUpdated) {
    return rightUpdated.localeCompare(leftUpdated);
  }
  if (left.number !== right.number) {
    return (left.number ?? 0) - (right.number ?? 0);
  }
  return (left.id ?? '').localeCompare(right.id ?? '');
}

async function readVfsText(vfs: VfsLike, path: string): Promise<string | undefined> {
  for (const reader of [vfs.readFile, vfs.read, vfs.get]) {
    if (!reader) {
      continue;
    }

    try {
      const value = await reader.call(vfs, path);
      if (typeof value === 'string') {
        return value;
      }
    } catch {
      // A throwing reader should not abort the loop — fall through to the
      // next available reader so we still surface text from working backends.
      continue;
    }
  }

  return undefined;
}

/**
 * Keys a pre-array writer used to wrap its rows under. The eager backfill in
 * `lazy.ts` wrote `{ "repos": [...] }`, `{ "issues": [...] }`, and
 * `{ "pulls": [...] }` before this adapter converged on the documented
 * top-level array (issue #271); an already-ingested mount can still hold one.
 */
const LEGACY_INDEX_WRAPPER_KEYS = ['repos', 'issues', 'pulls', 'commits'] as const;

export interface ParseIndexRowsOptions {
  /**
   * Mount path of the index being parsed. Used only to make a shape-mismatch
   * warning actionable — every index file is named `_index.json`, so the
   * warning is useless without the enclosing path.
   */
  path?: string;
}

/**
 * Parse an index file into rows.
 *
 * The documented, canonical shape is a bare top-level array (see
 * `GITHUB_LAYOUT_PROMPT`). A legacy `{ "<kind>": [...] }` wrapper is still
 * accepted so a mount ingested by an older adapter keeps working across the
 * upgrade; the next write rewrites it as an array.
 *
 * Every unrecognised shape is warned about before falling back to `[]`. The
 * fallback is deliberate — a malformed index must never abort an ingest — but
 * it used to be *silent*, which is how a permanent shape divergence survived
 * in production unnoticed (issue #271). Behaviour is unchanged; only the
 * visibility is new.
 */
export function parseIndexRows<T>(
  content: string | undefined,
  options: ParseIndexRowsOptions = {},
): T[] {
  if (!content) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    warnIndexShapeMismatch(
      options.path,
      `is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed as T[];
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;

    for (const key of LEGACY_INDEX_WRAPPER_KEYS) {
      const rows = record[key];
      if (Array.isArray(rows)) {
        warnIndexShapeMismatch(
          options.path,
          `uses the legacy \`{ "${key}": [...] }\` wrapper instead of the documented top-level array; ` +
            'the rows were recovered and the next write rewrites the file as an array',
        );
        return rows as T[];
      }
    }

    if (Array.isArray(record.rows)) {
      warnIndexShapeMismatch(
        options.path,
        'holds an alias directory manifest (`{ "rows": [{ "title", "file" }] }`), not record rows — ' +
          'the alias namespace `/github/repos/<owner>__<repo>/<kind>/_index.json` and the canonical ' +
          'record index share the `_index.json` filename (issue #271)',
      );
      return [];
    }
  }

  warnIndexShapeMismatch(
    options.path,
    'is neither the documented top-level array nor a recognised legacy wrapper; treating it as empty',
  );
  return [];
}

function warnIndexShapeMismatch(path: string | undefined, detail: string): void {
  console.warn(`GitHub index shape mismatch: ${path ?? '<unknown index path>'} ${detail}.`);
}

/**
 * Coerce rows recovered from an older on-disk index into valid
 * {@link GitHubRecordIndexRow}s. Legacy `{ "pulls": [...] }` rows carried
 * `{ number, title, state, url }` — no `id` and no `updated` — which the row
 * comparators and the `id`-keyed upsert both assume are present. Rows without
 * a usable number are dropped rather than written back malformed.
 */
export function normalizeRecordIndexRows(rows: readonly unknown[]): GitHubRecordIndexRow[] {
  const normalized: GitHubRecordIndexRow[] = [];

  for (const candidate of rows) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }

    const row = candidate as Record<string, unknown>;
    const number = readFiniteNumber(row.number) ?? readFiniteNumber(row.id);
    const id = readNonEmptyText(row.id) ?? (number === undefined ? undefined : String(number));
    if (id === undefined || number === undefined) {
      continue;
    }

    normalized.push({
      ...(row as Partial<GitHubRecordIndexRow>),
      id,
      number,
      title: readNonEmptyText(row.title) ?? '',
      state: readNonEmptyText(row.state) ?? '',
      updated:
        readNonEmptyText(row.updated) ??
        readNonEmptyText(row.updated_at) ??
        readNonEmptyText(row.updatedAt) ??
        '',
    });
  }

  return normalized;
}

/**
 * Coerce rows recovered from an older `/github/repos/_index.json` into valid
 * {@link GitHubRepoIndexRow}s. The legacy eager writer stored
 * `{ owner, repo, url }` rows with no `id`, `title`, or `updated`.
 */
export function normalizeRepoIndexRows(rows: readonly unknown[]): GitHubRepoIndexRow[] {
  const normalized: GitHubRepoIndexRow[] = [];

  for (const candidate of rows) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }

    const row = candidate as Record<string, unknown>;
    const owner = readNonEmptyText(row.owner);
    const repo = readNonEmptyText(row.repo);
    const id = readNonEmptyText(row.id) ?? (owner && repo ? `${owner}/${repo}` : undefined);
    if (id === undefined) {
      continue;
    }

    normalized.push({
      ...(row as Partial<GitHubRepoIndexRow>),
      id,
      title: readNonEmptyText(row.title) ?? id,
      updated:
        readNonEmptyText(row.updated) ??
        readNonEmptyText(row.updated_at) ??
        readNonEmptyText(row.pushed_at) ??
        '',
    });
  }

  return normalized;
}

function readNonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function upsertIndexRow<T extends { id: string }>(rows: T[], row: T): T[] {
  return [...rows.filter((existing) => existing.id !== row.id), row];
}
