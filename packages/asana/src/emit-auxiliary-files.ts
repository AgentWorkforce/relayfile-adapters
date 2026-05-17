import {
  PriorAliasReader,
  runEmitBatch,
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  type AuxiliaryEmitterClient,
  type EmitAuxiliaryFilesResult,
  type EmitDelete,
  type EmitPlan,
  type EmitWrite,
} from '@relayfile/adapter-core';

import {
  asanaTaskByAssigneePath,
  asanaTaskByCreatorPath,
  asanaTaskByIdAliasPath,
  asanaTaskByPriorityPath,
  asanaTaskByStatePath,
} from './path-mapper.js';
import type { AsanaTask } from './types.js';

const ASANA_PROVIDER_NAME = 'asana';
const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export type AsanaTaskEmitRecord =
  | AsanaTask
  | AsanaTaskEmitEnvelope
  | { gid: string; _deleted: true };

export interface AsanaTaskEmitEnvelope {
  objectId?: string;
  payload: AsanaTask;
  content?: string;
  deleted?: boolean;
  connectionId?: string;
}

export interface AsanaEmitAuxiliaryFilesInput {
  workspaceId: string;
  tasks?: readonly AsanaTaskEmitRecord[];
  connectionId?: string;
}

export async function emitAsanaAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: AsanaEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const tasks = input.tasks ?? [];
  if (tasks.length === 0) {
    return { written: 0, deleted: 0, errors: [] };
  }

  const priorReader = new PriorAliasReader(client, input.workspaceId);
  return runEmitBatch(client, input.workspaceId, tasks, async (record) => {
    if (isDeleteRecord(record)) {
      return planTaskDelete(record.gid, record, priorReader);
    }
    const normalized = normalizeTaskRecord(record, input.connectionId);
    if (normalized.deleted) {
      return planTaskDelete(normalized.id, normalized.payload, priorReader);
    }
    return planTaskWrite(normalized, priorReader);
  });
}

async function planTaskWrite(
  task: NormalizedTaskRecord,
  priorReader: PriorAliasReader,
): Promise<EmitPlan> {
  if (!task.id) {
    return {};
  }

  const content = task.content ?? renderTaskContent(task);
  const nextPaths = taskAliasPathsFor(extractTaskAliasState(task.payload, task.id));
  const prior = await priorReader.read<PriorTaskAliasState>(
    asanaTaskByIdAliasPath(task.id),
    extractPriorTaskAliasState,
  );
  const stalePaths = prior ? diffPaths(taskAliasPathsFor({ id: task.id, ...prior }), nextPaths) : [];

  const writes: EmitWrite[] = nextPaths.map((path) => ({
    path,
    content,
    contentType: JSON_CONTENT_TYPE,
  }));
  const deletes: EmitDelete[] = stalePaths.map((path) => ({ path }));
  return { writes, deletes };
}

async function planTaskDelete(
  id: string,
  fallback: unknown,
  priorReader: PriorAliasReader,
): Promise<EmitPlan> {
  const normalizedId = readNonEmptyString(id);
  if (!normalizedId) {
    return {};
  }
  const prior = await priorReader.read<PriorTaskAliasState>(
    asanaTaskByIdAliasPath(normalizedId),
    extractPriorTaskAliasState,
  );
  const current = isRecord(fallback)
    ? extractTaskAliasState(fallback, normalizedId)
    : { id: normalizedId };
  const paths = prior
    ? taskAliasPathsFor({ id: normalizedId, ...prior })
    : taskAliasPathsFor(current);
  return { deletes: paths.map((path) => ({ path })) };
}

interface NormalizedTaskRecord {
  id: string;
  payload: AsanaTask;
  content?: string;
  deleted: boolean;
  connectionId?: string;
}

function normalizeTaskRecord(record: AsanaTaskEmitRecord, connectionId?: string): NormalizedTaskRecord {
  if (isEnvelope(record)) {
    const id = readNonEmptyString(record.objectId) ?? readTaskId(record.payload);
    const normalized: NormalizedTaskRecord = {
      id: id ?? '',
      payload: record.payload,
      deleted: record.deleted === true,
    };
    const content = readNonEmptyString(record.content);
    if (content) normalized.content = content;
    const resolvedConnectionId = readNonEmptyString(record.connectionId) ?? connectionId;
    if (resolvedConnectionId) normalized.connectionId = resolvedConnectionId;
    return normalized;
  }
  const id = readTaskId(record);
  const normalized: NormalizedTaskRecord = {
    id: id ?? '',
    payload: record as AsanaTask,
    deleted: false,
  };
  if (connectionId) normalized.connectionId = connectionId;
  return normalized;
}

interface PriorTaskAliasState {
  state?: string;
  assigneeGid?: string;
  creatorGid?: string;
  priority?: string;
}

function taskAliasPathsFor(args: { id: string } & PriorTaskAliasState): string[] {
  const paths = [asanaTaskByIdAliasPath(args.id)];
  if (args.state) {
    paths.push(asanaTaskByStatePath(args.state, args.id));
  }
  if (args.assigneeGid) {
    paths.push(asanaTaskByAssigneePath(args.assigneeGid, args.id));
  }
  if (args.creatorGid) {
    paths.push(asanaTaskByCreatorPath(args.creatorGid, args.id));
  }
  if (args.priority) {
    paths.push(asanaTaskByPriorityPath(args.priority, args.id));
  }
  return paths;
}

function extractPriorTaskAliasState(parsed: Record<string, unknown>): PriorTaskAliasState | null {
  const payload = pickPayload(parsed);
  if (!payload) return null;
  const id = readTaskId(payload);
  if (!id) return null;
  return stripId(extractTaskAliasState(payload, id));
}

function extractTaskAliasState(payload: unknown, id: string): { id: string } & PriorTaskAliasState {
  const task = isRecord(payload) ? payload : {};
  const state = readTaskState(task);
  const assigneeGid = readUserGid(task.assignee) ?? readNonEmptyString(task.assignee_gid);
  const creatorGid =
    readUserGid(task.created_by) ??
    readUserGid(task.createdBy) ??
    readUserGid(task.creator) ??
    readNonEmptyString(task.created_by_gid) ??
    readNonEmptyString(task.creator_gid);
  const priority = readAsanaPriority(task.custom_fields) ?? readNonEmptyString(task.priority);
  const aliasState: { id: string } & PriorTaskAliasState = { id };
  if (state) aliasState.state = state;
  if (assigneeGid) aliasState.assigneeGid = assigneeGid;
  if (creatorGid) aliasState.creatorGid = creatorGid;
  if (priority) aliasState.priority = priority;
  return aliasState;
}

function readTaskState(task: Record<string, unknown>): string | undefined {
  if (typeof task.completed === 'boolean') {
    return task.completed ? 'completed' : 'open';
  }
  return readNonEmptyString(task.status) ?? readNonEmptyString(task.assignee_status);
}

function readAsanaPriority(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const field of value) {
    if (!isRecord(field)) continue;
    const name = readNonEmptyString(field.name)?.toLowerCase();
    if (name !== 'priority') continue;
    const enumValue = isRecord(field.enum_value) ? field.enum_value : undefined;
    const priority =
      readNonEmptyString(field.display_value) ??
      readNonEmptyString(enumValue?.name) ??
      readNonEmptyString(field.text_value) ??
      readNonEmptyString(field.number_value);
    if (priority) return priority;
  }
  return undefined;
}

function renderTaskContent(task: NormalizedTaskRecord): string {
  return JSON.stringify(
    {
      provider: ASANA_PROVIDER_NAME,
      objectType: 'task',
      objectId: task.id,
      deleted: false,
      payload: task.payload,
      ...(task.connectionId ? { connectionId: task.connectionId } : {}),
    },
    null,
    2,
  );
}

function pickPayload(parsed: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(parsed.payload) ? parsed.payload : parsed;
}

function readTaskId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return readNonEmptyString(value.gid) ?? readNonEmptyString(value.id);
}

function readUserGid(value: unknown): string | undefined {
  return isRecord(value) ? readNonEmptyString(value.gid) ?? readNonEmptyString(value.id) : undefined;
}

function stripId(state: { id: string } & PriorTaskAliasState): PriorTaskAliasState {
  const next: PriorTaskAliasState = {};
  if (state.state) next.state = state.state;
  if (state.assigneeGid) next.assigneeGid = state.assigneeGid;
  if (state.creatorGid) next.creatorGid = state.creatorGid;
  if (state.priority) next.priority = state.priority;
  return next;
}

function diffPaths(prior: readonly string[], next: readonly string[]): string[] {
  const nextSet = new Set(next);
  return prior.filter((path, index) => !nextSet.has(path) && prior.indexOf(path) === index);
}

function isEnvelope(record: AsanaTaskEmitRecord): record is AsanaTaskEmitEnvelope {
  return isRecord(record) && 'payload' in record && isRecord(record.payload);
}

function isDeleteRecord(record: AsanaTaskEmitRecord): record is { gid: string; _deleted: true } {
  return isRecord(record) && record._deleted === true && typeof record.gid === 'string';
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
