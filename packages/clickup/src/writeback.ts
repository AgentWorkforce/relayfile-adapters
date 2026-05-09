import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import { extractClickUpIdFromPathSegment } from './path-mapper.js';
import { resources } from './resources.js';
import type { ClickUpWritebackRequest } from './types.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

export const CLICKUP_TASK_ROUTE_ANCHOR = '/api/v2/task';
export const CLICKUP_LIST_ROUTE_ANCHOR = '/api/v2/list';

export function resolveWritebackRequest(path: string, content: string): ClickUpWritebackRequest {
  const normalizedPath = normalizePath(path);
  const route = classifyWrite(normalizedPath, resources);

  if (route?.resource.path === '/clickup/tasks/{taskId}/comments' && route.kind === 'create') {
    const taskCommentMatch = normalizedPath.match(/^\/clickup\/tasks\/([^/]+)\/comments\/([^/]+)\.json$/u);
    if (taskCommentMatch?.[1]) {
      return buildTaskComment(extractClickUpIdFromPathSegment(taskCommentMatch[1]), content);
    }
  }

  if (route?.resource.path === '/clickup/lists/{listId}/tasks' && route.kind === 'create') {
    const newTaskMatch = normalizedPath.match(/^\/clickup\/lists\/([^/]+)\/tasks\/([^/]+)\.json$/u);
    if (newTaskMatch?.[1]) {
      return buildTaskCreate(extractClickUpIdFromPathSegment(newTaskMatch[1]), content);
    }
  }

  if (route?.resource.path === '/clickup/folders/{folderId}/lists' && route.kind === 'create') {
    const newListMatch = normalizedPath.match(/^\/clickup\/folders\/([^/]+)\/lists\/([^/]+)\.json$/u);
    if (newListMatch?.[1]) {
      return buildListCreate(extractClickUpIdFromPathSegment(newListMatch[1]), content);
    }
  }

  if (route?.resource.path === '/clickup/spaces/{spaceId}/lists' && route.kind === 'create') {
    const folderlessListMatch = normalizedPath.match(/^\/clickup\/spaces\/([^/]+)\/lists\/([^/]+)\.json$/u);
    if (folderlessListMatch?.[1]) {
      return buildFolderlessListCreate(extractClickUpIdFromPathSegment(folderlessListMatch[1]), content);
    }
  }

  if (route?.resource.path === '/clickup/spaces/{spaceId}/folders' && route.kind === 'create') {
    const newFolderMatch = normalizedPath.match(/^\/clickup\/spaces\/([^/]+)\/folders\/([^/]+)\.json$/u);
    if (newFolderMatch?.[1]) {
      return buildFolderCreate(extractClickUpIdFromPathSegment(newFolderMatch[1]), content);
    }
  }

  // Top-level update endpoints: not declared as resources, so we keep ad-hoc routing.
  const taskUpdateMatch = normalizedPath.match(/^\/clickup\/tasks\/([^/]+)\.json$/u);
  if (taskUpdateMatch?.[1]) {
    return buildTaskUpdate(extractClickUpIdFromPathSegment(taskUpdateMatch[1]), content);
  }

  const listUpdateMatch = normalizedPath.match(/^\/clickup\/lists\/([^/]+)\.json$/u);
  if (listUpdateMatch?.[1]) {
    return buildListUpdate(extractClickUpIdFromPathSegment(listUpdateMatch[1]), content);
  }

  const folderUpdateMatch = normalizedPath.match(/^\/clickup\/folders\/([^/]+)\.json$/u);
  if (folderUpdateMatch?.[1]) {
    return buildFolderUpdate(extractClickUpIdFromPathSegment(folderUpdateMatch[1]), content);
  }

  const spaceUpdateMatch = normalizedPath.match(/^\/clickup\/spaces\/([^/]+)\.json$/u);
  if (spaceUpdateMatch?.[1]) {
    return buildSpaceUpdate(extractClickUpIdFromPathSegment(spaceUpdateMatch[1]), content);
  }

  throw new Error(`No ClickUp writeback rule matched ${path}`);
}

export function resolveDeleteRequest(path: string): ClickUpWritebackRequest {
  const normalizedPath = normalizePath(path);
  // Top-level tasks/lists/folders are not declared as resources, so we
  // approximate canonical detection with the same id pattern used by their
  // parent collections (alphanumeric + underscores, optional slug prefix).
  const taskMatch = normalizedPath.match(/^\/clickup\/tasks\/([^/]+)\.json$/u);
  if (taskMatch?.[1] && isCanonicalTopLevelFile(taskMatch[1])) {
    return {
      action: 'delete_task',
      method: 'DELETE',
      endpoint: `${CLICKUP_TASK_ROUTE_ANCHOR}/${extractClickUpIdFromPathSegment(taskMatch[1])}`,
    };
  }

  const listMatch = normalizedPath.match(/^\/clickup\/lists\/([^/]+)\.json$/u);
  if (listMatch?.[1] && isCanonicalTopLevelFile(listMatch[1])) {
    return {
      action: 'delete_list',
      method: 'DELETE',
      endpoint: `${CLICKUP_LIST_ROUTE_ANCHOR}/${extractClickUpIdFromPathSegment(listMatch[1])}`,
    };
  }

  const folderMatch = normalizedPath.match(/^\/clickup\/folders\/([^/]+)\.json$/u);
  if (folderMatch?.[1] && isCanonicalTopLevelFile(folderMatch[1])) {
    return {
      action: 'delete_folder',
      method: 'DELETE',
      endpoint: `/api/v2/folder/${extractClickUpIdFromPathSegment(folderMatch[1])}`,
    };
  }

  throw new Error(`No ClickUp delete writeback rule matched ${path}`);
}

function buildTaskComment(taskId: string, content: string): ClickUpWritebackRequest {
  const parsed = safeParseJson(content);
  const body = typeof parsed === 'string' ? parsed.trim() : readString(parseRecord(parsed), 'comment_text');
  if (!body) {
    throw new Error('task comment writeback requires a non-empty comment_text or plain string body');
  }

  return {
    action: 'task_comment',
    method: 'POST',
    endpoint: `${CLICKUP_TASK_ROUTE_ANCHOR}/${taskId}/comment`,
    body: { comment_text: body },
  };
}

function buildTaskCreate(listId: string, content: string): ClickUpWritebackRequest {
  const payload = parseJsonObject(content);
  rejectReadOnlyFields(payload);
  const name = readString(payload, 'name');
  if (!name) {
    throw new Error('tasks/<draft>.json writeback requires a `name`');
  }

  return {
    action: 'create_task',
    method: 'POST',
    endpoint: `${CLICKUP_LIST_ROUTE_ANCHOR}/${listId}/task`,
    body: pickAllowed(payload, TASK_CREATE_ALLOWLIST, { name }),
  };
}

function buildTaskUpdate(taskId: string, content: string): ClickUpWritebackRequest {
  const payload = unwrapSyncedEnvelope(parseJsonObject(content));
  rejectReadOnlyFields(payload);
  const body = pickAllowed(payload, TASK_UPDATE_ALLOWLIST);
  if (Object.keys(body).length === 0) {
    throw new Error('task update writeback has no editable ClickUp fields');
  }

  return {
    action: 'update_task',
    method: 'PUT',
    endpoint: `${CLICKUP_TASK_ROUTE_ANCHOR}/${taskId}`,
    body,
  };
}

function buildListCreate(folderId: string, content: string): ClickUpWritebackRequest {
  const payload = parseJsonObject(content);
  rejectReadOnlyFields(payload);
  const name = readString(payload, 'name');
  if (!name) {
    throw new Error('lists/<draft>.json writeback requires a `name`');
  }

  return {
    action: 'create_list',
    method: 'POST',
    endpoint: `/api/v2/folder/${folderId}/list`,
    body: pickAllowed(payload, LIST_CREATE_ALLOWLIST, { name }),
  };
}

function buildFolderlessListCreate(spaceId: string, content: string): ClickUpWritebackRequest {
  const payload = parseJsonObject(content);
  rejectReadOnlyFields(payload);
  const name = readString(payload, 'name');
  if (!name) {
    throw new Error('lists/<draft>.json writeback requires a `name`');
  }

  return {
    action: 'create_list',
    method: 'POST',
    endpoint: `/api/v2/space/${spaceId}/list`,
    body: pickAllowed(payload, LIST_CREATE_ALLOWLIST, { name }),
  };
}

function buildListUpdate(listId: string, content: string): ClickUpWritebackRequest {
  const payload = unwrapSyncedEnvelope(parseJsonObject(content));
  rejectReadOnlyFields(payload);
  const body = pickAllowed(payload, LIST_UPDATE_ALLOWLIST);
  if (Object.keys(body).length === 0) {
    throw new Error('list update writeback has no editable ClickUp fields');
  }

  return {
    action: 'update_list',
    method: 'PUT',
    endpoint: `${CLICKUP_LIST_ROUTE_ANCHOR}/${listId}`,
    body,
  };
}

function buildFolderCreate(spaceId: string, content: string): ClickUpWritebackRequest {
  const payload = parseJsonObject(content);
  rejectReadOnlyFields(payload);
  const name = readString(payload, 'name');
  if (!name) {
    throw new Error('folders/<draft>.json writeback requires a `name`');
  }

  return {
    action: 'create_folder',
    method: 'POST',
    endpoint: `/api/v2/space/${spaceId}/folder`,
    body: pickAllowed(payload, FOLDER_CREATE_ALLOWLIST, { name }),
  };
}

function buildFolderUpdate(folderId: string, content: string): ClickUpWritebackRequest {
  const payload = unwrapSyncedEnvelope(parseJsonObject(content));
  rejectReadOnlyFields(payload);
  const body = pickAllowed(payload, FOLDER_UPDATE_ALLOWLIST);
  if (Object.keys(body).length === 0) {
    throw new Error('folder update writeback has no editable ClickUp fields');
  }

  return {
    action: 'update_folder',
    method: 'PUT',
    endpoint: `/api/v2/folder/${folderId}`,
    body,
  };
}

function buildSpaceUpdate(spaceId: string, content: string): ClickUpWritebackRequest {
  const payload = unwrapSyncedEnvelope(parseJsonObject(content));
  rejectReadOnlyFields(payload);
  const body = pickAllowed(payload, SPACE_UPDATE_ALLOWLIST);
  if (Object.keys(body).length === 0) {
    throw new Error('space update writeback has no editable ClickUp fields');
  }

  return {
    action: 'update_space',
    method: 'PUT',
    endpoint: `/api/v2/space/${spaceId}`,
    body,
  };
}

const TASK_CREATE_ALLOWLIST: ReadonlySet<string> = new Set([
  'assignees',
  'check_required_custom_fields',
  'custom_fields',
  'custom_item_id',
  'description',
  'due_date',
  'due_date_time',
  'links_to',
  'markdown_description',
  'multiple_assignees',
  'name',
  'notify_all',
  'parent',
  'points',
  'priority',
  'start_date',
  'start_date_time',
  'status',
  'tags',
  'time_estimate',
]);

const TASK_UPDATE_ALLOWLIST: ReadonlySet<string> = new Set([
  'add_assignees',
  'archived',
  'assignees',
  'custom_fields',
  'description',
  'due_date',
  'due_date_time',
  'markdown_description',
  'name',
  'parent',
  'points',
  'priority',
  'remove_assignees',
  'start_date',
  'start_date_time',
  'status',
  'tags',
  'time_estimate',
]);

const LIST_CREATE_ALLOWLIST: ReadonlySet<string> = new Set([
  'assignee',
  'content',
  'due_date',
  'name',
  'priority',
  'status',
]);

const LIST_UPDATE_ALLOWLIST: ReadonlySet<string> = new Set([
  'archived',
  'assignee',
  'content',
  'due_date',
  'name',
  'priority',
  'status',
  'unset_status',
]);

const FOLDER_CREATE_ALLOWLIST: ReadonlySet<string> = new Set(['name']);
const FOLDER_UPDATE_ALLOWLIST: ReadonlySet<string> = new Set(['name']);
const SPACE_UPDATE_ALLOWLIST: ReadonlySet<string> = new Set(['color', 'features', 'name', 'private']);
// Same shape as the declared resource idPattern: bare alphanumeric (with `_`)
// or `<slug>--<id>` prefix. Used to distinguish canonical top-level files
// (which support delete + update) from drafts.
const TOP_LEVEL_ID_PATTERN = /^(?:[A-Za-z0-9_.~-]+--)?[A-Za-z0-9_]+$/;
const READ_ONLY_FIELDS = new Set([
  'id',
  'custom_id',
  'date_created',
  'date_updated',
  'date_closed',
  'date_done',
  'url',
  'creator',
  'provider',
  'objectType',
  'objectId',
  'workspaceId',
  'connectionId',
  '_webhook',
  '_connection',
]);

const ENVELOPE_MARKER_KEYS = ['provider', 'objectType', 'objectId', 'workspaceId'] as const;

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('ClickUp writeback path must be a non-empty string');
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isCanonicalTopLevelFile(segment: string): boolean {
  return TOP_LEVEL_ID_PATTERN.test(segment);
}

function unwrapSyncedEnvelope(payload: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(payload.payload)) {
    return payload;
  }
  return ENVELOPE_MARKER_KEYS.some((key) => key in payload) ? payload.payload : payload;
}

function pickAllowed(
  payload: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: Record<string, unknown> = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...required };
  for (const [key, value] of Object.entries(payload)) {
    if (allowed.has(key) && value !== undefined) {
      body[key] = value;
    }
  }
  return body;
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  return parseRecord(parsed);
}

function rejectReadOnlyFields(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
  }
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('ClickUp writeback content must be a JSON object');
  }
  return value;
}

function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
