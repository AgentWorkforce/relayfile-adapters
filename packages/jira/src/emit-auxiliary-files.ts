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
 *   4. For every comment record, write the nested
 *      `/jira/issues/<issueIdOrKey>/comments/<commentId>.json` path
 *      required for REST round-trip. Comments without an `issueIdOrKey`
 *      fall back to the flat legacy `/jira/comments/<commentId>.json`.
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
  jiraCommentPath,
  jiraIssueByAssigneeAliasPath,
  jiraIssueByCreatorAliasPath,
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
  jiraIssueIndexRow,
  jiraProjectIndexRow,
  jiraSprintIndexRow,
  type JiraIssueIndexRow,
  type JiraProjectIndexRow,
  type JiraSprintIndexRow,
} from './queries.js';
import type {
  JiraComment,
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
  | (JiraComment & { issueIdOrKey?: string })
  | { id: string; _deleted: true; issueIdOrKey?: string };

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
 * `readFile` is optional in both).
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
  if (hasComments && comments.length > 0) {
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

  const newPaths = issuePathsFor({ id, summary, status, key, assigneeAccountId, creatorAccountId, priorityName });

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
}

function issuePathsFor(args: { id: string } & PriorIssueState): string[] {
  const { id, summary, status, key, assigneeAccountId, creatorAccountId, priorityName } = args;
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
  // Comments are not indexed — they live nested under their parent issue
  // (or, for orphaned webhook payloads, under the flat legacy path).
  return runEmitBatch(client, workspaceId, records, async (record) => {
    const id = readNonEmptyString((record as { id?: unknown }).id);
    if (!id) return {};
    const issueIdOrKey = readNonEmptyString(
      (record as { issueIdOrKey?: unknown }).issueIdOrKey,
    );
    const path = jiraCommentPath(id, issueIdOrKey);

    if (isDeleteRecord(record)) {
      return { deletes: [{ path }] };
    }

    const safe = sanitizeJiraRecordForStorage(record as unknown as Record<string, unknown>);
    const content = renderObjectContent(safe, 'comment', id, connectionId, false);
    return { writes: [{ path, content, contentType: JSON_CONTENT_TYPE }] };
  });
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
