import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  PriorAliasReader,
  runEmitBatch,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitError,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import {
  buildGitLabProjectResourceIndexFile,
  buildGitLabProjectsIndexFile,
  buildGitLabRootIndexFile,
  type GitLabProjectIndexRow,
  type GitLabRecordIndexRow,
} from './index-emitter.js';
import { gitLabLayoutPromptFile } from './layout-prompt.js';
import {
  computeMetadataPath,
  gitLabByAssigneeAliasPath,
  gitLabByCreatorAliasPath,
  gitLabByIdAliasPath,
  gitLabByPriorityAliasPath,
  gitLabByRefAliasPath,
  gitLabByStateAliasPath,
  gitLabByStatusAliasPath,
  gitLabByTitleAliasPath,
  gitLabProjectResourceIndexPath,
  gitLabProjectsIndexPath,
  type GitLabIndexedResourceType,
} from './path-mapper.js';

const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export interface GitLabRecordContext {
  projectPath?: string;
  project_path?: string;
  path_with_namespace?: string;
  project?: { path_with_namespace?: string };
  [key: string]: unknown;
}

export interface GitLabMergeRequestEmitRecord extends GitLabRecordContext {
  iid: number | string;
  title?: string;
  state?: string;
  assignees?: unknown[];
  author?: unknown;
  labels?: unknown[];
  priority?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface GitLabIssueEmitRecord extends GitLabRecordContext {
  iid: number | string;
  title?: string;
  state?: string;
  assignees?: unknown[];
  author?: unknown;
  labels?: unknown[];
  priority?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface GitLabPipelineEmitRecord extends GitLabRecordContext {
  id: number | string;
  ref?: string;
  status?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface GitLabCommitEmitRecord extends GitLabRecordContext {
  id?: string;
  sha?: string;
  title?: string;
  committed_date?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface GitLabDeploymentEmitRecord extends GitLabRecordContext {
  id: number | string;
  status?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface GitLabTagEmitRecord extends GitLabRecordContext {
  ref: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface GitLabEmitAuxiliaryFilesInput {
  workspaceId: string;
  mergeRequests?: readonly GitLabMergeRequestEmitRecord[];
  issues?: readonly GitLabIssueEmitRecord[];
  pipelines?: readonly GitLabPipelineEmitRecord[];
  commits?: readonly GitLabCommitEmitRecord[];
  deployments?: readonly GitLabDeploymentEmitRecord[];
  tags?: readonly GitLabTagEmitRecord[];
  connectionId?: string;
}

export async function emitGitLabAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: GitLabEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const aggregate: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };
  const workspaceId = input.workspaceId;

  await writeStaticFiles(client, workspaceId, aggregate);

  const priorReader = new PriorAliasReader(client, workspaceId);
  const projects = new IndexFileReconciler<GitLabProjectIndexRow>({
    client,
    workspaceId,
    path: gitLabProjectsIndexPath(),
    builder: (rows) => buildGitLabProjectsIndexFile(rows),
  });
  const recordReconcilers = new Map<string, IndexFileReconciler<GitLabRecordIndexRow>>();

  const getRecordReconciler = (projectPath: string, objectType: GitLabIndexedResourceType) => {
    const key = `${projectPath}\0${objectType}`;
    let reconciler = recordReconcilers.get(key);
    if (!reconciler) {
      reconciler = new IndexFileReconciler<GitLabRecordIndexRow>({
        client,
        workspaceId,
        path: gitLabProjectResourceIndexPath(projectPath, objectType),
        builder: (rows) => buildGitLabProjectResourceIndexFile(projectPath, objectType, rows),
      });
      recordReconcilers.set(key, reconciler);
    }
    return reconciler;
  };

  accumulate(aggregate, await runEmitBatch(client, workspaceId, input.mergeRequests ?? [], async (record) =>
    planTitledDirectoryRecord(record, 'merge_requests', record.iid, priorReader, projects, getRecordReconciler, input.connectionId),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, input.issues ?? [], async (record) =>
    planTitledDirectoryRecord(record, 'issues', record.iid, priorReader, projects, getRecordReconciler, input.connectionId),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, input.pipelines ?? [], async (record) =>
    planPipelineRecord(record, projects, getRecordReconciler, input.connectionId),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, input.commits ?? [], async (record) =>
    planCommitRecord(record, priorReader, projects, getRecordReconciler, input.connectionId),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, input.deployments ?? [], async (record) =>
    planDeploymentRecord(record, projects, getRecordReconciler, input.connectionId),
  ));
  accumulate(aggregate, await runEmitBatch(client, workspaceId, input.tags ?? [], async (record) =>
    planTagRecord(record, projects, getRecordReconciler, input.connectionId),
  ));

  const projectFlush = await projects.flush();
  aggregate.written += projectFlush.written;
  aggregate.errors.push(...projectFlush.errors);

  for (const reconciler of recordReconcilers.values()) {
    const flush = await reconciler.flush();
    aggregate.written += flush.written;
    aggregate.errors.push(...flush.errors);
  }

  return aggregate;
}

async function writeStaticFiles(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  aggregate: EmitAuxiliaryFilesResult,
): Promise<void> {
  for (const file of [buildGitLabRootIndexFile(), gitLabLayoutPromptFile()]) {
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
}

async function planTitledDirectoryRecord(
  record: GitLabMergeRequestEmitRecord | GitLabIssueEmitRecord,
  objectType: 'merge_requests' | 'issues',
  objectId: number | string,
  priorReader: PriorAliasReader,
  projects: IndexFileReconciler<GitLabProjectIndexRow>,
  getReconciler: (projectPath: string, objectType: GitLabIndexedResourceType) => IndexFileReconciler<GitLabRecordIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const projectPath = extractProjectPath(record);
  if (!projectPath) return {};

  const id = String(objectId);
  const title = readNonEmptyString(record.title) ?? id;
  const state = readNonEmptyString(record.state);
  const assigneeKeys = readGitLabAssigneeKeys(record);
  const creatorKey = readGitLabCreatorKey(record);
  const priority = readPriority(record);
  const canonicalPath = computeMetadataPath(projectPath, objectType, id, title);
  const byIdPath = gitLabByIdAliasPath(projectPath, objectType, id);
  const prior = await priorReader.read<PriorTitledDirectoryRecord>(byIdPath, (parsed) => ({
    title: readNonEmptyString(parsed.title),
    state: readNonEmptyString(parsed.state),
    assigneeKeys: readStringArray(parsed.assigneeKeys),
    creatorKey: readNonEmptyString(parsed.creatorKey),
    priority: readNonEmptyString(parsed.priority),
  }));
  const newPaths = titledDirectoryPathsFor({
    projectPath,
    objectType,
    id,
    title,
    state,
    assigneeKeys,
    creatorKey,
    priority,
  });
  const priorPaths = prior
    ? titledDirectoryPathsFor({
        projectPath,
        objectType,
        id,
        title: prior.title ?? id,
        state: prior.state,
        assigneeKeys: prior.assigneeKeys,
        creatorKey: prior.creatorKey,
        priority: prior.priority,
      })
    : [];
  const deletes = diffPaths(priorPaths, newPaths).map((path) => ({ path }));

  upsertProject(projects, projectPath, readUpdatedAt(record));
  getReconciler(projectPath, objectType).upsert({
    id,
    title,
    updated: readUpdatedAt(record),
    iid: Number(id),
    state,
  });

  const writes: EmitWrite[] = [
    canonicalWrite(canonicalPath, objectType, record, connectionId),
    aliasWrite(byIdPath, id, canonicalPath, { title, state, assigneeKeys, creatorKey, priority }),
    aliasWrite(gitLabByTitleAliasPath(projectPath, objectType, title, id), id, canonicalPath, { title, state, assigneeKeys, creatorKey, priority }),
  ];
  if (state) {
    writes.push(aliasWrite(gitLabByStateAliasPath(projectPath, objectType, state, id), id, canonicalPath, { title, state, assigneeKeys, creatorKey, priority }));
  }
  for (const assignee of assigneeKeys) {
    writes.push(aliasWrite(gitLabByAssigneeAliasPath(projectPath, objectType, assignee, id), id, canonicalPath, { title, state, assigneeKeys, creatorKey, priority }));
  }
  if (creatorKey) {
    writes.push(aliasWrite(gitLabByCreatorAliasPath(projectPath, objectType, creatorKey, id), id, canonicalPath, { title, state, assigneeKeys, creatorKey, priority }));
  }
  if (priority) {
    writes.push(aliasWrite(gitLabByPriorityAliasPath(projectPath, objectType, priority, id), id, canonicalPath, { title, state, assigneeKeys, creatorKey, priority }));
  }

  return {
    deletes,
    writes,
  };
}

interface PriorTitledDirectoryRecord {
  title?: string | undefined;
  state?: string | undefined;
  assigneeKeys?: string[] | undefined;
  creatorKey?: string | undefined;
  priority?: string | undefined;
}

function titledDirectoryPathsFor(args: {
  projectPath: string;
  objectType: 'merge_requests' | 'issues';
  id: string;
  title: string;
  state?: string | undefined;
  assigneeKeys?: string[] | undefined;
  creatorKey?: string | undefined;
  priority?: string | undefined;
}): string[] {
  const { projectPath, objectType, id, title, state, assigneeKeys, creatorKey, priority } = args;
  const paths = [
    computeMetadataPath(projectPath, objectType, id, title),
    gitLabByIdAliasPath(projectPath, objectType, id),
    gitLabByTitleAliasPath(projectPath, objectType, title, id),
  ];
  if (state) paths.push(gitLabByStateAliasPath(projectPath, objectType, state, id));
  for (const assignee of assigneeKeys ?? []) {
    paths.push(gitLabByAssigneeAliasPath(projectPath, objectType, assignee, id));
  }
  if (creatorKey) paths.push(gitLabByCreatorAliasPath(projectPath, objectType, creatorKey, id));
  if (priority) paths.push(gitLabByPriorityAliasPath(projectPath, objectType, priority, id));
  return paths;
}

function planPipelineRecord(
  record: GitLabPipelineEmitRecord,
  projects: IndexFileReconciler<GitLabProjectIndexRow>,
  getReconciler: (projectPath: string, objectType: GitLabIndexedResourceType) => IndexFileReconciler<GitLabRecordIndexRow>,
  connectionId: string | undefined,
): EmitPlan {
  const projectPath = extractProjectPath(record);
  if (!projectPath) return {};
  const id = String(record.id);
  const ref = readNonEmptyString(record.ref);
  const status = readNonEmptyString(record.status);
  const canonicalPath = computeMetadataPath(projectPath, 'pipelines', id, ref);

  upsertProject(projects, projectPath, readUpdatedAt(record));
  getReconciler(projectPath, 'pipelines').upsert({
    id,
    title: ref ? `Pipeline ${id} (${ref})` : `Pipeline ${id}`,
    updated: readUpdatedAt(record),
    status,
    ref,
  });

  const writes: EmitWrite[] = [
    canonicalWrite(canonicalPath, 'pipeline', record, connectionId),
    aliasWrite(gitLabByIdAliasPath(projectPath, 'pipelines', id), id, canonicalPath, { ref, status }),
  ];
  if (ref) writes.push(aliasWrite(gitLabByRefAliasPath(projectPath, 'pipelines', ref, id), id, canonicalPath, { ref, status }));
  if (status) writes.push(aliasWrite(gitLabByStatusAliasPath(projectPath, 'pipelines', status, id), id, canonicalPath, { ref, status }));
  return { writes };
}

async function planCommitRecord(
  record: GitLabCommitEmitRecord,
  priorReader: PriorAliasReader,
  projects: IndexFileReconciler<GitLabProjectIndexRow>,
  getReconciler: (projectPath: string, objectType: GitLabIndexedResourceType) => IndexFileReconciler<GitLabRecordIndexRow>,
  connectionId: string | undefined,
): Promise<EmitPlan> {
  const projectPath = extractProjectPath(record);
  const id = readNonEmptyString(record.sha) ?? readNonEmptyString(record.id);
  if (!projectPath || !id) return {};
  const title = readNonEmptyString(record.title) ?? id.slice(0, 12);
  const canonicalPath = computeMetadataPath(projectPath, 'commits', id, title);
  const byIdPath = gitLabByIdAliasPath(projectPath, 'commits', id);
  const prior = await priorReader.read<{ title?: string }>(byIdPath, (parsed) => ({
    title: readNonEmptyString(parsed.title),
  }));
  const deletes = prior?.title && prior.title !== title
    ? [
        { path: computeMetadataPath(projectPath, 'commits', id, prior.title) },
        { path: gitLabByTitleAliasPath(projectPath, 'commits', prior.title, id) },
      ]
    : [];

  upsertProject(projects, projectPath, readUpdatedAt(record));
  getReconciler(projectPath, 'commits').upsert({
    id,
    title,
    updated: readUpdatedAt(record),
    sha: id,
  });

  return {
    deletes,
    writes: [
      canonicalWrite(canonicalPath, 'commit', record, connectionId),
      aliasWrite(byIdPath, id, canonicalPath, { title }),
      aliasWrite(gitLabByTitleAliasPath(projectPath, 'commits', title, id), id, canonicalPath, { title }),
    ],
  };
}

function planDeploymentRecord(
  record: GitLabDeploymentEmitRecord,
  projects: IndexFileReconciler<GitLabProjectIndexRow>,
  getReconciler: (projectPath: string, objectType: GitLabIndexedResourceType) => IndexFileReconciler<GitLabRecordIndexRow>,
  connectionId: string | undefined,
): EmitPlan {
  const projectPath = extractProjectPath(record);
  if (!projectPath) return {};
  const id = String(record.id);
  const status = readNonEmptyString(record.status);
  const canonicalPath = computeMetadataPath(projectPath, 'deployments', id);

  upsertProject(projects, projectPath, readUpdatedAt(record));
  getReconciler(projectPath, 'deployments').upsert({
    id,
    title: `Deployment ${id}`,
    updated: readUpdatedAt(record),
    status,
  });

  const writes: EmitWrite[] = [canonicalWrite(canonicalPath, 'deployment', record, connectionId)];
  if (status) writes.push(aliasWrite(gitLabByStatusAliasPath(projectPath, 'deployments', status, id), id, canonicalPath, { status }));
  return { writes };
}

function planTagRecord(
  record: GitLabTagEmitRecord,
  projects: IndexFileReconciler<GitLabProjectIndexRow>,
  getReconciler: (projectPath: string, objectType: GitLabIndexedResourceType) => IndexFileReconciler<GitLabRecordIndexRow>,
  connectionId: string | undefined,
): EmitPlan {
  const projectPath = extractProjectPath(record);
  if (!projectPath) return {};
  const id = record.ref;
  const canonicalPath = computeMetadataPath(projectPath, 'tags', id, id);

  upsertProject(projects, projectPath, readUpdatedAt(record));
  getReconciler(projectPath, 'tags').upsert({
    id,
    title: id,
    updated: readUpdatedAt(record),
    ref: id,
  });

  return {
    writes: [
      canonicalWrite(canonicalPath, 'tag', record, connectionId),
      aliasWrite(gitLabByRefAliasPath(projectPath, 'tags', id, id), id, canonicalPath, { ref: id }),
    ],
  };
}

function canonicalWrite(
  path: string,
  objectType: string,
  payload: Record<string, unknown>,
  connectionId: string | undefined,
): EmitWrite {
  return {
    path,
    content: renderContent(objectType, payload, connectionId),
    contentType: JSON_CONTENT_TYPE,
  };
}

function aliasWrite(path: string, id: string, canonicalPath: string, extra: Record<string, unknown>): EmitWrite {
  return {
    path,
    content: `${JSON.stringify({ id, canonicalPath, ...stripUndefined(extra) })}\n`,
    contentType: JSON_CONTENT_TYPE,
  };
}

function renderContent(
  objectType: string,
  payload: Record<string, unknown>,
  connectionId: string | undefined,
): string {
  return `${JSON.stringify({
    provider: 'gitlab',
    objectType,
    ...(connectionId ? { connectionId } : {}),
    ...payload,
  }, null, 2)}\n`;
}

function upsertProject(
  reconciler: IndexFileReconciler<GitLabProjectIndexRow>,
  projectPath: string,
  updated: string,
): void {
  reconciler.upsert({ id: projectPath, title: projectPath, updated });
}

function extractProjectPath(record: GitLabRecordContext): string | null {
  return (
    readNonEmptyString(record.projectPath)
    ?? readNonEmptyString(record.project_path)
    ?? readNonEmptyString(record.path_with_namespace)
    ?? readNonEmptyString(record.project?.path_with_namespace)
    ?? null
  );
}

function readUpdatedAt(record: Record<string, unknown>): string {
  return (
    readNonEmptyString(record.updated_at)
    ?? readNonEmptyString(record.updatedAt)
    ?? readNonEmptyString(record.committed_date)
    ?? ''
  );
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return uniqueStrings(value.map((entry) => readNonEmptyString(entry)).filter((entry): entry is string => Boolean(entry)));
}

function readGitLabAssigneeKeys(record: GitLabMergeRequestEmitRecord | GitLabIssueEmitRecord): string[] {
  const assignees = Array.isArray(record.assignees) ? record.assignees : [];
  return uniqueStrings(assignees.map((entry) => readUserKey(entry)).filter((entry): entry is string => Boolean(entry)));
}

function readGitLabCreatorKey(record: GitLabMergeRequestEmitRecord | GitLabIssueEmitRecord): string | undefined {
  return readUserKey(record.author);
}

function readUserKey(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return readNonEmptyString(value.username) ?? readNonEmptyString(value.id);
}

function readPriority(record: GitLabMergeRequestEmitRecord | GitLabIssueEmitRecord): string | undefined {
  const explicit = readNonEmptyString(record.priority);
  if (explicit) return explicit;
  const labels = Array.isArray(record.labels) ? record.labels : [];
  for (const label of labels) {
    const name = readNonEmptyString(label)
      ?? readNonEmptyString(isRecord(label) ? label.title : undefined)
      ?? readNonEmptyString(isRecord(label) ? label.name : undefined);
    const priority = parsePriorityLabel(name);
    if (priority) return priority;
  }
  return undefined;
}

function parsePriorityLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  const match = /^(?:priority|prio|p)[\s:_/-]*(.+)$/iu.exec(trimmed);
  return readNonEmptyString(match?.[1]) ?? (/^p[0-5]$/iu.test(trimmed) ? trimmed : undefined);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function diffPaths(prior: readonly string[], next: readonly string[]): string[] {
  const nextSet = new Set(next);
  return prior.filter((path) => !nextSet.has(path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function accumulate(target: EmitAuxiliaryFilesResult, partial: EmitAuxiliaryFilesResult): void {
  target.written += partial.written;
  target.deleted += partial.deleted;
  target.errors.push(...(partial.errors as EmitError[]));
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
