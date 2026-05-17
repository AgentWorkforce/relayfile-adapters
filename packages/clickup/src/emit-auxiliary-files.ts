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
  clickUpTaskByAssigneePath,
  clickUpTaskByCreatorPath,
  clickUpTaskByIdAliasPath,
  clickUpTaskByPriorityPath,
  clickUpTaskByStatePath,
} from './path-mapper.js';
import type { ClickUpTask } from './types.js';

const CLICKUP_PROVIDER_NAME = 'clickup';
const JSON_CONTENT_TYPE = EMIT_AUXILIARY_JSON_CONTENT_TYPE;

export type ClickUpTaskEmitRecord =
  | ClickUpTask
  | ClickUpTaskEmitEnvelope
  | { id: string; _deleted: true };

export interface ClickUpTaskEmitEnvelope {
  objectId?: string;
  payload: ClickUpTask;
  content?: string;
  deleted?: boolean;
  connectionId?: string;
}

export interface ClickUpEmitAuxiliaryFilesInput {
  workspaceId: string;
  tasks?: readonly ClickUpTaskEmitRecord[];
  connectionId?: string;
}

export async function emitClickUpAuxiliaryFiles(
  client: AuxiliaryEmitterClient,
  input: ClickUpEmitAuxiliaryFilesInput,
): Promise<EmitAuxiliaryFilesResult> {
  const tasks = input.tasks ?? [];
  if (tasks.length === 0) {
    return { written: 0, deleted: 0, errors: [] };
  }

  const priorReader = new PriorAliasReader(client, input.workspaceId);
  return runEmitBatch(client, input.workspaceId, tasks, async (record) => {
    if (isDeleteRecord(record)) {
      return planTaskDelete(record.id, record, priorReader);
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
    clickUpTaskByIdAliasPath(task.id),
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
    clickUpTaskByIdAliasPath(normalizedId),
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
  payload: ClickUpTask;
  content?: string;
  deleted: boolean;
  connectionId?: string;
}

function normalizeTaskRecord(record: ClickUpTaskEmitRecord, connectionId?: string): NormalizedTaskRecord {
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
    payload: record as ClickUpTask,
    deleted: false,
  };
  if (connectionId) normalized.connectionId = connectionId;
  return normalized;
}

interface PriorTaskAliasState {
  state?: string;
  assigneeIds?: readonly string[];
  creatorId?: string;
  priority?: string;
}

function taskAliasPathsFor(args: { id: string } & PriorTaskAliasState): string[] {
  const paths = [clickUpTaskByIdAliasPath(args.id)];
  if (args.state) {
    paths.push(clickUpTaskByStatePath(args.state, args.id));
  }
  for (const assigneeId of args.assigneeIds ?? []) {
    paths.push(clickUpTaskByAssigneePath(assigneeId, args.id));
  }
  if (args.creatorId) {
    paths.push(clickUpTaskByCreatorPath(args.creatorId, args.id));
  }
  if (args.priority) {
    paths.push(clickUpTaskByPriorityPath(args.priority, args.id));
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
  const state = readStatus(task.status);
  const assigneeIds = readUsers(task.assignees);
  const creatorId = readUserId(task.creator) ?? readNonEmptyString(task.creator_id);
  const priority = readPriority(task.priority);
  const aliasState: { id: string } & PriorTaskAliasState = { id };
  if (state) aliasState.state = state;
  if (assigneeIds.length > 0) aliasState.assigneeIds = assigneeIds;
  if (creatorId) aliasState.creatorId = creatorId;
  if (priority) aliasState.priority = priority;
  return aliasState;
}

function readStatus(value: unknown): string | undefined {
  if (isRecord(value)) {
    return readNonEmptyString(value.status) ?? readNonEmptyString(value.name) ?? readNonEmptyString(value.type);
  }
  return readNonEmptyString(value);
}

function readPriority(value: unknown): string | undefined {
  if (isRecord(value)) {
    return readNonEmptyString(value.priority) ?? readNonEmptyString(value.name);
  }
  return readNonEmptyString(value);
}

function readUsers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const item of value) {
    const id = readUserId(item);
    if (id) ids.add(id);
  }
  return [...ids];
}

function renderTaskContent(task: NormalizedTaskRecord): string {
  return JSON.stringify(
    {
      provider: CLICKUP_PROVIDER_NAME,
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
  return readNonEmptyString(value.id);
}

function readUserId(value: unknown): string | undefined {
  return isRecord(value) ? readNonEmptyString(value.id) ?? readNonEmptyString(value.username) : undefined;
}

function stripId(state: { id: string } & PriorTaskAliasState): PriorTaskAliasState {
  const next: PriorTaskAliasState = {};
  if (state.state) next.state = state.state;
  if (state.assigneeIds && state.assigneeIds.length > 0) next.assigneeIds = state.assigneeIds;
  if (state.creatorId) next.creatorId = state.creatorId;
  if (state.priority) next.priority = state.priority;
  return next;
}

function diffPaths(prior: readonly string[], next: readonly string[]): string[] {
  const nextSet = new Set(next);
  return prior.filter((path, index) => !nextSet.has(path) && prior.indexOf(path) === index);
}

function isEnvelope(record: ClickUpTaskEmitRecord): record is ClickUpTaskEmitEnvelope {
  return isRecord(record) && 'payload' in record && isRecord(record.payload);
}

function isDeleteRecord(record: ClickUpTaskEmitRecord): record is { id: string; _deleted: true } {
  return isRecord(record) && record._deleted === true && typeof record.id === 'string';
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
