import { extractClickUpIdFromPathSegment } from './path-mapper.js';

export const CLICKUP_API_BASE_PATH = '/api/v2';
export const CLICKUP_TASK_ROUTE_ANCHOR = '/api/v2/task';
export const CLICKUP_LIST_ROUTE_ANCHOR = '/api/v2/list';

export interface ClickUpReadRequest {
  action:
    | 'get_folder'
    | 'get_list'
    | 'get_space'
    | 'get_task'
    | 'list_folderless_lists'
    | 'list_folder_lists'
    | 'list_tasks';
  method: 'GET';
  endpoint: string;
  query?: Record<string, string>;
}

export function resolveReadRequest(path: string): ClickUpReadRequest {
  const normalizedPath = normalizePath(path);

  const taskMatch = normalizedPath.match(/^\/clickup\/tasks\/([^/]+)\.json$/u);
  if (taskMatch?.[1]) {
    const taskId = encodeURIComponent(extractClickUpIdFromPathSegment(taskMatch[1]));
    return {
      action: 'get_task',
      method: 'GET',
      endpoint: `${CLICKUP_TASK_ROUTE_ANCHOR}/${taskId}`,
    };
  }

  const taskListMatch = normalizedPath.match(/^\/clickup\/lists\/([^/]+)\/tasks\.json$/u);
  if (taskListMatch?.[1]) {
    const listId = encodeURIComponent(extractClickUpIdFromPathSegment(taskListMatch[1]));
    return {
      action: 'list_tasks',
      method: 'GET',
      endpoint: `${CLICKUP_LIST_ROUTE_ANCHOR}/${listId}/task`,
      query: {
        include_closed: 'true',
        subtasks: 'true',
      },
    };
  }

  const listMatch = normalizedPath.match(/^\/clickup\/lists\/([^/]+)\.json$/u);
  if (listMatch?.[1]) {
    const listId = encodeURIComponent(extractClickUpIdFromPathSegment(listMatch[1]));
    return {
      action: 'get_list',
      method: 'GET',
      endpoint: `${CLICKUP_LIST_ROUTE_ANCHOR}/${listId}`,
    };
  }

  const folderListsMatch = normalizedPath.match(/^\/clickup\/folders\/([^/]+)\/lists\.json$/u);
  if (folderListsMatch?.[1]) {
    const folderId = encodeURIComponent(extractClickUpIdFromPathSegment(folderListsMatch[1]));
    return {
      action: 'list_folder_lists',
      method: 'GET',
      endpoint: `/api/v2/folder/${folderId}/list`,
    };
  }

  const folderMatch = normalizedPath.match(/^\/clickup\/folders\/([^/]+)\.json$/u);
  if (folderMatch?.[1]) {
    const folderId = encodeURIComponent(extractClickUpIdFromPathSegment(folderMatch[1]));
    return {
      action: 'get_folder',
      method: 'GET',
      endpoint: `/api/v2/folder/${folderId}`,
    };
  }

  const folderlessListsMatch = normalizedPath.match(/^\/clickup\/spaces\/([^/]+)\/lists\.json$/u);
  if (folderlessListsMatch?.[1]) {
    const spaceId = encodeURIComponent(extractClickUpIdFromPathSegment(folderlessListsMatch[1]));
    return {
      action: 'list_folderless_lists',
      method: 'GET',
      endpoint: `/api/v2/space/${spaceId}/list`,
    };
  }

  const spaceMatch = normalizedPath.match(/^\/clickup\/spaces\/([^/]+)\.json$/u);
  if (spaceMatch?.[1]) {
    const spaceId = encodeURIComponent(extractClickUpIdFromPathSegment(spaceMatch[1]));
    return {
      action: 'get_space',
      method: 'GET',
      endpoint: `/api/v2/space/${spaceId}`,
    };
  }

  throw new Error(`No ClickUp read rule matched ${path}`);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('ClickUp read path must be a non-empty string');
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
