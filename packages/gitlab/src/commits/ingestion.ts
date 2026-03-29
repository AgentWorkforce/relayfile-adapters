import { GitLabApiClient } from '../api.js';
import { computeCommitCommentPath, computeMetadataPath } from '../path-mapper.js';
import type { GitLabCommit, GitLabNoteWebhook, IngestOperation } from '../types.js';

export async function ingestCommit(
  api: GitLabApiClient,
  projectPath: string,
  sha: string,
  mode: IngestOperation['mode'] = 'write',
): Promise<IngestOperation[]> {
  const projectId = api.projectId(projectPath);
  const commit = await api.get<GitLabCommit>(
    `/api/v4/projects/${projectId}/repository/commits/${encodeURIComponent(sha)}`,
  );

  return [
    {
      path: computeMetadataPath(projectPath, 'commits', sha),
      mode,
      content: JSON.stringify(commit, null, 2),
      contentType: 'application/json',
    },
  ];
}

export function mapCommitNoteToOperation(
  projectPath: string,
  sha: string,
  webhook: GitLabNoteWebhook,
): IngestOperation {
  return {
    path: computeCommitCommentPath(projectPath, sha, webhook.object_attributes.id),
    mode: 'write',
    content: JSON.stringify(webhook.object_attributes, null, 2),
    contentType: 'application/json',
  };
}
