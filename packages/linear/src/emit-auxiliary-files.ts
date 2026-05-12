/**
 * Adapter-owned auxiliary-file emission for Linear.
 *
 * Phase 2 port of the `emitAuxiliaryFiles` contract introduced by
 * `@relayfile/adapter-core` and exercised by `@relayfile/adapter-confluence`
 * in PR #78. Generalizes the Linear branch of cloud's
 * `record-writer.ts::writeLinearAuxiliaryFiles` (plus
 * `readLinearIssueAliasContext`) so cloud's Phase-3 dispatcher can collapse
 * to a per-provider switch.
 *
 * Per-resource emission:
 *
 *   * **issue** — canonical `/linear/issues/<identifier-or-title-slug>__<id>.json`,
 *     plus by-id alias keyed on the Linear `TEAM-123` identifier (or the
 *     UUID when the identifier is missing), by-title alias when the title
 *     slugs to non-empty, and by-state alias when both `state.name` and
 *     `identifier` are present. Index row carries
 *     `{ id, title, updated, identifier, state }`.
 *
 *   * **comment** — canonical `/linear/comments/<slug>__<id>.json`, no
 *     subtree aliases (current cloud + adapter shape only writes the
 *     canonical record and the index row). Index row
 *     `{ id, title, updated }`.
 *
 *   * **user**, **team** — canonical `/linear/users/<id>.json` /
 *     `/linear/teams/<id>.json`, index row `{ id, title, updated }`.
 *
 *   * **project** — canonical `/linear/projects/<id>.json`. No index file
 *     today; the helper exists in the path-mapper but no `_index.json`
 *     emitter is wired in. We still emit the canonical file so cloud's
 *     existing project sync surfaces survive the port.
 *
 *   * **cycle**, **milestone**, **roadmap** — canonical paths only. Same
 *     rationale as projects.
 *
 * Reconciliation: every issue/user/team/project write reads the prior
 * by-id alias (issue) or prior index row (others) to recover the previous
 * identifier / title / state, then deletes whichever alias and canonical
 * paths no longer apply. Reads degrade to "no reconciliation" when the
 * client lacks `readFile` — same back-compat we shipped in #78.
 *
 * Delete tombstones: `{ id, _deleted: true }`. For issues we read the
 * prior by-id alias to recover the identifier (the alias is keyed on it,
 * so without it we can't compute the alias path). For all resource types,
 * `IndexFileReconciler.remove(id)` is called on the delete branch so
 * `_index.json` doesn't accumulate ghost rows (the Devin regression on
 * #78 — see `packages/confluence/src/emit-auxiliary-files.ts`).
 */

import {
  PriorAliasReader,
  IndexFileReconciler,
  runEmitBatch,
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitDelete,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import { slugifyAlias } from './alias-slug.js';
import {
  LINEAR_PATH_ROOT,
  linearByIdAliasPath,
  linearByTitleAliasPath,
  linearCommentPath,
  linearCommentsIndexPath,
  linearCyclePath,
  linearIssueByStatePath,
  linearIssuePath,
  linearIssuesIndexPath,
  linearMilestonePath,
  linearProjectPath,
  linearRoadmapPath,
  linearTeamPath,
  linearTeamsIndexPath,
  linearUserPath,
  linearUsersIndexPath,
} from './path-mapper.js';
import {
  linearCommentIndexRow,
  linearIssueIndexRow,
  linearTeamIndexRow,
  linearUserIndexRow,
  type LinearBaseIndexRow,
  type LinearCommentNode,
  type LinearIssueIndexRow,
  type LinearIssueNode,
} from './queries.js';
import type {
  LinearComment,
  LinearCycle,
  LinearIssue,
  LinearMilestone,
  LinearProject,
  LinearRoadmap,
  LinearTeam,
  LinearUser,
} from './types.js';

const LINEAR_PROVIDER_NAME = 'linear';
const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;
const ISSUES_SCOPE = `${LINEAR_PATH_ROOT}/issues`;

/**
 * Records accepted by `emitLinearAuxiliaryFiles`. Each entry is either a
 * full domain object or a `{ id, _deleted: true }` tombstone. Mirrors the
 * confluence shape so cloud's Phase 3 dispatcher routes uniformly.
 */
export type LinearIssueEmitRecord = LinearIssue | { id: string; _deleted: true };
export type LinearCommentEmitRecord = LinearComment | { id: string; _deleted: true };
export type LinearUserEmitRecord = LinearUser | { id: string; _deleted: true };
export type LinearTeamEmitRecord = LinearTeam | { id: string; _deleted: true };
export type LinearProjectEmitRecord = LinearProject | { id: string; _deleted: true };
export type LinearCycleEmitRecord = LinearCycle | { id: string; _deleted: true };
export type LinearMilestoneEmitRecord = LinearMilestone | { id: string; _deleted: true };
export type LinearRoadmapEmitRecord = LinearRoadmap | { id: string; _deleted: true };

export interface LinearEmitAuxiliaryFilesInput {
  workspaceId: string;
  issues?: readonly LinearIssueEmitRecord[];
  comments?: readonly LinearCommentEmitRecord[];
  users?: readonly LinearUserEmitRecord[];
  teams?: readonly LinearTeamEmitRecord[];
  projects?: readonly LinearProjectEmitRecord[];
  cycles?: readonly LinearCycleEmitRecord[];
  milestones?: readonly LinearMilestoneEmitRecord[];
  roadmaps?: readonly LinearRoadmapEmitRecord[];
  /** Optional connection id wrapper field for downstream writeback routing. */
  connectionId?: string;
}

/**
 * Phase-2 entry point. Cloud's Phase-3 dispatcher iterates
 * `(provider, records)` and calls this with a shimmed
 * `AuxiliaryEmitterClient`.
 */
export async function emitLinearAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: LinearEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const workspaceId = input.workspaceId;
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  const issues = input.issues ?? [];
  const comments = input.comments ?? [];
  const users = input.users ?? [];
  const teams = input.teams ?? [];
  const projects = input.projects ?? [];
  const cycles = input.cycles ?? [];
  const milestones = input.milestones ?? [];
  const roadmaps = input.roadmaps ?? [];

  if (
    issues.length === 0 &&
    comments.length === 0 &&
    users.length === 0 &&
    teams.length === 0 &&
    projects.length === 0 &&
    cycles.length === 0 &&
    milestones.length === 0 &&
    roadmaps.length === 0
  ) {
    return aggregate;
  }

  if (issues.length > 0) {
    accumulate(aggregate, await emitIssues(client, workspaceId, issues, input.connectionId));
  }
  if (comments.length > 0) {
    accumulate(aggregate, await emitComments(client, workspaceId, comments, input.connectionId));
  }
  if (users.length > 0) {
    accumulate(aggregate, await emitUsers(client, workspaceId, users, input.connectionId));
  }
  if (teams.length > 0) {
    accumulate(aggregate, await emitTeams(client, workspaceId, teams, input.connectionId));
  }
  if (projects.length > 0) {
    accumulate(aggregate, await emitProjects(client, workspaceId, projects, input.connectionId));
  }
  if (cycles.length > 0) {
    accumulate(aggregate, await emitCycles(client, workspaceId, cycles, input.connectionId));
  }
  if (milestones.length > 0) {
    accumulate(aggregate, await emitMilestones(client, workspaceId, milestones, input.connectionId));
  }
  if (roadmaps.length > 0) {
    accumulate(aggregate, await emitRoadmaps(client, workspaceId, roadmaps, input.connectionId));
  }

  return aggregate;
}

// -- issues -----------------------------------------------------------------

async function emitIssues(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearIssueEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const indexReconciler = new IndexFileReconciler<LinearIssueIndexRow>({
    client,
    workspaceId,
    path: linearIssuesIndexPath(),
    builder: (rows) => ({
      path: linearIssuesIndexPath(),
      content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });
  const priorReader = new PriorAliasReader(client, workspaceId);

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planIssueDelete(record.id, priorReader, indexReconciler);
    }
    return planIssueWrite(record, priorReader, indexReconciler, connectionId);
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);
  return fanOut;
}

async function planIssueWrite(
  issue: LinearIssue,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<LinearIssueIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(issue.id);
  if (!id) {
    return {};
  }

  const identifier = readNonEmptyString(issue.identifier);
  const title = readNonEmptyString(issue.title);
  const stateName = readIssueStateName(issue);

  const content = renderContent('issue', issue, connectionId, false);
  const newPaths = issuePathsFor({ id, identifier, title, stateName });

  // Reconciliation: the by-id alias is keyed on the public identifier (or
  // UUID fallback). Probe both candidates so a rename from identifier-less
  // to identifier-bearing recovers the prior state.
  let prior: PriorIssueState | null = null;
  const candidates = uniqueStrings([identifier, id]);
  for (const candidate of candidates) {
    const result = await priorReader.read<PriorIssueState>(
      linearByIdAliasPath(ISSUES_SCOPE, candidate),
      extractPriorIssueState,
    );
    if (result) {
      prior = result;
      break;
    }
  }

  const stalePaths = prior
    ? diffPaths(
        issuePathsFor({
          id,
          identifier: prior.identifier ?? identifier,
          title: prior.title,
          stateName: prior.stateName,
        }),
        newPaths,
      )
    : [];

  const writes: EmitWrite[] = newPaths.map((path) => ({
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
  }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));

  indexReconciler.upsert(linearIssueIndexRow(toIssueNode(issue)));

  return { writes, deletes };
}

async function planIssueDelete(
  id: string,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<LinearIssueIndexRow>,
): Promise<EmitPlan> {
  // We don't know the identifier on a bare tombstone — try the UUID anchor
  // first (it's always present as fallback). If a prior write seeded the
  // by-id alias under the public identifier we still recover it from the
  // payload.
  const prior =
    (await priorReader.read<PriorIssueState>(
      linearByIdAliasPath(ISSUES_SCOPE, id),
      extractPriorIssueState,
    )) ?? null;

  let resolvedPrior = prior;
  if (!resolvedPrior) {
    // Best-effort: walk the index for the id → identifier mapping. The
    // IndexFileReconciler doesn't expose existing rows, so we skip this
    // for now — the prior by-id alias is the authoritative anchor. Deletes
    // without a prior alias degrade to "no reconciliation possible", which
    // matches the confluence port's behavior. The index row is still
    // removed below.
  }

  const paths = issuePathsFor({
    id,
    identifier: resolvedPrior?.identifier,
    title: resolvedPrior?.title,
    stateName: resolvedPrior?.stateName,
  });
  // See planPageDelete in the confluence port — index row must drop too.
  indexReconciler.remove(id);
  return { deletes: paths.map((path) => ({ path })) };
}

interface PriorIssueState {
  identifier?: string | undefined;
  title?: string | undefined;
  stateName?: string | undefined;
}

function extractPriorIssueState(parsed: Record<string, unknown>): PriorIssueState | null {
  const payload = pickPayload(parsed);
  if (!payload) return null;
  return {
    identifier: readNonEmptyString(payload.identifier),
    title: readNonEmptyString(payload.title),
    stateName: readPriorStateName(payload),
  };
}

function readPriorStateName(payload: Record<string, unknown>): string | undefined {
  const stateRecord = isRecord(payload.state) ? payload.state : undefined;
  return (
    readNonEmptyString(stateRecord?.name) ??
    readNonEmptyString(payload.state_name) ??
    readNonEmptyString(payload.state_type)
  );
}

function issuePathsFor(args: {
  id: string;
  identifier?: string | undefined;
  title?: string | undefined;
  stateName?: string | undefined;
}): string[] {
  const { id, identifier, title, stateName } = args;
  const humanReadable = identifier ?? title;
  const paths: string[] = [];
  // Canonical path.
  paths.push(linearIssuePath(id, humanReadable));
  // by-id alias — anchor on identifier when present, falling back to UUID.
  paths.push(linearByIdAliasPath(ISSUES_SCOPE, identifier ?? id));
  // by-title alias — skip when title slugs to empty (`slugifyAlias` returns
  // the literal `'untitled'` sentinel in that case).
  if (title && slugifies(title)) {
    paths.push(linearByTitleAliasPath(ISSUES_SCOPE, title, id));
  }
  // by-state alias — only when both state and identifier are present, since
  // the alias filename is the identifier (Linear's `slugifyStateName`
  // helper throws on empty input).
  if (stateName && identifier) {
    paths.push(linearIssueByStatePath(stateName, identifier));
  }
  return paths;
}

function readIssueStateName(issue: LinearIssue): string | undefined {
  return readNonEmptyString(issue.state?.name);
}

function toIssueNode(issue: LinearIssue): LinearIssueNode {
  return {
    id: issue.id,
    identifier: issue.identifier ?? null,
    title: issue.title ?? null,
    state: issue.state
      ? { name: issue.state.name ?? null, type: issue.state.type ?? null }
      : null,
    updatedAt: issue.updatedAt ?? null,
    createdAt: issue.createdAt ?? null,
  } as LinearIssueNode;
}

// -- comments ---------------------------------------------------------------

async function emitComments(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearCommentEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  const indexReconciler = new IndexFileReconciler<LinearBaseIndexRow>({
    client,
    workspaceId,
    path: linearCommentsIndexPath(),
    builder: (rows) => ({
      path: linearCommentsIndexPath(),
      content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      indexReconciler.remove(record.id);
      return { deletes: [{ path: linearCommentPath(record.id) }] };
    }
    const id = readNonEmptyString(record.id);
    if (!id) return {};
    const humanReadable =
      readNonEmptyString(record.issue?.identifier) ?? readNonEmptyString(record.body ?? undefined);
    const path = linearCommentPath(id, humanReadable);
    indexReconciler.upsert(linearCommentIndexRow(toCommentNode(record)));
    return {
      writes: [
        {
          path,
          content: renderContent('comment', record, connectionId, false),
          contentType: JSON_CONTENT_TYPE,
        },
      ],
    };
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);
  return fanOut;
}

function toCommentNode(comment: LinearComment): LinearCommentNode {
  return {
    id: comment.id,
    body: comment.body ?? null,
    issue: comment.issue
      ? {
          id: comment.issue.id ?? null,
          identifier: comment.issue.identifier ?? null,
          title: comment.issue.title ?? null,
          url: comment.issue.url ?? null,
        }
      : null,
    updatedAt: comment.updatedAt ?? null,
    createdAt: comment.createdAt ?? null,
  } as LinearCommentNode;
}

// -- users / teams / projects / cycles / milestones / roadmaps -------------

async function emitUsers(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearUserEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  return emitFlatResource(client, workspaceId, records, {
    indexPath: linearUsersIndexPath(),
    canonicalPath: (id) => linearUserPath(id),
    indexRow: (record) => linearUserIndexRow(record),
    objectType: 'user',
    connectionId,
  });
}

async function emitTeams(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearTeamEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  return emitFlatResource(client, workspaceId, records, {
    indexPath: linearTeamsIndexPath(),
    canonicalPath: (id) => linearTeamPath(id),
    indexRow: (record) => linearTeamIndexRow(record),
    objectType: 'team',
    connectionId,
  });
}

async function emitProjects(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearProjectEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  // Projects don't ship an `_index.json` in the current adapter (no
  // index-emitter bucket), so we only emit the canonical record.
  return emitCanonicalOnlyResource(client, workspaceId, records, {
    canonicalPath: (id) => linearProjectPath(id),
    objectType: 'project',
    connectionId,
  });
}

async function emitCycles(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearCycleEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  return emitCanonicalOnlyResource(client, workspaceId, records, {
    canonicalPath: (id) => linearCyclePath(id),
    objectType: 'cycle',
    connectionId,
  });
}

async function emitMilestones(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearMilestoneEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  return emitCanonicalOnlyResource(client, workspaceId, records, {
    canonicalPath: (id) => linearMilestonePath(id),
    objectType: 'milestone',
    connectionId,
  });
}

async function emitRoadmaps(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearRoadmapEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  return emitCanonicalOnlyResource(client, workspaceId, records, {
    canonicalPath: (id) => linearRoadmapPath(id),
    objectType: 'roadmap',
    connectionId,
  });
}

interface FlatResourceOptions<TRecord extends { id: string }> {
  indexPath: string;
  canonicalPath: (id: string) => string;
  indexRow: (record: TRecord) => LinearBaseIndexRow;
  objectType: string;
  connectionId: string | undefined;
}

async function emitFlatResource<TRecord extends { id: string }>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly (TRecord | { id: string; _deleted: true })[],
  opts: FlatResourceOptions<TRecord>,
): Promise<EmitAuxiliaryFilesResult> {
  const indexReconciler = new IndexFileReconciler<LinearBaseIndexRow>({
    client,
    workspaceId,
    path: opts.indexPath,
    builder: (rows) => ({
      path: opts.indexPath,
      content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      indexReconciler.remove(record.id);
      return { deletes: [{ path: opts.canonicalPath(record.id) }] };
    }
    const id = readNonEmptyString(record.id);
    if (!id) return {};
    indexReconciler.upsert(opts.indexRow(record));
    return {
      writes: [
        {
          path: opts.canonicalPath(id),
          content: renderContent(opts.objectType, record, opts.connectionId, false),
          contentType: JSON_CONTENT_TYPE,
        },
      ],
    };
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);
  return fanOut;
}

interface CanonicalOnlyResourceOptions {
  canonicalPath: (id: string) => string;
  objectType: string;
  connectionId: string | undefined;
}

async function emitCanonicalOnlyResource<TRecord extends { id: string }>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly (TRecord | { id: string; _deleted: true })[],
  opts: CanonicalOnlyResourceOptions,
): Promise<EmitAuxiliaryFilesResult> {
  return runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return { deletes: [{ path: opts.canonicalPath(record.id) }] };
    }
    const id = readNonEmptyString(record.id);
    if (!id) return {};
    return {
      writes: [
        {
          path: opts.canonicalPath(id),
          content: renderContent(opts.objectType, record, opts.connectionId, false),
          contentType: JSON_CONTENT_TYPE,
        },
      ],
    };
  });
}

// -- shared helpers ---------------------------------------------------------

function renderContent(
  objectType: string,
  payload: Record<string, unknown> | { id: string },
  connectionId: string | undefined,
  deleted: boolean,
): string {
  return JSON.stringify(
    {
      provider: LINEAR_PROVIDER_NAME,
      objectType,
      objectId: (payload as { id: string }).id,
      deleted,
      payload,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );
}

function compareIndexRows(
  left: LinearBaseIndexRow | LinearIssueIndexRow,
  right: LinearBaseIndexRow | LinearIssueIndexRow,
): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

function diffPaths(prior: readonly string[], next: readonly string[]): string[] {
  const nextSet = new Set(next);
  const seen = new Set<string>();
  const stale: string[] = [];
  for (const p of prior) {
    if (!nextSet.has(p) && !seen.has(p)) {
      seen.add(p);
      stale.push(p);
    }
  }
  return stale;
}

function pickPayload(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const wrapped = parsed.payload;
  if (isRecord(wrapped)) {
    return wrapped;
  }
  return parsed;
}

function isDeleteRecord(
  record: { id: string } | { id: string; _deleted: true } | unknown,
): record is { id: string; _deleted: true } {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: ReadonlyArray<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Skip by-title aliases for titles that slug to nothing (emoji-only /
 * punctuation-only). The by-id alias still resolves those records.
 *
 * Delegates to the shared `slugifyAlias` per AGENTS.md "NEVER write a
 * new slugifier" rule. `slugifyAlias` returns the literal string
 * `'untitled'` as its empty-slug sentinel.
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
