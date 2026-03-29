import type { WebhookInput } from '@relayfile/sdk';

import type { GitLabAdapter } from '../adapter.js';
import type { GitLabSupportedEvent, GitLabWebhookPayload } from '../types.js';

export interface WebhookAdapter {
  closeIssue(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  closeMergeRequest(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  ingestApproval(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  ingestDeployment(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  ingestIssue(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  ingestJob(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  ingestMergeRequest(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  ingestNote(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  ingestPipeline(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  ingestPush(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  ingestTagPush(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  mergeMergeRequest(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  updateIssue(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
  updateMergeRequest(normalized: WebhookInput, payload: GitLabWebhookPayload): Promise<import('../types.js').IngestResult>;
}

export type WebhookHandler = (
  adapter: WebhookAdapter,
  normalized: WebhookInput,
  payload: GitLabWebhookPayload,
) => Promise<import('../types.js').IngestResult>;

export const EVENT_MAP: Record<GitLabSupportedEvent, WebhookHandler> = {
  'merge_request.open': (adapter, normalized, payload) => adapter.ingestMergeRequest(normalized, payload),
  'merge_request.reopen': (adapter, normalized, payload) => adapter.ingestMergeRequest(normalized, payload),
  'merge_request.update': (adapter, normalized, payload) => adapter.updateMergeRequest(normalized, payload),
  'merge_request.close': (adapter, normalized, payload) => adapter.closeMergeRequest(normalized, payload),
  'merge_request.merge': (adapter, normalized, payload) => adapter.mergeMergeRequest(normalized, payload),
  'merge_request.approved': (adapter, normalized, payload) => adapter.ingestApproval(normalized, payload),
  'merge_request.unapproved': (adapter, normalized, payload) => adapter.ingestApproval(normalized, payload),
  'note.MergeRequest': (adapter, normalized, payload) => adapter.ingestNote(normalized, payload),
  'note.Issue': (adapter, normalized, payload) => adapter.ingestNote(normalized, payload),
  'note.Commit': (adapter, normalized, payload) => adapter.ingestNote(normalized, payload),
  'note.Snippet': (adapter, normalized, payload) => adapter.ingestNote(normalized, payload),
  push: (adapter, normalized, payload) => adapter.ingestPush(normalized, payload),
  'pipeline.created': (adapter, normalized, payload) => adapter.ingestPipeline(normalized, payload),
  'pipeline.pending': (adapter, normalized, payload) => adapter.ingestPipeline(normalized, payload),
  'pipeline.running': (adapter, normalized, payload) => adapter.ingestPipeline(normalized, payload),
  'pipeline.success': (adapter, normalized, payload) => adapter.ingestPipeline(normalized, payload),
  'pipeline.failed': (adapter, normalized, payload) => adapter.ingestPipeline(normalized, payload),
  'pipeline.canceled': (adapter, normalized, payload) => adapter.ingestPipeline(normalized, payload),
  'pipeline.manual': (adapter, normalized, payload) => adapter.ingestPipeline(normalized, payload),
  'pipeline.skipped': (adapter, normalized, payload) => adapter.ingestPipeline(normalized, payload),
  'pipeline.waiting_for_resource': (adapter, normalized, payload) => adapter.ingestPipeline(normalized, payload),
  'issue.open': (adapter, normalized, payload) => adapter.ingestIssue(normalized, payload),
  'issue.reopen': (adapter, normalized, payload) => adapter.ingestIssue(normalized, payload),
  'issue.update': (adapter, normalized, payload) => adapter.updateIssue(normalized, payload),
  'issue.close': (adapter, normalized, payload) => adapter.closeIssue(normalized, payload),
  'deployment.created': (adapter, normalized, payload) => adapter.ingestDeployment(normalized, payload),
  'deployment.running': (adapter, normalized, payload) => adapter.ingestDeployment(normalized, payload),
  'deployment.success': (adapter, normalized, payload) => adapter.ingestDeployment(normalized, payload),
  'deployment.failed': (adapter, normalized, payload) => adapter.ingestDeployment(normalized, payload),
  'deployment.canceled': (adapter, normalized, payload) => adapter.ingestDeployment(normalized, payload),
  'build.created': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'build.pending': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'build.running': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'build.success': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'build.failed': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'build.canceled': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'build.manual': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'build.skipped': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'job.created': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'job.pending': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'job.running': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'job.success': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'job.failed': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'job.canceled': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'job.manual': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  'job.skipped': (adapter, normalized, payload) => adapter.ingestJob(normalized, payload),
  tag_push: (adapter, normalized, payload) => adapter.ingestTagPush(normalized, payload),
};

export function extractEventKey(payload: GitLabWebhookPayload): GitLabSupportedEvent {
  switch (payload.object_kind) {
    case 'merge_request': {
      const action = payload.object_attributes.action;
      if (action === 'approval') {
        return 'merge_request.approved';
      }
      if (action === 'unapproval') {
        return 'merge_request.unapproved';
      }
      return `merge_request.${action}` as GitLabSupportedEvent;
    }
    case 'note':
      return `note.${payload.object_attributes.noteable_type}` as GitLabSupportedEvent;
    case 'push':
      return 'push';
    case 'pipeline':
      return `pipeline.${payload.object_attributes.status}` as GitLabSupportedEvent;
    case 'issue':
      return `issue.${payload.object_attributes.action}` as GitLabSupportedEvent;
    case 'deployment':
      return `deployment.${payload.status}` as GitLabSupportedEvent;
    case 'build':
    case 'job':
      return `${payload.object_kind}.${payload.build_status}` as GitLabSupportedEvent;
    case 'tag_push':
      return 'tag_push';
  }
}

export function extractProjectInfo(payload: GitLabWebhookPayload): {
  projectId: number;
  projectPath: string;
} {
  return {
    projectId: payload.project.id,
    projectPath: payload.project.path_with_namespace,
  };
}

export function routeGitLabWebhook(
  adapter: GitLabAdapter,
  normalized: WebhookInput,
  payload: GitLabWebhookPayload,
): Promise<import('../types.js').IngestResult> {
  const eventKey = extractEventKey(payload);
  return EVENT_MAP[eventKey](adapter, normalized, payload);
}
