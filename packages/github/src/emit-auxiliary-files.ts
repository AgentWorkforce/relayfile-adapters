/**
 * Adapter-owned auxiliary-file emission for GitHub.
 *
 * Phase 2 port of the cross-adapter `emitAuxiliaryFiles` contract defined
 * in `@relayfile/adapter-core` (introduced in #78 by way of the Confluence
 * reference port). This module generalizes the write-loop currently sitting
 * in `cloud/packages/core/src/sync/record-writer.ts` (`writeGitHubAuxiliaryFiles`)
 * so the same primitive can be reused from cloud's Phase 3 dispatcher and
 * shared with the other GitHub-shaped adapters that follow the same v2 layout.
 *
 * GitHub-specific shape vs Confluence:
 *
 * 1. GitHub is multi-tenant by `(owner, repo)`. Per-repo index files (issues
 *    + pulls) live at `/github/repos/<owner>/<repo>/{issues|pulls}/_index.json`,
 *    not at a single global path. We instantiate one `IndexFileReconciler`
 *    per `(owner, repo, kind)` triple that appears in the batch and flush
 *    each at the end — single read + single write per index file, matching
 *    cloud's existing behavior.
 * 2. There is also one global `/github/repos/_index.json` that lists every
 *    repository record. That gets its own reconciler.
 * 3. PR and issue canonical paths are DIRECTORY-form (`<n>__<slug>/meta.json`)
 *    because they own sub-artifacts (`diff.patch`, `files/**`, `base/**`,
 *    commit-level artifacts). On rename we delete the prior `meta.json` only,
 *    NOT the enclosing directory — the directory is shared with those
 *    sub-artifacts and must outlive the rename.
 * 4. Aliases live under `/github/repos/<owner>__<repo>/{pulls|issues}/by-*`
 *    per the helpers in `path-mapper.ts`. Issue-family aliases include id,
 *    title, state, assignee, creator, and priority when those fields are
 *    present. Only pulls + issues have aliases —
 *    reviews, review_comments, check_runs, commits are flat per-repo paths
 *    with no by-* views and no per-repo index entry (matches cloud's
 *    `writeGitHubAuxiliaryFiles`, which only iterates the three indexed
 *    types).
 *
 * Delete-tombstone contract (per #78): pass `{ id, _deleted: true }` — for
 * PRs/issues the `id` is the number as a string. For repositories it's
 * `<owner>/<repo>`. For reviews/comments/check_runs/commits the id is the
 * provider id / SHA — those records have no index row so the delete branch
 * just removes the canonical path.
 *
 * Reconciliation: PRs and issues anchor on the by-id alias (keyed only on
 * `<owner, repo, number>`), so a title rename still resolves the prior title
 * and we can remove the stale by-title alias plus the stale canonical
 * `meta.json` file. Reads degrade to a no-op when the client lacks
 * `readFile` (matches the Confluence port behavior).
 */

import {
  PriorAliasReader,
  IndexFileReconciler,
  runEmitBatch,
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitDelete,
  type EmitError,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import { slugifyAlias } from './alias-slug.js';
import {
  buildGitHubRootIndexFile,
  buildRepoIndexFile,
  buildRepoIssuesIndexFile,
  buildRepoPullsIndexFile,
  type GitHubRecordIndexRow,
  type GitHubRepoIndexRow,
} from './index-emitter.js';
import {
  githubByAssigneeAliasPath,
  githubByCreatorAliasPath,
  githubByIdAliasPath,
  githubByPriorityAliasPath,
  githubByStateAliasPath,
  githubByTitleAliasPath,
  githubCheckRunPath,
  githubCommitPath,
  githubIssuePath,
  githubLegacyByTitleAliasPath,
  githubNumberedByTitleAliasPath,
  githubPullRequestPath,
  githubRepoIssuesIndexPath,
  githubRepoPullsIndexPath,
  githubReposIndexPath,
  githubRepositoryMetaPath,
  githubRepositoryMetadataPath,
  githubReviewCommentPath,
  githubReviewPath,
} from './path-mapper.js';

const GITHUB_PROVIDER_NAME = 'github' as const;
const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;
const NUMBERED_DELETE_RECOVERY_REPO_SCAN_LIMIT = 25;

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

/**
 * Common repo context fields. Every record must surface owner + repo so the
 * emitter can scope paths and indexes; callers can attach them directly or
 * leave them off when `full_name` / `url` / `html_url` is present (we fall
 * back to those, matching cloud's `parseGitHubRepoFromRecord`).
 */
export interface GitHubRepoContext {
  owner?: string;
  repo?: string;
  full_name?: string;
  url?: string;
  html_url?: string;
  [key: string]: unknown;
}

export interface GitHubPullRequestEmitRecord extends GitHubRepoContext {
  number: number | string;
  title?: string;
  state?: string;
  assignees?: unknown[];
  user?: unknown;
  labels?: unknown[];
  priority?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface GitHubIssueEmitRecord extends GitHubRepoContext {
  number: number | string;
  title?: string;
  state?: string;
  assignees?: unknown[];
  user?: unknown;
  labels?: unknown[];
  priority?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface GitHubRepositoryEmitRecord extends GitHubRepoContext {
  updated_at?: string;
  updatedAt?: string;
  pushed_at?: string;
}

export interface GitHubReviewEmitRecord extends GitHubRepoContext {
  id: number | string;
}

export interface GitHubReviewCommentEmitRecord extends GitHubRepoContext {
  id: number | string;
}

export interface GitHubCheckRunEmitRecord extends GitHubRepoContext {
  id: number | string;
}

export interface GitHubCommitEmitRecord extends GitHubRepoContext {
  sha: string;
}

export type DeleteTombstone = { id: string; _deleted: true };

export type GitHubPullRequestEmitInput = GitHubPullRequestEmitRecord | DeleteTombstone;
export type GitHubIssueEmitInput = GitHubIssueEmitRecord | DeleteTombstone;
export type GitHubRepositoryEmitInput = GitHubRepositoryEmitRecord | DeleteTombstone;
export type GitHubReviewEmitInput = GitHubReviewEmitRecord | DeleteTombstone;
export type GitHubReviewCommentEmitInput = GitHubReviewCommentEmitRecord | DeleteTombstone;
export type GitHubCheckRunEmitInput = GitHubCheckRunEmitRecord | DeleteTombstone;
export type GitHubCommitEmitInput = GitHubCommitEmitRecord | DeleteTombstone;

/** A delete tombstone carrying owner/repo context so the emitter can target
 *  the right (owner, repo) scope. Used for reviews / comments / checks /
 *  commits and (optionally) PRs/issues when the caller already knows the
 *  enclosing repo. */
export interface ScopedDeleteTombstone extends DeleteTombstone {
  owner?: string;
  repo?: string;
  full_name?: string;
}

export interface GitHubEmitAuxiliaryFilesInput {
  workspaceId: string;
  pullRequests?: readonly (GitHubPullRequestEmitRecord | ScopedDeleteTombstone)[];
  issues?: readonly (GitHubIssueEmitRecord | ScopedDeleteTombstone)[];
  repositories?: readonly GitHubRepositoryEmitInput[];
  reviews?: readonly (GitHubReviewEmitRecord | ScopedDeleteTombstone)[];
  reviewComments?: readonly (GitHubReviewCommentEmitRecord | ScopedDeleteTombstone)[];
  checkRuns?: readonly (GitHubCheckRunEmitRecord | ScopedDeleteTombstone)[];
  commits?: readonly (GitHubCommitEmitRecord | ScopedDeleteTombstone)[];
  /** Optional connection id stamped into the rendered payload wrapper. */
  connectionId?: string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function emitGitHubAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: GitHubEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  const workspaceId = input.workspaceId;
  const pullRequests = input.pullRequests ?? [];
  const issues = input.issues ?? [];
  const repositories = input.repositories ?? [];
  const reviews = input.reviews ?? [];
  const reviewComments = input.reviewComments ?? [];
  const checkRuns = input.checkRuns ?? [];
  const commits = input.commits ?? [];

  // Always emit the root index, even for empty / single-bucket batches, so
  // `ls /github/` reliably surfaces the top-level resource buckets. Mirrors
  // the slack pattern from `emitSlackAuxiliaryFiles`.
  await writeRootIndex(client, workspaceId, aggregate);

  if (
    pullRequests.length === 0 &&
    issues.length === 0 &&
    repositories.length === 0 &&
    reviews.length === 0 &&
    reviewComments.length === 0 &&
    checkRuns.length === 0 &&
    commits.length === 0
  ) {
    return aggregate;
  }

  const priorReader = new PriorAliasReader(client, workspaceId);

  // Per-repo reconcilers for the indexed kinds. Lazily instantiated as we
  // encounter records in each repo so single-tenant batches don't allocate
  // the global repo-index reconciler unless needed.
  const pullReconcilers = new Map<string, IndexFileReconciler<GitHubRecordIndexRow>>();
  const issueReconcilers = new Map<string, IndexFileReconciler<GitHubRecordIndexRow>>();
  // Using a single-cell holder (instead of `let`) so closures that assign
  // to it don't trip TS's "never" narrowing on the post-loop null check.
  const repoReconcilerSlot: { current: IndexFileReconciler<GitHubRepoIndexRow> | null } = {
    current: null,
  };

  function getPullReconciler(owner: string, repo: string): IndexFileReconciler<GitHubRecordIndexRow> {
    const key = `${owner}/${repo}`;
    let r = pullReconcilers.get(key);
    if (!r) {
      r = new IndexFileReconciler<GitHubRecordIndexRow>({
        client,
        workspaceId,
        path: githubRepoPullsIndexPath(owner, repo),
        builder: (rows) => {
          const built = buildRepoPullsIndexFile(owner, repo, [...rows]);
          return { path: built.path, content: built.content, contentType: built.contentType };
        },
      });
      pullReconcilers.set(key, r);
    }
    return r;
  }

  function getIssueReconciler(owner: string, repo: string): IndexFileReconciler<GitHubRecordIndexRow> {
    const key = `${owner}/${repo}`;
    let r = issueReconcilers.get(key);
    if (!r) {
      r = new IndexFileReconciler<GitHubRecordIndexRow>({
        client,
        workspaceId,
        path: githubRepoIssuesIndexPath(owner, repo),
        builder: (rows) => {
          const built = buildRepoIssuesIndexFile(owner, repo, [...rows]);
          return { path: built.path, content: built.content, contentType: built.contentType };
        },
      });
      issueReconcilers.set(key, r);
    }
    return r;
  }

  function getRepoReconciler(): IndexFileReconciler<GitHubRepoIndexRow> {
    if (!repoReconcilerSlot.current) {
      repoReconcilerSlot.current = new IndexFileReconciler<GitHubRepoIndexRow>({
        client,
        workspaceId,
        path: githubReposIndexPath(),
        builder: (rows) => {
          const built = buildRepoIndexFile([...rows]);
          return { path: built.path, content: built.content, contentType: built.contentType };
        },
      });
    }
    return repoReconcilerSlot.current;
  }

  const numberedDeleteRecoveryCache: NumberedDeleteRecoveryCache = {
    indexRowsByPath: new Map(),
  };

  // --- PRs ----------------------------------------------------------------
  if (pullRequests.length > 0) {
    const fan = await runEmitBatch(client, workspaceId, pullRequests, async (record) => {
      if (isDeleteRecord(record)) {
        return planNumberedDelete(
          client,
          workspaceId,
          record,
          'pulls',
          priorReader,
          (owner, repo) => getPullReconciler(owner, repo),
          numberedDeleteRecoveryCache,
        );
      }
      return planNumberedWrite(
        record,
        'pull_request',
        'pulls',
        priorReader,
        (owner, repo) => getPullReconciler(owner, repo),
        input.connectionId,
      );
    });
    accumulate(aggregate, fan);
  }

  // --- issues -------------------------------------------------------------
  if (issues.length > 0) {
    const fan = await runEmitBatch(client, workspaceId, issues, async (record) => {
      if (isDeleteRecord(record)) {
        return planNumberedDelete(
          client,
          workspaceId,
          record,
          'issues',
          priorReader,
          (owner, repo) => getIssueReconciler(owner, repo),
          numberedDeleteRecoveryCache,
        );
      }
      return planNumberedWrite(
        record,
        'issue',
        'issues',
        priorReader,
        (owner, repo) => getIssueReconciler(owner, repo),
        input.connectionId,
      );
    });
    accumulate(aggregate, fan);
  }

  // --- repositories -------------------------------------------------------
  if (repositories.length > 0) {
    const fan = await runEmitBatch(client, workspaceId, repositories, async (record) => {
      if (isDeleteRecord(record)) {
        return planRepositoryDelete(record, getRepoReconciler());
      }
      return planRepositoryWrite(record, getRepoReconciler(), input.connectionId);
    });
    accumulate(aggregate, fan);
  }

  // --- reviews ------------------------------------------------------------
  if (reviews.length > 0) {
    const fan = await runEmitBatch(client, workspaceId, reviews, async (record) =>
      planFlatRecord(record, 'review', input.connectionId),
    );
    accumulate(aggregate, fan);
  }

  // --- review comments ----------------------------------------------------
  if (reviewComments.length > 0) {
    const fan = await runEmitBatch(client, workspaceId, reviewComments, async (record) =>
      planFlatRecord(record, 'review_comment', input.connectionId),
    );
    accumulate(aggregate, fan);
  }

  // --- check runs ---------------------------------------------------------
  if (checkRuns.length > 0) {
    const fan = await runEmitBatch(client, workspaceId, checkRuns, async (record) =>
      planFlatRecord(record, 'check_run', input.connectionId),
    );
    accumulate(aggregate, fan);
  }

  // --- commits ------------------------------------------------------------
  if (commits.length > 0) {
    const fan = await runEmitBatch(client, workspaceId, commits, async (record) =>
      planFlatRecord(record, 'commit', input.connectionId),
    );
    accumulate(aggregate, fan);
  }

  // --- index flush --------------------------------------------------------
  await flushReconcilers(pullReconcilers.values(), aggregate);
  await flushReconcilers(issueReconcilers.values(), aggregate);
  if (repoReconcilerSlot.current) {
    const r = await repoReconcilerSlot.current.flush();
    aggregate.written += r.written;
    aggregate.errors.push(...r.errors);
  }

  return aggregate;
}

// ---------------------------------------------------------------------------
// Root index
// ---------------------------------------------------------------------------

async function writeRootIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const file = buildGitHubRootIndexFile();
  try {
    await client.writeFile({
      workspaceId,
      path: file.path,
      content: file.content,
      contentType: file.contentType,
    });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({ path: file.path, error: stringifyError(error) });
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ---------------------------------------------------------------------------
// PR / issue planners
// ---------------------------------------------------------------------------

interface PriorNumberedState {
  title?: string | undefined;
  state?: string | undefined;
  assigneeKeys?: string[] | undefined;
  creatorKey?: string | undefined;
  priority?: string | undefined;
  /** owner/repo recovered from the prior payload — needed for delete
   *  tombstones that don't carry repo context. */
  owner?: string | undefined;
  repo?: string | undefined;
}

interface NumberedDeleteRecovery {
  owner: string;
  repo: string;
  prior?: PriorNumberedState | undefined;
}

interface NumberedDeleteRecoveryCache {
  repos?: Promise<Record<string, unknown>[]>;
  indexRowsByPath: Map<string, Promise<Record<string, unknown>[]>>;
}

async function planNumberedWrite(
  record: GitHubPullRequestEmitRecord | GitHubIssueEmitRecord,
  objectType: 'pull_request' | 'issue',
  aliasKind: 'pulls' | 'issues',
  priorReader: PriorAliasReader,
  getReconciler: (owner: string, repo: string) => IndexFileReconciler<GitHubRecordIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const repoInfo = extractRepoInfo(record);
  if (!repoInfo) {
    return {};
  }
  const number = readNumberLike(record.number);
  if (number === null) {
    return {};
  }

  const title = readNonEmptyString(record.title);
  const state = readNonEmptyString(record.state);
  const assigneeKeys = readGitHubAssigneeKeys(record);
  const creatorKey = readGitHubCreatorKey(record);
  const priority = readPriority(record);

  const content = renderContent(objectType, record, connectionId, false);

  // Reconciliation: read prior by-id alias and compute stale paths.
  const prior = await priorReader.read<PriorNumberedState>(
    githubByIdAliasPath(repoInfo.owner, repoInfo.repo, aliasKind, number),
    extractPriorNumberedState,
  );

  const newPaths = numberedPathsFor({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    aliasKind,
    number,
    title,
    state,
    assigneeKeys,
    creatorKey,
    priority,
  });
  const priorTitle = prior?.title;
  const priorPaths = prior
    ? numberedPathsFor({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        aliasKind,
        number,
        title: priorTitle,
        state: prior.state,
        assigneeKeys: prior.assigneeKeys,
        creatorKey: prior.creatorKey,
        priority: prior.priority,
      }, { includeLegacyTitleAlias: true })
    : [];
  const stalePaths = diffPaths(priorPaths, newPaths);

  const writes: EmitWrite[] = newPaths.map((path) => ({
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
  }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));

  // Index row upsert.
  const reconciler = getReconciler(repoInfo.owner, repoInfo.repo);
  reconciler.upsert(buildRecordIndexRow(number, record, title, state));

  return { writes, deletes };
}

async function planNumberedDelete(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  tombstone: ScopedDeleteTombstone,
  aliasKind: 'pulls' | 'issues',
  priorReader: PriorAliasReader,
  getReconciler: (owner: string, repo: string) => IndexFileReconciler<GitHubRecordIndexRow>,
  recoveryCache: NumberedDeleteRecoveryCache,
): Promise<EmitPlan> {
  const number = readNumberLike(tombstone.id);
  if (number === null) {
    return {};
  }

  let recovery: NumberedDeleteRecovery | null = null;
  const explicitRepoInfo = extractRepoInfo(tombstone);
  if (explicitRepoInfo) {
    recovery = explicitRepoInfo;
  } else {
    recovery = await findRepoInfoForNumberedDelete(client, workspaceId, aliasKind, number, recoveryCache);
    if (!recovery) {
      return {};
    }
  }

  const idAliasPath = githubByIdAliasPath(recovery.owner, recovery.repo, aliasKind, number);
  const prior =
    await priorReader.read<PriorNumberedState>(idAliasPath, extractPriorNumberedState)
    ?? recovery.prior
    ?? await findNumberedIndexPrior(client, workspaceId, aliasKind, number, recovery, recoveryCache);

  const priorTitle = prior?.title;
  const priorPaths = numberedPathsFor({
    owner: recovery.owner,
    repo: recovery.repo,
    aliasKind,
    number,
    title: priorTitle,
    state: prior?.state,
    assigneeKeys: prior?.assigneeKeys,
    creatorKey: prior?.creatorKey,
    priority: prior?.priority,
  }, { includeLegacyTitleAlias: true });
  const objectType: 'pull_request' | 'issue' = aliasKind === 'pulls' ? 'pull_request' : 'issue';

  const paths = priorPaths.length > 0
    ? priorPaths
    : [canonicalPathFor(objectType, recovery.owner, recovery.repo, number, priorTitle), idAliasPath];

  // Drop the per-repo index row.
  getReconciler(recovery.owner, recovery.repo).remove(String(number));

  return { deletes: paths.map((path) => ({ path })) };
}

async function findRepoInfoForNumberedDelete(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aliasKind: 'pulls' | 'issues',
  number: string,
  recoveryCache: NumberedDeleteRecoveryCache,
): Promise<NumberedDeleteRecovery | null> {
  if (!client.readFile) {
    return null;
  }

  const repos = await readJsonArrayCached(client, workspaceId, githubReposIndexPath(), recoveryCache);
  if (repos.length > NUMBERED_DELETE_RECOVERY_REPO_SCAN_LIMIT) {
    throw new Error(
      `Refusing unscoped GitHub ${aliasKind} delete recovery across ${repos.length} repositories; include owner/repo on the tombstone.`,
    );
  }
  const matches: NumberedDeleteRecovery[] = [];
  for (const row of repos) {
    const repoInfo = extractRepoInfo(row) ?? repoInfoFromIndexId(readNonEmptyString(row.id));
    if (!repoInfo) continue;
    const indexPath = aliasKind === 'pulls'
      ? githubRepoPullsIndexPath(repoInfo.owner, repoInfo.repo)
      : githubRepoIssuesIndexPath(repoInfo.owner, repoInfo.repo);
    const rows = await readJsonArrayCached(client, workspaceId, indexPath, recoveryCache);
    const match = rows.find((entry) => readNumberLike(entry.id) === number || readNumberLike(entry.number) === number);
    if (match) {
      matches.push({
        ...repoInfo,
        prior: priorNumberedStateFromIndexRow(match, repoInfo),
      });
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

async function findNumberedIndexPrior(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aliasKind: 'pulls' | 'issues',
  number: string,
  repoInfo: { owner: string; repo: string },
  recoveryCache: NumberedDeleteRecoveryCache,
): Promise<PriorNumberedState | null> {
  if (!client.readFile) {
    return null;
  }
  const indexPath = aliasKind === 'pulls'
    ? githubRepoPullsIndexPath(repoInfo.owner, repoInfo.repo)
    : githubRepoIssuesIndexPath(repoInfo.owner, repoInfo.repo);
  const rows = await readJsonArrayCached(client, workspaceId, indexPath, recoveryCache);
  const match = rows.find((entry) => readNumberLike(entry.id) === number || readNumberLike(entry.number) === number);
  return match ? priorNumberedStateFromIndexRow(match, repoInfo) : null;
}

function readJsonArrayCached(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
  recoveryCache: NumberedDeleteRecoveryCache,
): Promise<Record<string, unknown>[]> {
  if (path === githubReposIndexPath()) {
    recoveryCache.repos ??= readJsonArray(client, workspaceId, path);
    return recoveryCache.repos;
  }
  let cached = recoveryCache.indexRowsByPath.get(path);
  if (!cached) {
    cached = readJsonArray(client, workspaceId, path);
    recoveryCache.indexRowsByPath.set(path, cached);
  }
  return cached;
}

async function readJsonArray(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): Promise<Record<string, unknown>[]> {
  try {
    const raw = await client.readFile?.({ workspaceId, path });
    if (!raw || typeof raw.content !== 'string') {
      return [];
    }
    const parsed = JSON.parse(raw.content) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function repoInfoFromIndexId(value: string | undefined): { owner: string; repo: string } | null {
  if (!value) return null;
  const [owner, repo] = value.split('/', 2);
  return owner && repo ? { owner, repo } : null;
}

function priorNumberedStateFromIndexRow(
  row: Record<string, unknown>,
  repoInfo: { owner: string; repo: string },
): PriorNumberedState {
  return {
    title: readNonEmptyString(row.title),
    state: readNonEmptyString(row.state),
    assigneeKeys: readStringArray(row.assigneeKeys),
    creatorKey: readNonEmptyString(row.creatorKey),
    priority: readNonEmptyString(row.priority),
    owner: repoInfo.owner,
    repo: repoInfo.repo,
  };
}

function numberedPathsFor(args: {
  owner: string;
  repo: string;
  aliasKind: 'pulls' | 'issues';
  number: string;
  title: string | undefined;
  state: string | undefined;
  assigneeKeys?: string[] | undefined;
  creatorKey?: string | undefined;
  priority?: string | undefined;
}, options: { includeLegacyTitleAlias?: boolean } = {}): string[] {
  const { owner, repo, aliasKind, number, title, state, assigneeKeys, creatorKey, priority } = args;
  const objectType: 'pull_request' | 'issue' = aliasKind === 'pulls' ? 'pull_request' : 'issue';
  const paths: string[] = [];
  paths.push(canonicalPathFor(objectType, owner, repo, number, title));
  paths.push(githubByIdAliasPath(owner, repo, aliasKind, number));
  if (title && slugifies(title)) {
    paths.push(githubNumberedByTitleAliasPath(owner, repo, aliasKind, title, number));
    if (options.includeLegacyTitleAlias) {
      const titleAliasPath = githubByTitleAliasPath(owner, repo, aliasKind, title, number);
      const legacyTitleAliasPath = githubLegacyByTitleAliasPath(owner, repo, aliasKind, title, number);
      paths.push(titleAliasPath);
      if (legacyTitleAliasPath !== titleAliasPath) {
        paths.push(legacyTitleAliasPath);
      }
    }
  }
  if (state && slugifies(state)) {
    paths.push(githubByStateAliasPath(owner, repo, aliasKind, state, number));
  }
  for (const assignee of assigneeKeys ?? []) {
    if (slugifies(assignee)) {
      paths.push(githubByAssigneeAliasPath(owner, repo, aliasKind, assignee, number));
    }
  }
  if (creatorKey && slugifies(creatorKey)) {
    paths.push(githubByCreatorAliasPath(owner, repo, aliasKind, creatorKey, number));
  }
  if (priority && slugifies(priority)) {
    paths.push(githubByPriorityAliasPath(owner, repo, aliasKind, priority, number));
  }
  return paths;
}

function canonicalPathFor(
  objectType: 'pull_request' | 'issue',
  owner: string,
  repo: string,
  number: string,
  title?: string,
): string {
  return objectType === 'pull_request'
    ? githubPullRequestPath(owner, repo, number, title)
    : githubIssuePath(owner, repo, number, title);
}

function buildRecordIndexRow(
  number: string,
  record: GitHubPullRequestEmitRecord | GitHubIssueEmitRecord,
  title: string | undefined,
  state: string | undefined,
): GitHubRecordIndexRow {
  return {
    id: number,
    title: title ?? number,
    updated: readUpdatedAt(record),
    number: Number(number),
    state: state ?? '',
    ...withOptionalArray('assigneeKeys', readGitHubAssigneeKeys(record)),
    ...withOptionalString('creatorKey', readGitHubCreatorKey(record)),
    ...withOptionalString('priority', readPriority(record)),
  };
}

// ---------------------------------------------------------------------------
// Repository planners
// ---------------------------------------------------------------------------

function planRepositoryWrite(
  record: GitHubRepositoryEmitRecord,
  reconciler: IndexFileReconciler<GitHubRepoIndexRow>,
  connectionId: string | undefined,
): EmitPlan {
  const repoInfo = extractRepoInfo(record);
  if (!repoInfo) {
    return {};
  }
  const content = renderContent('repository', record, connectionId, false);
  const writes: EmitWrite[] = [
    {
      path: githubRepositoryMetaPath(repoInfo.owner, repoInfo.repo),
      content,
      contentType: JSON_CONTENT_TYPE,
    },
  ];

  reconciler.upsert({
    id: `${repoInfo.owner}/${repoInfo.repo}`,
    title: `${repoInfo.owner}/${repoInfo.repo}`,
    updated: readUpdatedAt(record),
  });

  return { writes };
}

function planRepositoryDelete(
  tombstone: DeleteTombstone,
  reconciler: IndexFileReconciler<GitHubRepoIndexRow>,
): EmitPlan {
  // Repository delete tombstones carry `<owner>/<repo>` as id.
  const [owner, repo] = String(tombstone.id).split('/', 2);
  reconciler.remove(tombstone.id);
  if (!owner || !repo) {
    return {};
  }
  return {
    deletes: [
      { path: githubRepositoryMetaPath(owner, repo) },
      { path: githubRepositoryMetadataPath(owner, repo) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Flat-record planners (review, review_comment, check_run, commit)
// ---------------------------------------------------------------------------

function planFlatRecord(
  record:
    | GitHubReviewEmitRecord
    | GitHubReviewCommentEmitRecord
    | GitHubCheckRunEmitRecord
    | GitHubCommitEmitRecord
    | ScopedDeleteTombstone,
  objectType: 'review' | 'review_comment' | 'check_run' | 'commit',
  connectionId: string | undefined,
): EmitPlan {
  const repoInfo = extractRepoInfo(record);
  if (!repoInfo) {
    return {};
  }
  const flatPath = flatCanonicalPath(objectType, repoInfo.owner, repoInfo.repo, record);
  if (!flatPath) {
    return {};
  }

  if (isDeleteRecord(record)) {
    return { deletes: [{ path: flatPath }] };
  }

  const content = renderContent(objectType, record as Record<string, unknown>, connectionId, false);
  return {
    writes: [{ path: flatPath, content, contentType: JSON_CONTENT_TYPE }],
  };
}

function flatCanonicalPath(
  objectType: 'review' | 'review_comment' | 'check_run' | 'commit',
  owner: string,
  repo: string,
  record:
    | GitHubReviewEmitRecord
    | GitHubReviewCommentEmitRecord
    | GitHubCheckRunEmitRecord
    | GitHubCommitEmitRecord
    | ScopedDeleteTombstone,
): string | null {
  if (objectType === 'commit') {
    const sha =
      readGitHubCommitSha((record as GitHubCommitEmitRecord).sha) ??
      readGitHubCommitSha((record as DeleteTombstone).id);
    return sha ? githubCommitPath(owner, repo, sha) : null;
  }
  const id =
    readGitHubNumericId((record as { id?: unknown }).id) ??
    readGitHubNumericId((record as DeleteTombstone).id);
  if (!id) return null;
  switch (objectType) {
    case 'review':
      return githubReviewPath(owner, repo, id);
    case 'review_comment':
      return githubReviewCommentPath(owner, repo, id);
    case 'check_run':
      return githubCheckRunPath(owner, repo, id);
  }
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

async function flushReconcilers(
  iter: Iterable<IndexFileReconciler<GitHubRecordIndexRow>>,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  for (const r of iter) {
    const out = await r.flush();
    aggregate.written += out.written;
    aggregate.errors.push(...(out.errors as EmitError[]));
  }
}

function extractRepoInfo(record: unknown): { owner: string; repo: string } | null {
  if (!isRecord(record)) return null;
  const owner = readNonEmptyString(record.owner);
  const repo = readNonEmptyString(record.repo);
  if (owner && repo) {
    return { owner, repo };
  }
  // Fall back to full_name / url / html_url. Mirrors cloud's
  // `parseGitHubRepoFromRecord` semantics so legacy callers keep working.
  const candidates = [
    readNonEmptyString(record.full_name),
    readNonEmptyString(record.url),
    readNonEmptyString(record.html_url),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.hostname === 'github.com') {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length >= 2 && parts[0] && parts[1]) {
          return { owner: parts[0], repo: parts[1] };
        }
      }
    } catch {
      // Not a URL — fall through to slash split.
    }
    const parts = candidate.split('/', 2);
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] };
    }
  }
  return null;
}

function extractPriorNumberedState(parsed: Record<string, unknown>): PriorNumberedState | null {
  // Prior alias bodies may wrap the record under `payload` (new shape) or
  // sit at the root (legacy). Accept both, matching the Confluence port.
  const payload = pickPayload(parsed);
  if (!payload) return null;
  return {
    title: readNonEmptyString(payload.title) ?? readNonEmptyString(payload.name),
    state: readNonEmptyString(payload.state),
    assigneeKeys: readGitHubAssigneeKeys(payload),
    creatorKey: readGitHubCreatorKey(payload),
    priority: readPriority(payload),
    owner: readNonEmptyString(payload.owner),
    repo: readNonEmptyString(payload.repo),
  };
}

function readGitHubAssigneeKeys(record: Record<string, unknown>): string[] {
  const assignees = Array.isArray(record.assignees) ? record.assignees : [];
  return uniqueStrings(assignees.map((entry) => readUserKey(entry)).filter((entry): entry is string => Boolean(entry)));
}

function readGitHubCreatorKey(record: Record<string, unknown>): string | undefined {
  return readUserKey(record.user) ?? readNonEmptyString(record.user);
}

function readUserKey(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return readNonEmptyString(value.login) ?? readNumericId(value.id);
}

function readPriority(record: Record<string, unknown>): string | undefined {
  const explicit = readNonEmptyString(record.priority);
  if (explicit) return explicit;
  const labels = Array.isArray(record.labels) ? record.labels : [];
  for (const label of labels) {
    const name = readNonEmptyString(label) ?? readNonEmptyString(isRecord(label) ? label.name : undefined);
    const priority = parsePriorityLabel(name);
    if (priority) return priority;
  }
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = uniqueStrings(
    value
      .map((entry) => readNonEmptyString(entry))
      .filter((entry): entry is string => Boolean(entry)),
  );
  return values.length > 0 ? values : undefined;
}

function withOptionalString(key: 'creatorKey' | 'priority', value: string | undefined): Partial<GitHubRecordIndexRow> {
  return value ? { [key]: value } : {};
}

function withOptionalArray(key: 'assigneeKeys', value: string[]): Partial<GitHubRecordIndexRow> {
  return value.length > 0 ? { [key]: value } : {};
}

function parsePriorityLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  if (/^p[0-5](?:$|[\s:_/-].*)/iu.test(trimmed)) {
    return trimmed;
  }
  const match = /^(?:priority|prio|p)[\s:_/-]+(.+)$/iu.exec(trimmed);
  return readNonEmptyString(match?.[1]);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function diffPaths(prior: readonly string[], next: readonly string[]): string[] {
  const nextSet = new Set(next);
  return prior.filter((path) => !nextSet.has(path));
}

function pickPayload(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const wrapped = parsed.payload;
  if (isRecord(wrapped)) {
    return wrapped;
  }
  return parsed;
}

function renderContent(
  objectType: 'pull_request' | 'issue' | 'repository' | 'review' | 'review_comment' | 'check_run' | 'commit',
  record: Record<string, unknown>,
  connectionId: string | undefined,
  deleted: boolean,
): string {
  const objectId = pickObjectId(objectType, record);
  return JSON.stringify(
    {
      provider: GITHUB_PROVIDER_NAME,
      objectType,
      objectId,
      deleted,
      payload: record,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );
}

function pickObjectId(
  objectType: 'pull_request' | 'issue' | 'repository' | 'review' | 'review_comment' | 'check_run' | 'commit',
  record: Record<string, unknown>,
): string {
  if (objectType === 'commit') {
    return readNonEmptyString(record.sha) ?? '';
  }
  if (objectType === 'pull_request' || objectType === 'issue') {
    const n = readNumberLike(record.number);
    return n ?? '';
  }
  if (objectType === 'repository') {
    const owner = readNonEmptyString(record.owner);
    const repo = readNonEmptyString(record.repo);
    if (owner && repo) return `${owner}/${repo}`;
    return readNonEmptyString(record.full_name) ?? '';
  }
  return readNumericId(record.id) ?? '';
}

function readUpdatedAt(record: Record<string, unknown>): string {
  return (
    readNonEmptyString(record.updated_at) ??
    readNonEmptyString(record.updatedAt) ??
    readNonEmptyString((record as { pushed_at?: unknown }).pushed_at) ??
    ''
  );
}

function isDeleteRecord(record: unknown): record is ScopedDeleteTombstone {
  return (
    isRecord(record) &&
    (record as { _deleted?: unknown })._deleted === true &&
    typeof (record as { id?: unknown }).id === 'string'
  );
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumberLike(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    // Accept numeric strings; reject non-numeric ones so we don't accidentally
    // synthesize bogus PR numbers from an opaque id.
    if (/^[0-9]+$/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

function readNumericId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function readGitHubNumericId(value: unknown): string | undefined {
  const id = readNumberLike(value);
  return id ?? undefined;
}

function readGitHubCommitSha(value: unknown): string | undefined {
  const sha = readNonEmptyString(value);
  if (!sha) return undefined;
  return /^[0-9a-f]{7,40}$/iu.test(sha) ? sha : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Skip by-title aliases for titles that slug to empty (emoji-only /
 * punctuation-only). Mirrors the Confluence port: `slugifyAlias` returns
 * the literal `'untitled'` sentinel for empty slugs, which we don't want
 * to materialize as a real alias filename. NEVER reimplement slugify here —
 * the canonical implementation is `./alias-slug.ts` per AGENTS.md.
 */
function slugifies(value: string): boolean {
  return slugifyAlias(value) !== 'untitled';
}

function accumulate(
  aggregate: EmitAuxiliaryFilesResult,
  partial: EmitAuxiliaryFilesResult,
): void {
  aggregate.written += partial.written;
  aggregate.deleted += partial.deleted;
  if (partial.errors.length > 0) {
    aggregate.errors.push(...partial.errors);
  }
}
