import { withProxyRetry } from '@relayfile/adapter-core/http';
import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import type { ConnectionProvider, WritebackPathTarget, WritebackResult } from './types.js';
import { parseGitLabPath } from './path-mapper.js';
import { resources } from './resources.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

export interface GitLabWritebackRequest {
  action: 'delete_issue_note' | 'delete_merge_request_discussion';
  method: 'DELETE';
  endpoint: string;
  body?: Record<string, unknown>;
}

export class GitLabWritebackHandler {
  constructor(
    private readonly provider: ConnectionProvider,
    private readonly options: { baseUrl?: string; connectionId?: string } = {},
  ) {}

  extractWritebackTarget(path: string): WritebackPathTarget {
    const parsed = parseGitLabPath(path);
    if (!parsed) {
      throw new Error(`Unsupported GitLab writeback path: ${path}`);
    }

    const route = classifyWrite(path, resources);
    const isMetadataPath = parsed.subResource === 'meta.json' || parsed.subResource === 'metadata.json' || parsed.subResource === undefined;

    if (parsed.objectType === 'merge_requests' && isMetadataPath) {
      return {
        entity: 'merge_request',
        projectPath: parsed.projectPath,
        resourceId: parsed.objectId,
      };
    }

    if (
      route?.resource.name === 'discussions' &&
      parsed.objectType === 'merge_requests' &&
      parsed.subResource === 'discussions' &&
      parsed.subResourceId &&
      route.kind === 'create'
    ) {
      return {
        entity: 'merge_request_discussion',
        projectPath: parsed.projectPath,
        resourceId: parsed.objectId,
      };
    }

    if (parsed.objectType === 'issues' && isMetadataPath) {
      return {
        entity: 'issue',
        projectPath: parsed.projectPath,
        resourceId: parsed.objectId,
      };
    }

    if (
      route?.resource.name === 'comments' &&
      parsed.objectType === 'issues' &&
      parsed.subResource === 'comments' &&
      parsed.subResourceId &&
      route.kind === 'create'
    ) {
      return {
        entity: 'issue_note',
        projectPath: parsed.projectPath,
        resourceId: parsed.objectId,
      };
    }

    throw new Error(`Unsupported GitLab writeback path: ${path}`);
  }

  resolveDeleteRequest(path: string): GitLabWritebackRequest {
    return resolveDeleteRequest(path);
  }

  async writeBack(workspaceId: string, path: string, content: string): Promise<WritebackResult> {
    try {
      const target = this.extractWritebackTarget(path);
      const body = readWritablePayload(content);
      const projectId = encodeURIComponent(target.projectPath);

      let endpoint = '';
      let method: 'POST' | 'PUT' = 'PUT';

      switch (target.entity) {
        case 'merge_request':
          endpoint = `/api/v4/projects/${projectId}/merge_requests/${target.resourceId}`;
          method = 'PUT';
          break;
        case 'merge_request_discussion':
          requireString(body, 'body', 'merge request discussion');
          endpoint = `/api/v4/projects/${projectId}/merge_requests/${target.resourceId}/discussions`;
          method = 'POST';
          break;
        case 'issue':
          endpoint = `/api/v4/projects/${projectId}/issues/${target.resourceId}`;
          method = 'PUT';
          break;
        case 'issue_note':
          requireString(body, 'body', 'issue note');
          endpoint = `/api/v4/projects/${projectId}/issues/${target.resourceId}/notes`;
          method = 'POST';
          break;
      }

      const response = await withProxyRetry(this.provider).proxy({
        method,
        baseUrl: this.options.baseUrl ?? 'https://gitlab.com',
        endpoint,
        connectionId: this.options.connectionId ?? workspaceId,
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (response.status >= 400) {
        return {
          success: false,
          error: `${method} ${endpoint} failed with ${response.status}`,
        };
      }

      const result = response.data as { id?: number | string; iid?: number | string } | null;
      return {
        success: true,
        externalId: result?.id ? String(result.id) : result?.iid ? String(result.iid) : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function resolveDeleteRequest(path: string): GitLabWritebackRequest {
  const parsed = parseGitLabPath(path);
  if (!parsed) {
    throw new Error(`Unsupported GitLab delete writeback path: ${path}`);
  }
  const route = classifyWrite(path, resources, { fsEvent: 'delete' });
  const projectId = encodeURIComponent(parsed.projectPath);

  if (
    route?.resource.name === 'discussions' &&
    route.kind === 'delete' &&
    parsed.objectType === 'merge_requests' &&
    parsed.subResource === 'discussions' &&
    parsed.subResourceId
  ) {
    return {
      action: 'delete_merge_request_discussion',
      method: 'DELETE',
      endpoint: `/api/v4/projects/${projectId}/merge_requests/${parsed.objectId}/discussions/${encodeURIComponent(parsed.subResourceId)}`,
    };
  }

  if (
    route?.resource.name === 'comments' &&
    route.kind === 'delete' &&
    parsed.objectType === 'issues' &&
    parsed.subResource === 'comments' &&
    parsed.subResourceId
  ) {
    return {
      action: 'delete_issue_note',
      method: 'DELETE',
      endpoint: `/api/v4/projects/${projectId}/issues/${parsed.objectId}/notes/${encodeURIComponent(parsed.subResourceId)}`,
    };
  }

  throw new Error(`Unsupported GitLab delete writeback path: ${path}`);
}

const READ_ONLY_FIELDS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'url',
  'identifier',
  'provider',
  'objectType',
  'objectId',
  'workspaceId',
  'connectionId',
  '_webhook',
  '_connection',
]);

function readWritablePayload(content: string): Record<string, unknown> {
  const payload = JSON.parse(content) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('GitLab writeback payload must be a JSON object');
  }
  const record = payload as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
  }
  return record;
}

function requireString(payload: Record<string, unknown>, key: string, label: string): void {
  if (typeof payload[key] !== 'string' || payload[key].trim() === '') {
    throw new Error(`GitLab ${label} create writeback requires \`${key}\``);
  }
}
