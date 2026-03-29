import { computeMergeRequestApprovalsPath } from '../path-mapper.js';
import type { GitLabApprovalState, IngestOperation } from '../types.js';

export function mapApprovalsToOperation(
  projectPath: string,
  mergeRequestIid: number,
  approvalState: GitLabApprovalState,
  mode: IngestOperation['mode'] = 'update',
): IngestOperation {
  return {
    path: computeMergeRequestApprovalsPath(projectPath, mergeRequestIid),
    mode,
    content: JSON.stringify(approvalState, null, 2),
    contentType: 'application/json',
  };
}
