import { GitLabApiClient } from '../api.js';
import {
  computeMergeRequestDiffPath,
  computeMetadataPath,
} from '../path-mapper.js';
import type { GitLabApprovalState, GitLabDiscussion, GitLabDiffEntry, GitLabMergeRequest, IngestOperation } from '../types.js';
import { mapApprovalsToOperation } from './approvals.js';
import { renderMergeRequestPatch } from './diff-parser.js';
import { mapDiscussionToOperation } from './discussions.js';

export async function ingestMergeRequest(
  api: GitLabApiClient,
  projectPath: string,
  mergeRequestIid: number,
  mode: IngestOperation['mode'],
): Promise<IngestOperation[]> {
  const projectId = api.projectId(projectPath);
  const [mergeRequest, diffs, discussions, approvals] = await Promise.all([
    api.get<GitLabMergeRequest>(`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}`),
    api.get<GitLabDiffEntry[]>(`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/diffs`),
    api.get<GitLabDiscussion[]>(
      `/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`,
    ),
    api.get<GitLabApprovalState>(
      `/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/approvals`,
    ),
  ]);

  return [
    {
      path: computeMetadataPath(projectPath, 'merge_requests', mergeRequestIid),
      mode,
      content: JSON.stringify(mergeRequest, null, 2),
      contentType: 'application/json',
    },
    {
      path: computeMergeRequestDiffPath(projectPath, mergeRequestIid),
      mode,
      content: renderMergeRequestPatch(diffs),
      contentType: 'text/plain',
    },
    ...discussions.map((discussion) =>
      mapDiscussionToOperation(projectPath, mergeRequestIid, discussion, mode),
    ),
    mapApprovalsToOperation(projectPath, mergeRequestIid, approvals, mode),
  ];
}
