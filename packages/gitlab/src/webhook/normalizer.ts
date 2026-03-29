import type { WebhookInput } from '@relayfile/sdk';

import {
  computeCommitCommentPath,
  computeGitLabPath,
  computeIssueCommentPath,
  computeMergeRequestDiscussionPath,
  computeMetadataPath,
  computePipelineJobPath,
  computeSnippetCommentPath,
} from '../path-mapper.js';
import type { GitLabSupportedEvent, GitLabWebhookPayload } from '../types.js';

function pathToObjectId(path: string): string {
  return path.replace(/^\/gitlab\/projects\//, '').replace(/\/metadata\.json$/, '');
}

export function normalizeWebhook(
  payload: GitLabWebhookPayload,
  eventType: GitLabSupportedEvent,
): WebhookInput {
  const projectPath = payload.project.path_with_namespace;

  switch (payload.object_kind) {
    case 'merge_request': {
      const path = computeMetadataPath(projectPath, 'merge_requests', payload.object_attributes.iid);
      return {
        provider: 'gitlab',
        objectType: 'merge_requests',
        objectId: pathToObjectId(path),
        eventType,
        payload: payload as unknown as Record<string, unknown>,
        relations: [`gitlab:project:${projectPath}`],
        metadata: { projectPath },
      };
    }
    case 'note': {
      const note = payload.object_attributes;
      if (note.noteable_type === 'MergeRequest') {
        const path = computeMergeRequestDiscussionPath(
          projectPath,
          payload.merge_request?.iid ?? note.noteable_iid ?? 0,
          note.discussion_id ?? String(note.id),
        );
        return {
          provider: 'gitlab',
          objectType: 'discussions',
          objectId: pathToObjectId(path),
          eventType,
          payload: payload as unknown as Record<string, unknown>,
          relations: [`gitlab:project:${projectPath}`],
          metadata: { projectPath },
        };
      }
      if (note.noteable_type === 'Issue') {
        const path = computeIssueCommentPath(projectPath, payload.issue?.iid ?? note.noteable_iid ?? 0, note.id);
        return {
          provider: 'gitlab',
          objectType: 'issue_notes',
          objectId: pathToObjectId(path),
          eventType,
          payload: payload as unknown as Record<string, unknown>,
          relations: [`gitlab:project:${projectPath}`],
          metadata: { projectPath },
        };
      }
      if (note.noteable_type === 'Commit') {
        const path = computeCommitCommentPath(projectPath, payload.commit?.id ?? '', note.id);
        return {
          provider: 'gitlab',
          objectType: 'commit_notes',
          objectId: pathToObjectId(path),
          eventType,
          payload: payload as unknown as Record<string, unknown>,
          relations: [`gitlab:project:${projectPath}`],
          metadata: { projectPath },
        };
      }
      const path = computeSnippetCommentPath(projectPath, note.noteable_id ?? 0, note.id);
      return {
        provider: 'gitlab',
        objectType: 'snippet_notes',
        objectId: pathToObjectId(path),
        eventType,
        payload: payload as unknown as Record<string, unknown>,
        relations: [`gitlab:project:${projectPath}`],
        metadata: { projectPath },
      };
    }
    case 'push': {
      const path = computeMetadataPath(projectPath, 'commits', payload.after);
      return {
        provider: 'gitlab',
        objectType: 'commits',
        objectId: pathToObjectId(path),
        eventType,
        payload: payload as unknown as Record<string, unknown>,
        relations: [`gitlab:project:${projectPath}`],
        metadata: { projectPath, ref: payload.ref },
      };
    }
    case 'pipeline': {
      const path = computeMetadataPath(projectPath, 'pipelines', payload.object_attributes.id);
      return {
        provider: 'gitlab',
        objectType: 'pipelines',
        objectId: pathToObjectId(path),
        eventType,
        payload: payload as unknown as Record<string, unknown>,
        relations: [`gitlab:project:${projectPath}`],
        metadata: { projectPath },
      };
    }
    case 'issue': {
      const path = computeMetadataPath(projectPath, 'issues', payload.object_attributes.iid);
      return {
        provider: 'gitlab',
        objectType: 'issues',
        objectId: pathToObjectId(path),
        eventType,
        payload: payload as unknown as Record<string, unknown>,
        relations: [`gitlab:project:${projectPath}`],
        metadata: { projectPath },
      };
    }
    case 'deployment': {
      const path = computeMetadataPath(projectPath, 'deployments', payload.id);
      return {
        provider: 'gitlab',
        objectType: 'deployments',
        objectId: pathToObjectId(path),
        eventType,
        payload: payload as unknown as Record<string, unknown>,
        relations: [`gitlab:project:${projectPath}`],
        metadata: { projectPath },
      };
    }
    case 'build':
    case 'job': {
      const path = computePipelineJobPath(projectPath, payload.pipeline_id ?? 0, payload.build_id);
      return {
        provider: 'gitlab',
        objectType: 'jobs',
        objectId: pathToObjectId(path),
        eventType,
        payload: payload as unknown as Record<string, unknown>,
        relations: [`gitlab:project:${projectPath}`],
        metadata: { projectPath },
      };
    }
    case 'tag_push': {
      const path = computeMetadataPath(projectPath, 'tags', payload.ref);
      return {
        provider: 'gitlab',
        objectType: 'tags',
        objectId: pathToObjectId(path),
        eventType,
        payload: payload as unknown as Record<string, unknown>,
        relations: [`gitlab:project:${projectPath}`],
        metadata: { projectPath, ref: payload.ref },
      };
    }
  }
}

export function computePathFromWebhook(payload: GitLabWebhookPayload, eventType: GitLabSupportedEvent): string {
  return computeGitLabPath(normalizeWebhook(payload, eventType).objectType, normalizeWebhook(payload, eventType).objectId);
}
