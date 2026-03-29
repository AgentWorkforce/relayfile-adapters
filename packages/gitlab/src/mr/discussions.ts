import {
  computeMergeRequestDiscussionPath,
} from '../path-mapper.js';
import type {
  GitLabDiscussion,
  GitLabDiscussionPosition,
  GitLabNoteWebhook,
  IngestOperation,
} from '../types.js';

export function serializeDiscussion(discussion: GitLabDiscussion): string {
  return JSON.stringify(discussion, null, 2);
}

export function mapDiscussionToOperation(
  projectPath: string,
  mergeRequestIid: number,
  discussion: GitLabDiscussion,
  mode: IngestOperation['mode'] = 'write',
): IngestOperation {
  return {
    path: computeMergeRequestDiscussionPath(projectPath, mergeRequestIid, discussion.id),
    mode,
    content: serializeDiscussion(discussion),
    contentType: 'application/json',
  };
}

export function buildDiscussionCreateBody(input: {
  body: string;
  position?: GitLabDiscussionPosition;
}): Record<string, unknown> {
  return input.position ? { body: input.body, position: input.position } : { body: input.body };
}

export function mapDiscussionWebhookToOperation(
  projectPath: string,
  webhook: GitLabNoteWebhook,
): IngestOperation {
  const mergeRequestIid = webhook.merge_request?.iid ?? webhook.object_attributes.noteable_iid ?? 0;
  const discussionId = webhook.object_attributes.discussion_id ?? String(webhook.object_attributes.id);

  return {
    path: computeMergeRequestDiscussionPath(projectPath, mergeRequestIid, discussionId),
    mode: 'write',
    content: JSON.stringify(
      {
        id: discussionId,
        individual_note: false,
        notes: [webhook.object_attributes],
      },
      null,
      2,
    ),
    contentType: 'application/json',
  };
}
