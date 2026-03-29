import { describe, expect, it } from 'vitest';

import { EVENT_MAP, extractEventKey } from '../src/webhook/router.js';
import type { GitLabBuildWebhook, GitLabIssueWebhook, GitLabPipelineWebhook } from '../src/types.js';

const project = {
  id: 1,
  name: 'api',
  path: 'api',
  path_with_namespace: 'acme/api',
};

describe('webhook router', () => {
  it('extracts supported pipeline and job statuses', () => {
    expect(
      extractEventKey({
        object_kind: 'pipeline',
        project,
        object_attributes: { id: 4, ref: 'main', sha: 'sha', status: 'waiting_for_resource' },
      } as GitLabPipelineWebhook),
    ).toBe('pipeline.waiting_for_resource');
    expect(
      extractEventKey({
        object_kind: 'build',
        project,
        build_id: 12,
        build_name: 'test',
        build_stage: 'test',
        build_status: 'manual',
      } as GitLabBuildWebhook),
    ).toBe('build.manual');
    expect(
      extractEventKey({
        object_kind: 'job',
        project,
        build_id: 13,
        build_name: 'deploy',
        build_stage: 'deploy',
        build_status: 'skipped',
      } as GitLabBuildWebhook),
    ).toBe('job.skipped');
  });

  it('routes issue.update through the update handler', async () => {
    let called: string | undefined;
    const adapter = {
      closeIssue: async () => {
        called = 'closeIssue';
        return { filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] };
      },
      closeMergeRequest: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
      ingestApproval: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
      ingestDeployment: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
      ingestIssue: async () => {
        called = 'ingestIssue';
        return { filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] };
      },
      ingestJob: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
      ingestMergeRequest: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
      ingestNote: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
      ingestPipeline: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
      ingestPush: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
      ingestTagPush: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
      mergeMergeRequest: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
      updateIssue: async () => {
        called = 'updateIssue';
        return { filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] };
      },
      updateMergeRequest: async () => ({ filesDeleted: 0, filesUpdated: 0, filesWritten: 0, paths: [], errors: [], operations: [] }),
    };

    await EVENT_MAP['issue.update'](
      adapter,
      { provider: 'gitlab', objectType: 'issues', objectId: 'acme/api/issues/7', eventType: 'issue.update', payload: {}, relations: [], metadata: {} },
      {
        object_kind: 'issue',
        project,
        object_attributes: {
          id: 99,
          iid: 7,
          title: 'Issue',
          description: null,
          state: 'opened',
          author: { id: 2, username: 'dev', name: 'Dev' },
          labels: [],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          action: 'update',
        },
      } as GitLabIssueWebhook,
    );

    expect(called).toBe('updateIssue');
  });
});
