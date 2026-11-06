/**
 * Adapter-owned auxiliary-file emission for Jira.
 *
 * Phase 2 port of the cross-adapter `emitAuxiliaryFiles` contract defined in
 * `@relayfile/adapter-core` and first implemented by `@relayfile/adapter-confluence`
 * (Phase 1, relayfile-adapters#78). Generalizes the write-loop currently
 * sitting in `cloud/packages/core/src/sync/record-writer.ts`
 * (`writeJiraAuxiliaryFiles`) so the same primitive ships in the adapter
 * itself and cloud's dispatcher collapses to a 10-line provider switch in
 * Phase 3.
 *
 * Behavior reproduced from cloud's current implementation, plus the
 * sprint/project/comment branches the LAYOUT documents but cloud's
 * record-writer historically left as a follow-up:
 *
 *   1. For every issue record, write the by-id alias unconditionally (the
 *      stable reconciliation anchor), plus by-title, by-key, by-state,
 *      by-assignee, by-creator, and by-priority when the corresponding
 *      provider fields are present. The canonical
 *      `/jira/issues/<slug>__<id>.json` path is written too — bytes are
 *      identical at every alias path.
 *   2. For every issue rename / status transition / key change, read the
 *      prior by-id alias to recover the previous summary / status / key,
 *      recompute the prior alias set, and delete every alias that no
 *      longer applies. Reads degrade to "no reconciliation" when the
 *      client lacks `readFile` — same back-compat as the confluence port.
 *   3. For every project and sprint record, write the canonical path and
 *      upsert the matching `_index.json` row.
 *   4. For every comment record, write a stable by-id alias plus the nested
 *      `/jira/issues/<issueIdOrKey>/comments/<commentId>.json` path
 *      required for REST round-trip. Comments without an `issueIdOrKey`
 *      fall back to the flat legacy `/jira/comments/<commentId>.json`.
 *      Global and per-issue indexes reconcile moves and sparse tombstones
 *      using the parent identity saved at the by-id alias.
 *   5. For deleted records, all known alias and canonical paths are
 *      removed. Index rows are also removed in the same flush — this is
 *      the Devin regression captured in confluence#78 7ec987b:
 *      `IndexFileReconciler.remove(id)` must run alongside the file
 *      deletes or `_index.json` accumulates ghost rows.
 *   6. `_index.json` files for issues, projects, and sprints are read once,
 *      merged with upserts and removes, written once. Per-path failures
 *      land in the returned `errors` array and never abort the batch.
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

import { sanitizeJiraRecordForStorage } from './jira-adapter.js';
import {
  jiraCommentByIdAliasPath,
  jiraCommentIssueRef,
  jiraCommentPath,
  jiraCommentsIndexPath,
  jiraIssueByAssigneeAliasPath,
  jiraIssueByCreatorAliasPath,
  jiraIssueByEditedPath,
  jiraIssueByIdAliasPath,
  jiraIssueByKeyAliasPath,
  jiraIssueByPriorityPath,
  jiraIssueByStatePath,
  jiraIssueByTitleAliasPath,
  jiraIssuePath,
  jiraIssuesIndexPath,
  jiraProjectByIdAliasPath,
  jiraProjectByTitleAliasPath,
  jiraProjectPath,
  jiraProjectsIndexPath,
  jiraRootIndexPath,
  jiraSprintByIdAliasPath,
  jiraSprintByTitleAliasPath,
  jiraSprintPath,
  jiraSprintsIndexPath,
} from './path-mapper.js';
import {
  jiraCommentIndexRow,
  jiraIssueIndexRow,
  jiraProjectIndexRow,
  jiraSprintIndexRow,
  type JiraIssueIndexRow,
  type JiraCommentIndexRow,
  type JiraProjectIndexRow,
  type JiraSprintIndexRow,
} from './queries.js';
import type {
  JiraComment,
  JiraCommentParent,
  JiraIssue,
  JiraProject,
  JiraSprint,
} from './types.js';
import type { RelayFileClientLike } from './jira-adapter.js';

/** Provider tag emitted in every aux-file payload wrapper. */
const JIRA_PROVIDER_NAME = 'jira';
const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

// -- Record types ----------------------------------------------------------

export type JiraIssueEmitRecord =
  | JiraIssue
  | { id: string; _deleted: true };

export type JiraProjectEmitRecord =
  | JiraProject
  | { id: string; _deleted: true };

export type JiraSprintEmitRecord =
  | JiraSprint
  | { id: string | number; _deleted: true };

/**
 * Comment records carry the parent `issueIdOrKey` because the REST API
 * needs it for round-trip. Webhook payloads without parent context fall
 * back to the legacy flat path.
 */
export type JiraCommentEmitRecord =
  | (JiraComment & JiraCommentParent)
  | ({ id: string; _deleted: true } & JiraCommentParent);

export interface JiraEmitAuxiliaryFilesInput {
  workspaceId: string;
  issues?: readonly JiraIssueEmitRecord[];
  projects?: readonly JiraProjectEmitRecord[];
  sprints?: readonly JiraSprintEmitRecord[];
  comments?: readonly JiraCommentEmitRecord[];
  /**
   * Optional connection id surfaced in the payload wrapper so downstream
   * readers can route writeback by connection. Mirrors the
   * `JiraAdapter.renderContent` output.
   */
  connectionId?: string;
}

// -- Entry point -----------------------------------------------------------

/**
 * Phase-2 entry point. Cloud's Phase 3 dispatcher iterates
 * `(provider, records)` and calls this function with a shimmed
 * `AuxiliaryEmitterClient`. Accepts either the shared client contract or
 * the adapter's own `RelayFileClientLike` (structurally compatible —
 * `readFile` is optional in both). Comment canonical writes can proceed
 * without reads, but index reconciliation reports an error rather than
 * overwrite an unknown baseline. Stable comment aliases advance only after
 * canonical cleanup and all affected indexes succeed, preserving retries.
 */
export async function emitJiraAuxiliaryFiles(
  client: AuxiliaryEmitterClient | RelayFileClientLike,
  input: JiraEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const emitterClient = client as AuxiliaryEmitterClient;
  const workspaceId = input.workspaceId;
  const issues = input.issues ?? [];
  const projects = input.projects ?? [];
  const sprints = input.sprints ?? [];
  const comments = input.comments ?? [];
  const hasIssues = hasOwn(input, 'issues');
  const hasProjects = hasOwn(input, 'projects');
  const hasSprints = hasOwn(input, 'sprints');
  const hasComments = hasOwn(input, 'comments');

  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };

  // Always emit the root `/jira/_index.json` so `ls /jira/` reliably surfaces
  // the top-level resource buckets, even for empty / single-bucket batches.
  // Mirrors `emitSlackAuxiliaryFiles`.
  await writeRootIndex(emitterClient, workspaceId, aggregate);

  if (!hasIssues && !hasProjects && !hasSprints && !hasComments) {
    return aggregate;
  }

  if (hasIssues) {
    accumulate(aggregate, await emitIssues(emitterClient, workspaceId, issues, input.connectionId));
  }
  if (hasProjects) {
    accumulate(aggregate, await emitProjects(emitterClient, workspaceId, projects, input.connectionId));
  }
  if (hasSprints) {
    accumulate(aggregate, await emitSprints(emitterClient, workspaceId, sprints, input.connectionId));
  }
  if (hasComments) {
    accumulate(aggregate, await emitComments(emitterClient, workspaceId, comments, input.connectionId));
  }

  return aggregate;
}

// -- Root index ------------------------------------------------------------

export interface JiraRootIndexRow {
  id: string;
  title: string;
}

/**
 * Build `/jira/_index.json` — a static listing of top-level resource roots
 * the Jira adapter exposes. Mirrors the slack pattern so an agent can
 * `ls /jira/` and discover the available buckets.
 */
export function buildJiraRootIndexFile(
  rows: JiraRootIndexRow[] = [
    { id: 'issues', title: 'Issues' },
    { id: 'projects', title: 'Projects' },
    { id: 'sprints', title: 'Sprints' },
    { id: 'comments', title: 'Comments' },
  ],
): { path: string; content: string; contentType: typeof JSON_CONTENT_TYPE } {
  return {
    path: jiraRootIndexPath(),
    content: `${JSON.stringify(rows)}\n`,
    contentType: JSON_CONTENT_TYPE,
  };
}

async function writeRootIndex(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  const file = buildJiraRootIndexFile();
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

// -- Issues ----------------------------------------------------------------

async function emitIssues(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly JiraIssueEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  if (records.length === 0) {
    return writeEmptyIndex(client, workspaceId, jiraIssuesIndexPath());
  }

  const indexReconciler = new IndexFileReconciler<JiraIssueIndexRow>({
    client,
    workspaceId,
    path: jiraIssuesIndexPath(),
    builder: (rows) => ({
      path: jiraIssuesIndexPath(),
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
  issue: JiraIssue,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<JiraIssueIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(issue.id);
  if (!id) {
    return {};
  }

  const fields = isRecord(issue.fields) ? issue.fields : {};
  const statusObject = isRecord(fields.status) ? fields.status : {};
  const assigneeObject = isRecord(fields.assignee) ? fields.assignee : {};
  const creatorObject = isRecord(fields.creator) ? fields.creator : {};
  const priorityObject = isRecord(fields.priority) ? fields.priority : {};
  const summary = readNonEmptyString((fields as { summary?: unknown }).summary);
  const status = readNonEmptyString((statusObject as { name?: unknown }).name);
  const key = readNonEmptyString((issue as { key?: unknown }).key);
  const assigneeAccountId = readNonEmptyString(
    (assigneeObject as { accountId?: unknown }).accountId,
  );
  const creatorAccountId = readNonEmptyString(
    (creatorObject as { accountId?: unknown }).accountId,
  );
  const priorityName = readNonEmptyString((priorityObject as { name?: unknown }).name);
  const editedDate = editedDateSegment(readIssueEditedAt(issue));

  const safe = sanitizeJiraRecordForStorage(issue as unknown as Record<string, unknown>);
  // `sanitizeJiraRecordForStorage` strips the entire `fields.assignee` user
  // record as PII, but the bare `accountId` is an opaque Atlassian id
  // (no PII) and is required to compute stale `by-assignee/...` paths
  // when the issue is reassigned. Hoist it onto `fields.assigneeAccountId`
  // so `extractPriorIssueState` can read it back on the next emit.
  if (assigneeAccountId || creatorAccountId || priorityName) {
    const safeFields = isRecord(safe.fields)
      ? safe.fields
      : ({} as Record<string, unknown>);
    if (assigneeAccountId) {
      safeFields.assigneeAccountId = assigneeAccountId;
    }
    if (creatorAccountId) {
      safeFields.creatorAccountId = creatorAccountId;
    }
    if (priorityName) {
      safeFields.priorityName = priorityName;
    }
    safe.fields = safeFields;
  }
  const content = renderObjectContent(safe, 'issue', id, connectionId, false);

  const newPaths = issuePathsFor({
    id,
    summary,
    status,
    key,
    assigneeAccountId,
    creatorAccountId,
    priorityName,
    editedDate,
  });

  // Reconciliation: read prior by-id to recover summary/status/key and
  // diff against the new alias set. by-id is the stable anchor and is
  // always in `newPaths`, so it never appears in the stale set.
  const prior = await priorReader.read<PriorIssueState>(
    jiraIssueByIdAliasPath(id),
    extractPriorIssueState,
  );
  const stalePaths = prior ? diffPaths(issuePathsFor({ id, ...prior }), newPaths) : [];

  const writes: EmitWrite[] = newPaths.map((path) => ({
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
  }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));

  indexReconciler.upsert(jiraIssueIndexRow(issue));

  return { writes, deletes };
}

async function planIssueDelete(
  id: string,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<JiraIssueIndexRow>,
): Promise<EmitPlan> {
  // For deletes we have no fresh payload, so we rely entirely on the prior
  // by-id alias to recover the alias fields. If the prior alias is missing
  // (degraded reader, or first-ever sync), we still delete by-id
  // unconditionally — minimal cleanup.
  const prior = await priorReader.read<PriorIssueState>(
    jiraIssueByIdAliasPath(id),
    extractPriorIssueState,
  );
  const paths = issuePathsFor({ id, ...(prior ?? {}) });
  // Devin regression from PR #78: removing the canonical/alias files but
  // leaving the index row in place produces ghost rows. `.remove(id)`
  // no-ops if the id isn't present in the existing index, so this is
  // safe for first-ever-sync deletes too.
  indexReconciler.remove(id);
  return { deletes: paths.map((path) => ({ path })) };
}

interface PriorIssueState {
  summary?: string | undefined;
  status?: string | undefined;
  key?: string | undefined;
  assigneeAccountId?: string | undefined;
  creatorAccountId?: string | undefined;
  priorityName?: string | undefined;
  editedDate?: string | undefined;
}

function issuePathsFor(args: { id: string } & PriorIssueState): string[] {
  const { id, summary, status, key, assigneeAccountId, creatorAccountId, priorityName, editedDate } = args;
  const paths: string[] = [];
  // Canonical: `<slug>__<id>.json` — uses the issue summary for the slug,
  // falling back to the key when summary is missing (matches the existing
  // titleSegmentWithId behavior).
  paths.push(jiraIssuePath(id, summary));
  // by-id anchor
  paths.push(jiraIssueByIdAliasPath(id));
  if (summary) {
    paths.push(jiraIssueByTitleAliasPath(summary, id));
  }
  if (key) {
    paths.push(jiraIssueByKeyAliasPath(key));
  }
  if (status) {
    paths.push(jiraIssueByStatePath(status, id));
  }
  if (assigneeAccountId) {
    paths.push(jiraIssueByAssigneeAliasPath(assigneeAccountId, id));
  }
  if (creatorAccountId) {
    paths.push(jiraIssueByCreatorAliasPath(creatorAccountId, id));
  }
  if (priorityName) {
    paths.push(jiraIssueByPriorityPath(priorityName, id));
  }
  if (editedDate) {
    paths.push(jiraIssueByEditedPath(editedDate, id));
  }
  return paths;
}

function extractPriorIssueState(parsed: Record<string, unknown>): PriorIssueState | null {
  const payload = pickPayload(parsed);
  if (!payload) return null;
  const fields = isRecord(payload.fields) ? payload.fields : {};
  const status = isRecord(fields.status) ? fields.status : {};
  return {
    summary: readNonEmptyString((fields as { summary?: unknown }).summary),
    status: readNonEmptyString((status as { name?: unknown }).name),
    key: readNonEmptyString((payload as { key?: unknown }).key),
    // The full `fields.assignee` user object is redacted by
    // `sanitizeJiraRecordForStorage`; `planIssueWrite` hoists the bare
    // `accountId` to `fields.assigneeAccountId` for reconciliation reads.
    assigneeAccountId: readNonEmptyString(
      (fields as { assigneeAccountId?: unknown }).assigneeAccountId,
    ),
    creatorAccountId: readNonEmptyString(
      (fields as { creatorAccountId?: unknown }).creatorAccountId,
    ),
    priorityName: readNonEmptyString(
      (fields as { priorityName?: unknown }).priorityName,
    ),
    editedDate: editedDateSegment(readIssueEditedAt(payload)),
  };
}

// -- Projects --------------------------------------------------------------

async function emitProjects(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly JiraProjectEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  if (records.length === 0) {
    return writeEmptyIndex(client, workspaceId, jiraProjectsIndexPath());
  }

  const indexReconciler = new IndexFileReconciler<JiraProjectIndexRow>({
    client,
    workspaceId,
    path: jiraProjectsIndexPath(),
    builder: (rows) => ({
      path: jiraProjectsIndexPath(),
      content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });

  const priorReader = new PriorAliasReader(client, workspaceId);

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planProjectDelete(record.id, priorReader, indexReconciler);
    }
    return planProjectWrite(record, priorReader, indexReconciler, connectionId);
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);

  return fanOut;
}

interface PriorProjectState {
  name?: string | undefined;
}

function projectPathsFor(args: { id: string } & PriorProjectState): string[] {
  const { id, name } = args;
  const paths = [jiraProjectPath(id, name), jiraProjectByIdAliasPath(id)];
  if (name) {
    paths.push(jiraProjectByTitleAliasPath(name, id));
  }
  return paths;
}

function extractPriorProjectState(parsed: Record<string, unknown>): PriorProjectState | null {
  const payload = pickPayload(parsed);
  if (!payload) return null;
  return {
    name:
      readNonEmptyString((payload as { name?: unknown }).name) ??
      readNonEmptyString((payload as { key?: unknown }).key),
  };
}

async function planProjectWrite(
  project: JiraProject,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<JiraProjectIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(project.id);
  if (!id) {
    return {};
  }
  const name = readNonEmptyString(project.name) ?? readNonEmptyString(project.key);
  const safe = sanitizeJiraRecordForStorage(project as unknown as Record<string, unknown>);
  const content = renderObjectContent(safe, 'project', id, connectionId, false);

  const newPaths = projectPathsFor({ id, name });

  // Reconciliation: read prior by-id to recover the previous name so a
  // rename invalidates the stale canonical `<slug>__<id>.json`.
  const prior = await priorReader.read<PriorProjectState>(
    jiraProjectByIdAliasPath(id),
    extractPriorProjectState,
  );
  const stalePaths = prior ? diffPaths(projectPathsFor({ id, ...prior }), newPaths) : [];

  const writes: EmitWrite[] = newPaths.map((path) => ({
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
  }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));

  indexReconciler.upsert(jiraProjectIndexRow(project));

  return { writes, deletes };
}

async function planProjectDelete(
  id: string,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<JiraProjectIndexRow>,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorProjectState>(
    jiraProjectByIdAliasPath(id),
    extractPriorProjectState,
  );
  const paths = projectPathsFor({ id, ...(prior ?? {}) });
  indexReconciler.remove(id);
  return { deletes: paths.map((path) => ({ path })) };
}

// -- Sprints ---------------------------------------------------------------

async function emitSprints(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly JiraSprintEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  if (records.length === 0) {
    return writeEmptyIndex(client, workspaceId, jiraSprintsIndexPath());
  }

  const indexReconciler = new IndexFileReconciler<JiraSprintIndexRow>({
    client,
    workspaceId,
    path: jiraSprintsIndexPath(),
    builder: (rows) => ({
      path: jiraSprintsIndexPath(),
      content: `${JSON.stringify([...rows].sort(compareIndexRows))}\n`,
      contentType: JSON_CONTENT_TYPE,
    }),
  });

  const priorReader = new PriorAliasReader(client, workspaceId);

  const fanOut = await runEmitBatch(client, workspaceId, records, async (record) => {
    if (isDeleteRecord(record)) {
      return planSprintDelete(String(record.id), priorReader, indexReconciler);
    }
    return planSprintWrite(record, priorReader, indexReconciler, connectionId);
  });

  const indexResult = await indexReconciler.flush();
  fanOut.written += indexResult.written;
  fanOut.errors.push(...indexResult.errors);

  return fanOut;
}

interface PriorSprintState {
  name?: string | undefined;
}

function sprintPathsFor(args: { id: string } & PriorSprintState): string[] {
  const { id, name } = args;
  const paths = [jiraSprintPath(id, name), jiraSprintByIdAliasPath(id)];
  if (name) {
    paths.push(jiraSprintByTitleAliasPath(name, id));
  }
  return paths;
}

function extractPriorSprintState(parsed: Record<string, unknown>): PriorSprintState | null {
  const payload = pickPayload(parsed);
  if (!payload) return null;
  return {
    name: readNonEmptyString((payload as { name?: unknown }).name),
  };
}

async function planSprintWrite(
  sprint: JiraSprint,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<JiraSprintIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const id = readNonEmptyString(String(sprint.id));
  if (!id) {
    return {};
  }
  const name = readNonEmptyString(sprint.name);
  const safe = sanitizeJiraRecordForStorage(sprint as unknown as Record<string, unknown>);
  const content = renderObjectContent(safe, 'sprint', id, connectionId, false);

  const newPaths = sprintPathsFor({ id, name });

  // Reconciliation: see `planProjectWrite`.
  const prior = await priorReader.read<PriorSprintState>(
    jiraSprintByIdAliasPath(id),
    extractPriorSprintState,
  );
  const stalePaths = prior ? diffPaths(sprintPathsFor({ id, ...prior }), newPaths) : [];

  const writes: EmitWrite[] = newPaths.map((path) => ({
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
  }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));

  indexReconciler.upsert(jiraSprintIndexRow(sprint));

  return { writes, deletes };
}

async function planSprintDelete(
  id: string,
  priorReader: PriorAliasReader,
  indexReconciler: IndexFileReconciler<JiraSprintIndexRow>,
): Promise<EmitPlan> {
  const prior = await priorReader.read<PriorSprintState>(
    jiraSprintByIdAliasPath(id),
    extractPriorSprintState,
  );
  const paths = sprintPathsFor({ id, ...(prior ?? {}) });
  indexReconciler.remove(id);
  return { deletes: paths.map((path) => ({ path })) };
}

// -- Comments --------------------------------------------------------------

async function emitComments(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly JiraCommentEmitRecord[],
  connectionId: string | undefined,
): Promise<EmitAuxiliaryFilesResult> {
  // Keep only the last mutation for each id/path. The shared reconciler applies
  // upserts after removals, so queuing both would resurrect a same-batch delete.
  const indexes = new Map<string, Map<string, JiraCommentIndexRow | null>>();
  const indexFor = (issueIdOrKey?: string): Map<string, JiraCommentIndexRow | null> => {
    const path = jiraCommentsIndexPath(issueIdOrKey);
    let index = indexes.get(path);
    if (!index) {
      index = new Map();
      indexes.set(path, index);
    }
    return index;
  };
  indexFor(); // An explicit empty bucket still exposes a readable global index.
  const batchState = new Map<string, Record<string, unknown> | null>();
  const aliases = new Map<string, EmitPlan>();
  const result = await runEmitBatch(client, workspaceId, records, async (record) => {
    const id = readNonEmptyString((record as { id?: unknown }).id);
    if (!id) return {};
    const alias = jiraCommentByIdAliasPath(id);
    const prior = batchState.has(id) ? batchState.get(id) ?? null : await readCommentPriorAlias(client, workspaceId, alias);
    const priorPayload = prior ? pickPayload(prior) : null;
    const priorIssue = jiraCommentIssueRef(priorPayload);
    const issueIdOrKey = jiraCommentIssueRef(record) ?? priorIssue;
    // Recompute from stored identity rather than trusting a prior path field.
    const priorPath = prior ? jiraCommentPath(id, priorIssue) : undefined;
    const path = jiraCommentPath(id, issueIdOrKey);

    if (isDeleteRecord(record)) {
      indexFor().set(id, null);
      if (priorIssue) indexFor(priorIssue).set(id, null);
      if (issueIdOrKey) indexFor(issueIdOrKey).set(id, null);
      batchState.set(id, prior ?? { id, ...(issueIdOrKey ? { issueIdOrKey } : {}) });
      aliases.set(id, { deletes: [{ path: alias }] });
      return {
        deletes: [...new Set([path, ...(priorPath ? [priorPath] : [])])]
          .map((path) => ({ path })),
      };
    }

    const safe = sanitizeJiraRecordForStorage(record as unknown as Record<string, unknown>);
    if (issueIdOrKey) safe.issueIdOrKey = issueIdOrKey;
    const content = JSON.stringify({
      provider: JIRA_PROVIDER_NAME, objectType: 'comment', objectId: id,
      path, canonicalPath: path, deleted: false, payload: safe,
      ...(connectionId ? { connectionId } : {}),
    }, null, 2);
    const row = jiraCommentIndexRow({
      ...record, id,
      ...(issueIdOrKey ? { issueIdOrKey } : {}),
    });
    indexFor().set(id, row);
    if (priorIssue && priorIssue !== issueIdOrKey) indexFor(priorIssue).set(id, null);
    if (issueIdOrKey) indexFor(issueIdOrKey).set(id, row);
    batchState.set(id, safe);
    aliases.set(id, { writes: [{ path: alias, content, contentType: JSON_CONTENT_TYPE }] });
    return {
      writes: [{ path, content, contentType: JSON_CONTENT_TYPE }],
      deletes: priorPath && priorPath !== path ? [{ path: priorPath }] : [],
    };
  });
  for (const [path, mutations] of indexes) {
    try {
      const existing = await readCommentIndexRows(client, workspaceId, path);
      const merged = new Map(existing.map((row) => [row.id, row]));
      for (const [id, row] of mutations) {
        if (row) merged.set(id, row);
        else merged.delete(id);
      }
      await client.writeFile({ workspaceId, path,
        content: `${JSON.stringify([...merged.values()].map(normalizeCommentIndexRow).sort(compareIndexRows))}\n`,
        contentType: JSON_CONTENT_TYPE });
      result.written++;
    } catch (error) {
      result.errors.push({ path, error: String(error) });
    }
  }
  // The stable alias is also the retry anchor for old-parent cleanup. Advance
  // it only after canonical mutations and every affected index have succeeded.
  if (result.errors.length === 0) {
    accumulate(result, await runEmitBatch(client, workspaceId, [...aliases.values()], (plan) => plan));
  }
  return result;
}

/** Unknown prior state must stay retryable instead of overwriting its anchor. */
async function readCommentPriorAlias(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): Promise<Record<string, unknown> | null> {
  if (!client.readFile) return null;
  const parsed = await readCommentJson(client, workspaceId, path);
  if (parsed === undefined) return null;
  if (!isRecord(parsed)) throw new Error('Invalid comment alias baseline');
  return parsed;
}

/** Refuse an unreadable baseline rather than erasing unrelated comment rows. */
async function readCommentIndexRows(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): Promise<JiraCommentIndexRow[]> {
  const rows = await readCommentJson(client, workspaceId, path);
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || rows.some((row) => !isRecord(row) || !readNonEmptyString(row.id))) {
    throw new Error('Invalid comment index baseline');
  }
  return rows as JiraCommentIndexRow[];
}

async function readCommentJson(client: AuxiliaryEmitterClient, workspaceId: string, path: string): Promise<unknown> {
  if (!client.readFile) throw new Error('Comment index reconciliation requires readFile');
  let content: string | undefined;
  try {
    const file = await client.readFile({ workspaceId, path });
    if (file == null) return undefined;
    if (typeof file.content !== 'string') throw new Error('Unreadable comment storage baseline');
    content = file.content;
  } catch (error) {
    const value = isRecord(error) ? error : {};
    const response = isRecord(value.response) ? value.response : {};
    if ((value.status ?? value.statusCode ?? response.status) === 404) return undefined;
    throw error;
  }
  return content === undefined ? undefined : JSON.parse(content);
}

/** Older consumers used updatedAt and omitted title/updated in comment rows. */
function normalizeCommentIndexRow(row: JiraCommentIndexRow): JiraCommentIndexRow {
  const issueIdOrKey = jiraCommentIssueRef(row);
  const path = readNonEmptyString(row.canonicalPath) ?? readNonEmptyString(row.path)
    ?? jiraCommentPath(row.id, issueIdOrKey);
  return {
    ...row,
    title: readNonEmptyString(row.title) ?? `Comment ${row.id}`,
    updated: readNonEmptyString(row.updated)
      ?? readNonEmptyString((row as unknown as Record<string, unknown>).updatedAt) ?? '',
    path,
    canonicalPath: path,
  };
}

// -- Shared helpers --------------------------------------------------------

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

function renderObjectContent(
  safe: Record<string, unknown>,
  objectType: 'issue' | 'project' | 'sprint' | 'comment',
  objectId: string,
  connectionId: string | undefined,
  deleted: boolean,
): string {
  return JSON.stringify(
    {
      provider: JIRA_PROVIDER_NAME,
      objectType,
      objectId,
      deleted,
      payload: safe,
      ...(connectionId ? { connectionId } : {}),
    },
    null,
    2,
  );
}

function compareIndexRows(
  left: { id: string; updated: string },
  right: { id: string; updated: string },
): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

function isDeleteRecord(
  record:
    | JiraIssueEmitRecord
    | JiraProjectEmitRecord
    | JiraSprintEmitRecord
    | JiraCommentEmitRecord,
): record is { id: string; _deleted: true; issueIdOrKey?: string } {
  return (
    isRecord(record) &&
    (record as { _deleted?: unknown })._deleted === true &&
    (typeof (record as { id?: unknown }).id === 'string' ||
      typeof (record as { id?: unknown }).id === 'number')
  );
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readIssueEditedAt(issue: { fields?: unknown; updated?: unknown }): string | undefined {
  const fields = isRecord(issue.fields) ? issue.fields : {};
  return (
    readNonEmptyString((fields as { updated?: unknown }).updated) ??
    readNonEmptyString((issue as { updated?: unknown }).updated)
  );
}

function editedDateSegment(value: string | undefined): string | undefined {
  return value?.match(/^(\d{4}-\d{2}-\d{2})/u)?.[1];
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
