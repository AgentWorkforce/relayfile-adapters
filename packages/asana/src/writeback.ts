import { extractAsanaIdFromPathSegment } from './path-mapper.js';
import type { AsanaWritebackRequest, JsonValue } from './types.js';

const ASANA_API_TASKS_ROUTE = '/api/1.0/tasks';
const ASANA_API_PROJECTS_ROUTE = '/api/1.0/projects';
const ASANA_API_SECTIONS_ROUTE = '/api/1.0/sections';

export function resolveAsanaWritebackRequest(path: string, content: string): AsanaWritebackRequest {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === '/asana/tasks/new.json' || normalizedPath === '/asana/tasks/') {
    return buildTaskCreate(content);
  }

  const addToProjectMatch = normalizedPath.match(/^\/asana\/tasks\/([^/]+)\/projects\/([^/]+)\.json$/u);
  if (addToProjectMatch?.[1] && addToProjectMatch[2]) {
    return buildAddTaskToProject(
      extractAsanaIdFromPathSegment(addToProjectMatch[1]),
      extractAsanaIdFromPathSegment(addToProjectMatch[2]),
      content,
    );
  }

  const taskUpdateMatch = normalizedPath.match(/^\/asana\/tasks\/([^/]+)\.json$/u);
  if (taskUpdateMatch?.[1]) {
    return buildTaskUpdate(extractAsanaIdFromPathSegment(taskUpdateMatch[1]), content);
  }

  if (normalizedPath === '/asana/projects/new.json' || normalizedPath === '/asana/projects/') {
    return buildProjectCreate(content);
  }

  const projectUpdateMatch = normalizedPath.match(/^\/asana\/projects\/([^/]+)\.json$/u);
  if (projectUpdateMatch?.[1]) {
    return buildProjectUpdate(extractAsanaIdFromPathSegment(projectUpdateMatch[1]), content);
  }

  const projectSectionCreateMatch = normalizedPath.match(/^\/asana\/projects\/([^/]+)\/sections\/new\.json$/u);
  if (projectSectionCreateMatch?.[1]) {
    return buildSectionCreate(extractAsanaIdFromPathSegment(projectSectionCreateMatch[1]), content);
  }

  if (normalizedPath === '/asana/sections/new.json' || normalizedPath === '/asana/sections/') {
    return buildSectionCreate(undefined, content);
  }

  const sectionUpdateMatch = normalizedPath.match(/^\/asana\/sections\/([^/]+)\.json$/u);
  if (sectionUpdateMatch?.[1]) {
    return buildSectionUpdate(extractAsanaIdFromPathSegment(sectionUpdateMatch[1]), content);
  }

  throw new Error(`No Asana writeback rule matched ${path}`);
}

function buildTaskCreate(content: string): AsanaWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const name = readString(payload, 'name');
  if (!name) {
    throw new Error('tasks/new.json writeback requires a non-empty `name`');
  }

  const data: Record<string, unknown> = { name };
  copyString(payload, data, 'workspace');
  copyString(payload, data, 'assignee');
  copyString(payload, data, 'assignee_status');
  copyString(payload, data, 'notes');
  copyString(payload, data, 'html_notes');
  copyString(payload, data, 'due_on');
  copyString(payload, data, 'due_at');
  copyString(payload, data, 'start_on');
  copyString(payload, data, 'start_at');
  copyBoolean(payload, data, 'completed');
  copyStringArray(payload, data, 'projects');
  copyStringArray(payload, data, 'followers');
  copyStringArray(payload, data, 'tags');
  copyObject(payload, data, 'custom_fields');
  copyString(payload, data, 'parent');

  return {
    action: 'create_task',
    method: 'POST',
    endpoint: ASANA_API_TASKS_ROUTE,
    body: { data },
  };
}

function buildTaskUpdate(taskId: string, content: string): AsanaWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const data = pickAllowed(payload, [
    'actual_time_minutes',
    'assignee',
    'assignee_status',
    'completed',
    'custom_fields',
    'due_at',
    'due_on',
    'followers',
    'html_notes',
    'liked',
    'name',
    'notes',
    'parent',
    'projects',
    'start_at',
    'start_on',
    'tags',
  ]);
  if (Object.keys(data).length === 0) {
    throw new Error('tasks/<id>.json update writeback requires at least one mutable Asana task field');
  }

  return {
    action: 'update_task',
    method: 'PUT',
    endpoint: `${ASANA_API_TASKS_ROUTE}/${encodeURIComponent(taskId)}`,
    body: { data },
  };
}

function buildProjectCreate(content: string): AsanaWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const name = readString(payload, 'name');
  if (!name) {
    throw new Error('projects/new.json writeback requires a non-empty `name`');
  }

  const data: Record<string, unknown> = { name };
  copyString(payload, data, 'workspace');
  copyString(payload, data, 'team');
  copyString(payload, data, 'notes');
  copyString(payload, data, 'color');
  copyString(payload, data, 'default_view');
  copyString(payload, data, 'due_on');
  copyString(payload, data, 'start_on');
  copyBoolean(payload, data, 'public');
  copyBoolean(payload, data, 'archived');
  copyObject(payload, data, 'custom_fields');

  return {
    action: 'create_project',
    method: 'POST',
    endpoint: ASANA_API_PROJECTS_ROUTE,
    body: { data },
  };
}

function buildProjectUpdate(projectId: string, content: string): AsanaWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const data = pickAllowed(payload, [
    'archived',
    'color',
    'completed',
    'custom_fields',
    'default_view',
    'due_date',
    'due_on',
    'name',
    'notes',
    'owner',
    'public',
    'start_on',
    'team',
    'workspace',
  ]);
  if (Object.keys(data).length === 0) {
    throw new Error('projects/<id>.json update writeback requires at least one mutable Asana project field');
  }

  return {
    action: 'update_project',
    method: 'PUT',
    endpoint: `${ASANA_API_PROJECTS_ROUTE}/${encodeURIComponent(projectId)}`,
    body: { data },
  };
}

function buildSectionCreate(projectId: string | undefined, content: string): AsanaWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const name = readString(payload, 'name');
  if (!name) {
    throw new Error('sections/new.json writeback requires a non-empty `name`');
  }

  const explicitProject = readString(payload, 'project');
  const resolvedProjectId = projectId ?? explicitProject;
  if (!resolvedProjectId) {
    throw new Error('sections/new.json writeback requires a project id in the path or `project` field');
  }

  return {
    action: 'create_section',
    method: 'POST',
    endpoint: `${ASANA_API_PROJECTS_ROUTE}/${encodeURIComponent(resolvedProjectId)}/sections`,
    body: { data: { name } },
  };
}

function buildSectionUpdate(sectionId: string, content: string): AsanaWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const name = readString(payload, 'name');
  if (!name) {
    throw new Error('sections/<id>.json update writeback requires a non-empty `name`');
  }

  return {
    action: 'update_section',
    method: 'PUT',
    endpoint: `${ASANA_API_SECTIONS_ROUTE}/${encodeURIComponent(sectionId)}`,
    body: { data: { name } },
  };
}

function buildAddTaskToProject(taskId: string, projectId: string, content: string): AsanaWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObjectOrEmpty(content));
  const data: Record<string, unknown> = { project: projectId };
  copyString(payload, data, 'section');
  copyString(payload, data, 'insert_before');
  copyString(payload, data, 'insert_after');

  return {
    action: 'add_task_to_project',
    method: 'POST',
    endpoint: `${ASANA_API_TASKS_ROUTE}/${encodeURIComponent(taskId)}/addProject`,
    body: { data },
  };
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function parseJsonObjectOrEmpty(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed) return {};
  const parsed = safeParseJson(trimmed);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function safeParseJson(content: string): JsonValue | string {
  try {
    return JSON.parse(content) as JsonValue;
  } catch {
    return content.trim();
  }
}

function unwrapEnvelope(payload: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(payload.payload) && (payload.provider === 'asana' || payload.objectType || payload.workspaceId)) {
    return payload.payload;
  }
  return payload;
}

function pickAllowed(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) {
      output[key] = record[key];
    }
  }
  return output;
}

function copyString(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = readString(source, key);
  if (value) {
    target[key] = value;
  }
}

function copyBoolean(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  if (typeof source[key] === 'boolean') {
    target[key] = source[key];
  }
}

function copyStringArray(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = source[key];
  if (!Array.isArray(value)) return;
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  if (strings.length > 0) {
    target[key] = strings;
  }
}

function copyObject(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  if (isRecord(source[key])) {
    target[key] = source[key];
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
