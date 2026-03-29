import { GitLabApiClient } from '../api.js';
import { computeIssueCommentPath, computeMetadataPath } from '../path-mapper.js';
import type { GitLabIssue, GitLabNoteWebhook, IngestOperation } from '../types.js';

export async function ingestIssue(
  api: GitLabApiClient,
  projectPath: string,
  issueIid: number,
  mode: IngestOperation['mode'],
): Promise<IngestOperation[]> {
  const projectId = api.projectId(projectPath);
  const issue = await api.get<GitLabIssue>(`/api/v4/projects/${projectId}/issues/${issueIid}`);

  return [
    {
      path: computeMetadataPath(projectPath, 'issues', issueIid),
      mode,
      content: JSON.stringify(issue, null, 2),
      contentType: 'application/json',
    },
  ];
}

export function mapIssueNoteToOperation(
  projectPath: string,
  issueIid: number,
  webhook: GitLabNoteWebhook,
): IngestOperation {
  return {
    path: computeIssueCommentPath(projectPath, issueIid, webhook.object_attributes.id),
    mode: 'write',
    content: JSON.stringify(webhook.object_attributes, null, 2),
    contentType: 'application/json',
  };
}
