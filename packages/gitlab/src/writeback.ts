import type { ConnectionProvider, WritebackPathTarget, WritebackResult } from './types.js';
import { parseGitLabPath } from './path-mapper.js';

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

    const isMetadataPath = parsed.subResource === 'metadata.json' || parsed.subResource === undefined;

    if (parsed.objectType === 'merge_requests' && isMetadataPath) {
      return {
        entity: 'merge_request',
        projectPath: parsed.projectPath,
        resourceId: parsed.objectId,
      };
    }

    if (parsed.objectType === 'merge_requests' && parsed.subResource === 'discussions' && parsed.subResourceId === 'new') {
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

    if (parsed.objectType === 'issues' && parsed.subResource === 'comments' && parsed.subResourceId === 'new') {
      return {
        entity: 'issue_note',
        projectPath: parsed.projectPath,
        resourceId: parsed.objectId,
      };
    }

    throw new Error(`Unsupported GitLab writeback path: ${path}`);
  }

  async writeBack(workspaceId: string, path: string, content: string): Promise<WritebackResult> {
    try {
      const target = this.extractWritebackTarget(path);
      const body = JSON.parse(content) as Record<string, unknown>;
      const projectId = encodeURIComponent(target.projectPath);

      let endpoint = '';
      let method: 'POST' | 'PUT' = 'PUT';

      switch (target.entity) {
        case 'merge_request':
          endpoint = `/api/v4/projects/${projectId}/merge_requests/${target.resourceId}`;
          method = 'PUT';
          break;
        case 'merge_request_discussion':
          endpoint = `/api/v4/projects/${projectId}/merge_requests/${target.resourceId}/discussions`;
          method = 'POST';
          break;
        case 'issue':
          endpoint = `/api/v4/projects/${projectId}/issues/${target.resourceId}`;
          method = 'PUT';
          break;
        case 'issue_note':
          endpoint = `/api/v4/projects/${projectId}/issues/${target.resourceId}/notes`;
          method = 'POST';
          break;
      }

      const response = await this.provider.proxy({
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
