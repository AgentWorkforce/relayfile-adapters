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
 *     plus a by-uuid alias keyed on the Linear UUID (always emitted — the
 *     stable reconciliation anchor), a by-id alias keyed on the Linear
 *     `TEAM-123` identifier when present (human-readable lookup), a by-title
 *     alias when the title slugs to non-empty, and grouped issue-tracking
 *     aliases for state, assignee, creator, and priority when the required
 *     grouping field and `identifier` are present. Index row carries
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
 * Reconciliation: every issue write reads the prior by-uuid alias (the
 * stable anchor keyed on `issue.id`, always emitted) to recover the
 * previous identifier / title / state, then deletes whichever alias and
 * canonical paths no longer apply. User/team writes reconcile against the
 * prior index row. Reads degrade to "no reconciliation" when the client
 * lacks `readFile` — same back-compat we shipped in #78.
 *
 * Delete tombstones: `{ id, _deleted: true }`. For issues we read the
 * prior by-uuid alias to recover the identifier, title, and state — the
 * UUID is always present on a tombstone (it's the only field), so the
 * lookup key is guaranteed even when the original write predated the
 * identifier. For all resource types, `IndexFileReconciler.remove(id)` is
 * called on the delete branch so `_index.json` doesn't accumulate ghost
 * rows (the Devin regression on #78 — see
 * `packages/confluence/src/emit-auxiliary-files.ts`).
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

import { hasAliasSlug } from './alias-slug.js';
import { buildLinearRootIndexFile } from './index-emitter.js';
import {
  LINEAR_PATH_ROOT,
  linearByIdAliasPath,
  linearByNameAliasPath,
  linearByTitleAliasPath,
  linearByUuidAliasPath,
  linearCommentPath,
  linearCommentsIndexPath,
  linearCyclesIndexPath,
  linearCyclePath,
  linearIssueByAssigneePath,
  linearIssueByCreatorPath,
  linearIssueByPriorityPath,
  linearIssueByStatePath,
  linearIssuePath,
  linearIssuesIndexPath,
  linearMilestonesIndexPath,
  linearMilestonePath,
  linearProjectsIndexPath,
  linearProjectPath,
  linearRoadmapsIndexPath,
  linearRoadmapPath,
  linearTeamPath,
  linearTeamsIndexPath,
  linearUserPath,
  linearUsersIndexPath,
} from './path-mapper.js';
import {
  linearCommentIndexRow,
  linearCycleIndexRow,
  linearIssueIndexRow,
  linearMilestoneIndexRow,
  linearProjectIndexRow,
  linearRoadmapIndexRow,
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
const PROJECTS_SCOPE = `${LINEAR_PATH_ROOT}/projects`;
const TEAMS_SCOPE = `${LINEAR_PATH_ROOT}/teams`;

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

  // Always emit the root `/linear/_index.json` so `ls /linear/` reliably
  // surfaces the top-level resource buckets, even for empty / single-bucket
  // batches. Mirrors `emitSlackAuxiliaryFiles`.
  await writeRootIndex(client, workspaceId, aggregate);

  const issues = input.issues ?? [];
  const comments = input.comments ?? [];
  const users = input.users ?? [];
  const teams = input.teams ?? [];
  const projects = input.projects ?? [];
  const cycles = input.cycles ?? [];
  const milestones = input.milestones ?? [];
  const roadmaps = input.roadmaps ?? [];
  const hasIssues = hasOwn(input, 'issues');
  const hasComments = hasOwn(input, 'comments');
  const hasUsers = hasOwn(input, 'users');
  const hasTeams = hasOwn(input, 'teams');
  const hasProjects = hasOwn(input, 'projects');
  const hasCycles = hasOwn(input, 'cycles');
  const hasMilestones = hasOwn(input, 'milestones');
  const hasRoadmaps = hasOwn(input, 'roadmaps');

  if (
    !hasIssues &&
    !hasComments &&
    !hasUsers &&
    !hasTeams &&
    !hasProjects &&
    !hasCycles &&
    !hasMilestones &&
    !hasRoadmaps
  ) {
    return aggregate;
  }

  if (hasIssues) {
    accumulate(aggregate, await emitIssues(client, workspaceId, issues, input.connectionId));
  }
  if (hasComments) {
    accumulate(aggregate, await emitComments(client, workspaceId, comments, input.connectionId));
  }
  if (hasUsers) {
    accumulate(aggregate, await emitUsers(client, workspaceId, users, input.connectionId));
  }
  if (hasTeams) {
    accumulate(aggregate, await emitTeams(client, workspaceId, teams, input.connectionId));
  }
  if (hasProjects) {
    accumulate(aggregate, await emitProjects(client, workspaceId, projects, input.connectionId));
  }
  if (hasCycles) {
    accumulate(aggregate, await emitCycles(client, workspaceId, cycles, input.connectionId));
  }
  if (hasMilestones) {
    accumulate(aggregate, await emitMilestones(client, workspaceId, milestones, input.connectionId));
  }
  if (hasRoadmaps) {
    accumulate(aggregate, await emitRoadmaps(client, workspaceId, roadmaps, input.connectionId));
  }

  return aggregate;
}

// -- root index -------------------------------------------------------------

async function writeRootIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const file = buildLinearRootIndexFile();
  try {
    await client.writeFile({
      workspaceId,
      path: file.path,
      content: file.content,
      contentType: file.contentType,
    });
    aggregate.written += 1;
  } catch (error) {
    aggregate.errors.push({
      path: file.path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// -- issues -----------------------------------------------------------------

async function emitIssues(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearIssueEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  if (records.length === 0) {
    return writeEmptyIndex(client, workspaceId, linearIssuesIndexPath());
  }

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
  const assigneeId = readIssueAssigneeId(issue);
  const creatorId = readIssueCreatorId(issue);
  const priority = issue.priority ?? undefined;

  const content = renderContent('issue', issue, connectionId, false);
  const newPaths = issuePathsFor({ id, identifier, title, stateName, assigneeId, creatorId, priority });

  // Reconciliation: the by-uuid alias is the stable anchor — it's always
  // emitted (keyed on the UUID, which is always present) so a prior write
  // is guaranteed to have produced it. This resolves the
  // identifier-transition gap CodeRabbit caught: an issue going from
  // identifier-less to identifier-bearing previously left a stale
  // UUID-keyed by-id alias behind because the fallback in this lookup
  // recomputed the new identifier-keyed path.
  const prior = await priorReader.read<PriorIssueState>(
    linearByUuidAliasPath(ISSUES_SCOPE, id),
    extractPriorIssueState,
  );

  const stalePaths = prior
    ? diffPaths(
        issuePathsFor({
          id,
          // IMPORTANT: do NOT fall back to the current identifier here. If
          // the prior payload had no identifier, the prior by-id alias was
          // never written (we only emit by-id when identifier is present),
          // so there's nothing stale to clean up on that path. Passing the
          // current identifier would synthesize a phantom prior path.
          identifier: prior.identifier,
          title: prior.title,
          stateName: prior.stateName,
          assigneeId: prior.assigneeId,
          creatorId: prior.creatorId,
          priority: prior.priority,
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
  // Bare tombstones carry only the UUID, so we read the by-uuid alias —
  // the stable anchor keyed on `issue.id`, always written alongside every
  // prior issue emit. This is the fix for the Devin finding: the previous
  // implementation read `linearByIdAliasPath(scope, id)` (UUID), but
  // `issuePathsFor` writes by-id keyed on the identifier (e.g. AGE-8),
  // not the UUID, so the lookup never matched and no alias paths got
  // computed → none of the 4 stale files got deleted on tombstone.
  const prior =
    (await priorReader.read<PriorIssueState>(
      linearByUuidAliasPath(ISSUES_SCOPE, id),
      extractPriorIssueState,
    )) ?? null;

  const paths = issuePathsFor({
    id,
    identifier: prior?.identifier,
    title: prior?.title,
    stateName: prior?.stateName,
    assigneeId: prior?.assigneeId,
    creatorId: prior?.creatorId,
    priority: prior?.priority,
  });
  // See planPageDelete in the confluence port — index row must drop too.
  indexReconciler.remove(id);
  return { deletes: paths.map((path) => ({ path })) };
}

interface PriorIssueState {
  identifier?: string | undefined;
  title?: string | undefined;
  stateName?: string | undefined;
  assigneeId?: string | undefined;
  creatorId?: string | undefined;
  priority?: number | string | undefined;
}

function extractPriorIssueState(parsed: Record<string, unknown>): PriorIssueState | null {
  const payload = pickPayload(parsed);
  if (!payload) return null;
  return {
    identifier: readNonEmptyString(payload.identifier),
    title: readNonEmptyString(payload.title),
    stateName: readPriorStateName(payload),
    assigneeId: readPriorUserId(payload.assignee) ?? readNonEmptyString(payload.assignee_id),
    creatorId: readPriorUserId(payload.creator) ?? readNonEmptyString(payload.creator_id),
    priority: readPriority(payload.priority),
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
  assigneeId?: string | undefined;
  creatorId?: string | undefined;
  priority?: number | string | undefined;
}): string[] {
  const { id, identifier, title, stateName, assigneeId, creatorId, priority } = args;
  const humanReadable = identifier ?? title;
  const paths: string[] = [];
  // Canonical path.
  paths.push(linearIssuePath(id, humanReadable));
  // by-uuid alias — the stable reconciliation anchor, always emitted.
  // Keyed on the Linear UUID (`issue.id`), which is always present even on
  // bare delete tombstones. Subsequent emits read prior state from this
  // path to discover the previous identifier/title/state.
  paths.push(linearByUuidAliasPath(ISSUES_SCOPE, id));
  // by-id alias — human-readable lookup keyed on the Linear identifier
  // (e.g. `TEAM-123`). Only emitted when the identifier is present, so we
  // don't pollute `/linear/issues/by-id/` with UUID-keyed entries that
  // duplicate the by-uuid subtree.
  if (identifier) {
    paths.push(linearByIdAliasPath(ISSUES_SCOPE, identifier));
  }
  // by-title alias — skip when the title has no valid alias slug.
  if (title && slugifies(title)) {
    paths.push(linearByTitleAliasPath(ISSUES_SCOPE, title, id));
  }
  // Grouped issue-tracking aliases use the public identifier as their stable
  // human-facing leaf, so they are emitted only when the issue has one.
  if (stateName && identifier) {
    paths.push(linearIssueByStatePath(stateName, identifier));
  }
  if (assigneeId && identifier) {
    paths.push(linearIssueByAssigneePath(assigneeId, identifier));
  }
  if (creatorId && identifier) {
    paths.push(linearIssueByCreatorPath(creatorId, identifier));
  }
  if (priority !== undefined && identifier) {
    paths.push(linearIssueByPriorityPath(priority, identifier));
  }
  return paths;
}

function readIssueStateName(issue: LinearIssue): string | undefined {
  return readNonEmptyString(issue.state?.name);
}

function readIssueAssigneeId(issue: LinearIssue): string | undefined {
  return readNonEmptyString(issue.assignee?.id);
}

function readIssueCreatorId(issue: LinearIssue): string | undefined {
  return readNonEmptyString(issue.creator?.id);
}

function readPriorUserId(value: unknown): string | undefined {
  return isRecord(value) ? readNonEmptyString(value.id) : undefined;
}

function readPriority(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return readNonEmptyString(value);
}

function toIssueNode(issue: LinearIssue): LinearIssueNode {
  return {
    id: issue.id,
    identifier: issue.identifier ?? null,
    title: issue.title ?? null,
    state: issue.state
      ? { name: issue.state.name ?? null, type: issue.state.type ?? null }
      : null,
    priority: issue.priority ?? null,
    assignee: issue.assignee
      ? { id: issue.assignee.id ?? null, name: issue.assignee.name ?? null, email: issue.assignee.email ?? null }
      : null,
    creator: issue.creator
      ? { id: issue.creator.id ?? null, name: issue.creator.name ?? null, email: issue.creator.email ?? null }
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
  if (records.length === 0) {
    return writeEmptyIndex(client, workspaceId, linearCommentsIndexPath());
  }

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
    aliasAnchorPath: (id) => linearByIdAliasPath(TEAMS_SCOPE, id),
    aliasPaths: teamAliasPaths,
  });
}

async function emitProjects(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearProjectEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  return emitFlatResource(client, workspaceId, records, {
    indexPath: linearProjectsIndexPath(),
    canonicalPath: (id) => linearProjectPath(id),
    indexRow: (record) => linearProjectIndexRow(record),
    objectType: 'project',
    connectionId,
    aliasAnchorPath: (id) => linearByIdAliasPath(PROJECTS_SCOPE, id),
    aliasPaths: projectAliasPaths,
  });
}

async function emitCycles(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly LinearCycleEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  return emitFlatResource(client, workspaceId, records, {
    indexPath: linearCyclesIndexPath(),
    canonicalPath: (id) => linearCyclePath(id),
    indexRow: (record) => linearCycleIndexRow(record),
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
  return emitFlatResource(client, workspaceId, records, {
    indexPath: linearMilestonesIndexPath(),
    canonicalPath: (id) => linearMilestonePath(id),
    indexRow: (record) => linearMilestoneIndexRow(record),
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
  return emitFlatResource(client, workspaceId, records, {
    indexPath: linearRoadmapsIndexPath(),
    canonicalPath: (id) => linearRoadmapPath(id),
    indexRow: (record) => linearRoadmapIndexRow(record),
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
  aliasAnchorPath?: (id: string) => string;
  aliasPaths?: (record: Record<string, unknown>, id: string) => FlatAliasPath[];
}

type FlatAliasPath =
  | string
  | {
      path: string;
      collisionPath: string;
    };

async function emitFlatResource<TRecord extends { id: string }>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly (TRecord | { id: string; _deleted: true })[],
  opts: FlatResourceOptions<TRecord>,
): Promise<EmitAuxiliaryFilesResult> {
  if (records.length === 0) {
    return writeEmptyIndex(client, workspaceId, opts.indexPath);
  }

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
  const priorReader = new PriorAliasReader(client, workspaceId);

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      indexReconciler.remove(record.id);
      const prior = await readFlatPrior(record.id, priorReader, opts);
      const paths = await flatResourcePaths(record.id, prior, opts, priorReader);
      return { deletes: paths.map((path) => ({ path })) };
    }
    const id = readNonEmptyString(record.id);
    if (!id) return {};
    indexReconciler.upsert(opts.indexRow(record));
    const prior = await readFlatPrior(id, priorReader, opts);
    const paths = await flatResourcePaths(id, record, opts, priorReader);
    const priorPaths = prior ? await flatResourcePaths(id, prior, opts, priorReader) : [];
    const stalePaths = diffPaths(priorPaths, paths);
    const content = renderContent(opts.objectType, record, opts.connectionId, false);
    return {
      writes: paths.map((path) => ({
        path,
        content,
        contentType: JSON_CONTENT_TYPE,
      })),
      deletes: stalePaths.map((path) => ({ path })),
    };
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);
  return fanOut;
}

async function readFlatPrior<TRecord extends { id: string }>(
  id: string,
  priorReader: PriorAliasReader,
  opts: FlatResourceOptions<TRecord>,
): Promise<Record<string, unknown> | null> {
  if (!opts.aliasAnchorPath || !opts.aliasPaths) return null;
  return priorReader.read<Record<string, unknown>>(
    opts.aliasAnchorPath(id),
    (parsed) => pickPayload(parsed),
  );
}

async function flatResourcePaths<TRecord extends { id: string }>(
  id: string,
  record: Record<string, unknown> | null,
  opts: FlatResourceOptions<TRecord>,
  priorReader: PriorAliasReader,
): Promise<string[]> {
  const aliases = record && opts.aliasPaths ? opts.aliasPaths(record, id) : [];
  const resolvedAliases: string[] = [];
  for (const alias of aliases) {
    resolvedAliases.push(await resolveFlatAliasPath(alias, id, priorReader));
  }
  return [opts.canonicalPath(id), ...resolvedAliases];
}

async function resolveFlatAliasPath(
  alias: FlatAliasPath,
  id: string,
  priorReader: PriorAliasReader,
): Promise<string> {
  if (typeof alias === 'string') {
    return alias;
  }
  const existing = await priorReader.read<Record<string, unknown>>(alias.path);
  const existingId =
    readNonEmptyString(existing?.objectId) ??
    (existing ? readNonEmptyString(pickPayload(existing)?.id) : undefined);
  return existingId && existingId !== id ? alias.collisionPath : alias.path;
}

function projectAliasPaths(record: Record<string, unknown>, id: string): FlatAliasPath[] {
  const paths: FlatAliasPath[] = [linearByIdAliasPath(PROJECTS_SCOPE, id)];
  const name = readNonEmptyString(record.name);
  if (name && slugifies(name)) {
    paths.push({
      path: linearByTitleAliasPath(PROJECTS_SCOPE, name, id),
      collisionPath: linearByTitleAliasPath(PROJECTS_SCOPE, name, id, true),
    });
  }
  return paths;
}

function teamAliasPaths(record: Record<string, unknown>, id: string): FlatAliasPath[] {
  const paths: FlatAliasPath[] = [linearByIdAliasPath(TEAMS_SCOPE, id)];
  const name = readNonEmptyString(record.name) ?? readNonEmptyString(record.key);
  if (name && slugifies(name)) {
    paths.push({
      path: linearByNameAliasPath(TEAMS_SCOPE, name, id),
      collisionPath: linearByNameAliasPath(TEAMS_SCOPE, name, id, true),
    });
  }
  return paths;
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

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

async function writeEmptyIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): Promise<EmitAuxiliaryFilesResult> {
  try {
    await client.writeFile({
      workspaceId,
      path,
      content: '[]\n',
      contentType: JSON_CONTENT_TYPE,
    });
    return { written: 1, deleted: 0, errors: [] };
  } catch (error) {
    return {
      written: 0,
      deleted: 0,
      errors: [{ path, error: error instanceof Error ? error.message : String(error) }],
    };
  }
}

/**
 * Skip by-title aliases for titles that slug to nothing (emoji-only /
 * punctuation-only). The by-id alias still resolves those records.
 *
 * Delegates to the shared alias-slug helper per AGENTS.md "NEVER write a
 * new slugifier" rule.
 */
function slugifies(value: string): boolean {
  return hasAliasSlug(value);
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
