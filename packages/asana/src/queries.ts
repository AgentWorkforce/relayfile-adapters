import { extractAsanaIdFromPathSegment } from './path-mapper.js';
import type { AsanaRestRequest } from './types.js';

export const ASANA_API_TASKS_ROUTE = '/api/1.0/tasks';
export const ASANA_API_PROJECTS_ROUTE = '/api/1.0/projects';
export const ASANA_API_SECTIONS_ROUTE = '/api/1.0/sections';
export const ASANA_API_WORKSPACES_ROUTE = '/api/1.0/workspaces';

export const ASANA_TASK_OPT_FIELDS = [
  'actual_time_minutes',
  'assignee.gid',
  'assignee.name',
  'assignee.email',
  'assignee_status',
  'completed',
  'completed_at',
  'created_at',
  'custom_fields.gid',
  'custom_fields.name',
  'custom_fields.display_value',
  'due_at',
  'due_on',
  'followers.gid',
  'followers.name',
  'html_notes',
  'html_url',
  'memberships.project.gid',
  'memberships.project.name',
  'memberships.section.gid',
  'memberships.section.name',
  'modified_at',
  'name',
  'notes',
  'parent.gid',
  'parent.name',
  'permalink_url',
  'projects.gid',
  'projects.name',
  'resource_subtype',
  'resource_type',
  'start_at',
  'start_on',
  'tags.gid',
  'tags.name',
  'workspace.gid',
  'workspace.name',
] as const;

export const ASANA_PROJECT_OPT_FIELDS = [
  'archived',
  'color',
  'completed',
  'completed_at',
  'created_at',
  'current_status.color',
  'current_status.text',
  'current_status.title',
  'default_view',
  'due_date',
  'due_on',
  'html_url',
  'modified_at',
  'name',
  'notes',
  'owner.gid',
  'owner.name',
  'permalink_url',
  'public',
  'resource_type',
  'start_on',
  'team.gid',
  'team.name',
  'workspace.gid',
  'workspace.name',
] as const;

export const ASANA_SECTION_OPT_FIELDS = [
  'created_at',
  'name',
  'project.gid',
  'project.name',
  'projects.gid',
  'projects.name',
  'resource_type',
] as const;

export const ASANA_WORKSPACE_OPT_FIELDS = [
  'email_domains',
  'is_organization',
  'name',
  'resource_type',
] as const;

export function resolveAsanaReadRequest(path: string): AsanaRestRequest {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === '/asana/tasks' || normalizedPath === '/asana/tasks/') {
    return {
      method: 'GET',
      endpoint: ASANA_API_TASKS_ROUTE,
      query: {
        limit: '100',
        opt_fields: ASANA_TASK_OPT_FIELDS.join(','),
      },
    };
  }

  const taskMatch = normalizedPath.match(/^\/asana\/tasks\/([^/]+)\.json$/u);
  if (taskMatch?.[1]) {
    const taskId = extractAsanaIdFromPathSegment(taskMatch[1]);
    return {
      method: 'GET',
      endpoint: `${ASANA_API_TASKS_ROUTE}/${encodeURIComponent(taskId)}`,
      query: {
        opt_fields: ASANA_TASK_OPT_FIELDS.join(','),
      },
    };
  }

  if (normalizedPath === '/asana/projects' || normalizedPath === '/asana/projects/') {
    return {
      method: 'GET',
      endpoint: ASANA_API_PROJECTS_ROUTE,
      query: {
        limit: '100',
        opt_fields: ASANA_PROJECT_OPT_FIELDS.join(','),
      },
    };
  }

  const projectTasksMatch = normalizedPath.match(/^\/asana\/projects\/([^/]+)\/tasks\/?$/u);
  if (projectTasksMatch?.[1]) {
    const projectId = extractAsanaIdFromPathSegment(projectTasksMatch[1]);
    return {
      method: 'GET',
      endpoint: `${ASANA_API_PROJECTS_ROUTE}/${encodeURIComponent(projectId)}/tasks`,
      query: {
        limit: '100',
        opt_fields: ASANA_TASK_OPT_FIELDS.join(','),
      },
    };
  }

  const projectSectionsMatch = normalizedPath.match(/^\/asana\/projects\/([^/]+)\/sections\/?$/u);
  if (projectSectionsMatch?.[1]) {
    const projectId = extractAsanaIdFromPathSegment(projectSectionsMatch[1]);
    return {
      method: 'GET',
      endpoint: `${ASANA_API_PROJECTS_ROUTE}/${encodeURIComponent(projectId)}/sections`,
      query: {
        limit: '100',
        opt_fields: ASANA_SECTION_OPT_FIELDS.join(','),
      },
    };
  }

  const projectMatch = normalizedPath.match(/^\/asana\/projects\/([^/]+)\.json$/u);
  if (projectMatch?.[1]) {
    const projectId = extractAsanaIdFromPathSegment(projectMatch[1]);
    return {
      method: 'GET',
      endpoint: `${ASANA_API_PROJECTS_ROUTE}/${encodeURIComponent(projectId)}`,
      query: {
        opt_fields: ASANA_PROJECT_OPT_FIELDS.join(','),
      },
    };
  }

  if (normalizedPath === '/asana/sections' || normalizedPath === '/asana/sections/') {
    return {
      method: 'GET',
      endpoint: ASANA_API_SECTIONS_ROUTE,
      query: {
        limit: '100',
        opt_fields: ASANA_SECTION_OPT_FIELDS.join(','),
      },
    };
  }

  const sectionTasksMatch = normalizedPath.match(/^\/asana\/sections\/([^/]+)\/tasks\/?$/u);
  if (sectionTasksMatch?.[1]) {
    const sectionId = extractAsanaIdFromPathSegment(sectionTasksMatch[1]);
    return {
      method: 'GET',
      endpoint: `${ASANA_API_SECTIONS_ROUTE}/${encodeURIComponent(sectionId)}/tasks`,
      query: {
        limit: '100',
        opt_fields: ASANA_TASK_OPT_FIELDS.join(','),
      },
    };
  }

  const sectionMatch = normalizedPath.match(/^\/asana\/sections\/([^/]+)\.json$/u);
  if (sectionMatch?.[1]) {
    const sectionId = extractAsanaIdFromPathSegment(sectionMatch[1]);
    return {
      method: 'GET',
      endpoint: `${ASANA_API_SECTIONS_ROUTE}/${encodeURIComponent(sectionId)}`,
      query: {
        opt_fields: ASANA_SECTION_OPT_FIELDS.join(','),
      },
    };
  }

  if (normalizedPath === '/asana/workspaces' || normalizedPath === '/asana/workspaces/') {
    return {
      method: 'GET',
      endpoint: ASANA_API_WORKSPACES_ROUTE,
      query: {
        limit: '100',
        opt_fields: ASANA_WORKSPACE_OPT_FIELDS.join(','),
      },
    };
  }

  const workspaceProjectsMatch = normalizedPath.match(/^\/asana\/workspaces\/([^/]+)\/projects\/?$/u);
  if (workspaceProjectsMatch?.[1]) {
    const workspaceId = extractAsanaIdFromPathSegment(workspaceProjectsMatch[1]);
    return {
      method: 'GET',
      endpoint: `${ASANA_API_WORKSPACES_ROUTE}/${encodeURIComponent(workspaceId)}/projects`,
      query: {
        limit: '100',
        opt_fields: ASANA_PROJECT_OPT_FIELDS.join(','),
      },
    };
  }

  const workspaceTasksMatch = normalizedPath.match(/^\/asana\/workspaces\/([^/]+)\/tasks\/?$/u);
  if (workspaceTasksMatch?.[1]) {
    const workspaceId = extractAsanaIdFromPathSegment(workspaceTasksMatch[1]);
    return {
      method: 'GET',
      endpoint: `${ASANA_API_WORKSPACES_ROUTE}/${encodeURIComponent(workspaceId)}/tasks/search`,
      query: {
        limit: '100',
        opt_fields: ASANA_TASK_OPT_FIELDS.join(','),
      },
    };
  }

  const workspaceMatch = normalizedPath.match(/^\/asana\/workspaces\/([^/]+)\.json$/u);
  if (workspaceMatch?.[1]) {
    const workspaceId = extractAsanaIdFromPathSegment(workspaceMatch[1]);
    return {
      method: 'GET',
      endpoint: `${ASANA_API_WORKSPACES_ROUTE}/${encodeURIComponent(workspaceId)}`,
      query: {
        opt_fields: ASANA_WORKSPACE_OPT_FIELDS.join(','),
      },
    };
  }

  throw new Error(`No Asana read route matched ${path}`);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed;
}
