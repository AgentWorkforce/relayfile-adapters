import type { IngestOperation, SyncOptions, SyncResult } from './types.js';
import { GitLabApiClient } from './api.js';
import { ingestCommit } from './commits/ingestion.js';
import { ingestIssue } from './issues/ingestion.js';
import { ingestMergeRequest } from './mr/ingestion.js';
import { ingestPipeline } from './pipeline/ingestion.js';

function emptySyncResult(cursor?: string | null): SyncResult {
  return {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [],
    errors: [],
    operations: [],
    nextCursor: cursor ?? null,
    syncedObjectTypes: [],
  };
}

function accumulate(result: SyncResult, objectType: string, operations: IngestOperation[]): void {
  if (operations.length === 0) {
    return;
  }

  result.filesWritten += operations.filter((operation) => operation.mode === 'write').length;
  result.filesUpdated += operations.filter((operation) => operation.mode === 'update').length;
  result.paths.push(...operations.map((operation) => operation.path));
  result.operations.push(...operations);
  if (!result.syncedObjectTypes.includes(objectType)) {
    result.syncedObjectTypes.push(objectType);
  }
}

export async function bulkIngestProject(
  api: GitLabApiClient,
  options: SyncOptions,
): Promise<SyncResult> {
  const projectPath = options.projectPath;
  if (!projectPath) {
    throw new Error('bulkIngestProject requires options.projectPath');
  }

  const projectId = api.projectId(projectPath);
  const limit = options.limit;
  const wantedTypes = new Set(options.objectTypes ?? ['merge_requests', 'issues', 'pipelines', 'commits']);
  const result = emptySyncResult(options.cursor ?? null);

  if (wantedTypes.has('merge_requests')) {
    const mergeRequests = await api.paginate<Array<{ iid: number }>[number]>(
      `/api/v4/projects/${projectId}/merge_requests`,
      { state: 'all' },
      { limit },
    );
    for (const mergeRequest of mergeRequests) {
      accumulate(result, 'merge_requests', await ingestMergeRequest(api, projectPath, mergeRequest.iid, 'write'));
    }
  }

  if (wantedTypes.has('issues')) {
    const issues = await api.paginate<Array<{ iid: number }>[number]>(
      `/api/v4/projects/${projectId}/issues`,
      { state: 'all' },
      { limit },
    );
    for (const issue of issues) {
      accumulate(result, 'issues', await ingestIssue(api, projectPath, issue.iid, 'write'));
    }
  }

  if (wantedTypes.has('pipelines')) {
    const pipelines = await api.paginate<Array<{ id: number }>[number]>(
      `/api/v4/projects/${projectId}/pipelines`,
      {},
      { limit },
    );
    for (const pipeline of pipelines) {
      accumulate(result, 'pipelines', await ingestPipeline(api, projectPath, pipeline.id));
    }
  }

  if (wantedTypes.has('commits')) {
    const commits = await api.paginate<Array<{ id: string }>[number]>(
      `/api/v4/projects/${projectId}/repository/commits`,
      {},
      { limit },
    );
    for (const commit of commits) {
      accumulate(result, 'commits', await ingestCommit(api, projectPath, commit.id));
    }
  }

  return result;
}
