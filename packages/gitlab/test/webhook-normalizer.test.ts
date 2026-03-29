import { describe, expect, it } from 'vitest';

import { normalizeWebhook } from '../src/webhook/normalizer.js';
import type {
  GitLabBuildWebhook,
  GitLabDeploymentWebhook,
  GitLabIssueWebhook,
  GitLabMergeRequestWebhook,
  GitLabNoteWebhook,
  GitLabPipelineWebhook,
  GitLabPushWebhook,
  GitLabTagPushWebhook,
} from '../src/types.js';

const project = {
  id: 1,
  name: 'api',
  path: 'api',
  path_with_namespace: 'acme/api',
};

describe('normalizeWebhook', () => {
  it('normalizes merge request events', () => {
    const payload = {
      object_kind: 'merge_request',
      project,
      object_attributes: {
        id: 10,
        iid: 42,
        title: 'MR',
        description: null,
        state: 'opened',
        author: { id: 2, username: 'dev', name: 'Dev' },
        labels: [],
        source_branch: 'feature',
        target_branch: 'main',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        action: 'open',
      },
    } as GitLabMergeRequestWebhook;

    expect(normalizeWebhook(payload, 'merge_request.open')).toMatchObject({
      provider: 'gitlab',
      objectType: 'merge_requests',
      objectId: 'acme/api/merge_requests/42',
      eventType: 'merge_request.open',
    });
  });

  it('normalizes note events for merge requests, issues, commits, and snippets', () => {
    const base = {
      object_kind: 'note',
      project,
      merge_request: {
        id: 10,
        iid: 42,
        title: 'MR',
        description: null,
        state: 'opened',
        author: { id: 2, username: 'dev', name: 'Dev' },
        labels: [],
        source_branch: 'feature',
        target_branch: 'main',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      object_attributes: {
        id: 99,
        body: 'hello',
        author: { id: 2, username: 'dev', name: 'Dev' },
        noteable_type: 'MergeRequest',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        discussion_id: 'abc',
      },
    } as GitLabNoteWebhook;

    expect(normalizeWebhook(base, 'note.MergeRequest').objectId).toContain('merge_requests/42/discussions/abc');
    expect(
      normalizeWebhook(
        {
          ...base,
          object_attributes: { ...base.object_attributes, noteable_type: 'Issue', noteable_iid: 7 },
          issue: {
            id: 7,
            iid: 7,
            title: 'Issue',
            description: null,
            state: 'opened',
            author: { id: 2, username: 'dev', name: 'Dev' },
            labels: [],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        },
        'note.Issue',
      ).objectId,
    ).toContain('issues/7/comments/99');
    expect(
      normalizeWebhook(
        {
          ...base,
          object_attributes: { ...base.object_attributes, noteable_type: 'Commit' },
          commit: {
            id: 'abc123',
            short_id: 'abc123',
            title: 'Commit',
            message: 'Commit',
            author_name: 'Dev',
            author_email: 'dev@example.com',
            authored_date: '2024-01-01T00:00:00Z',
            committed_date: '2024-01-01T00:00:00Z',
          },
        },
        'note.Commit',
      ).objectId,
    ).toContain('commits/abc123/comments/99');
    expect(
      normalizeWebhook(
        {
          ...base,
          object_attributes: { ...base.object_attributes, noteable_type: 'Snippet', noteable_id: 55 },
        },
        'note.Snippet',
      ).objectId,
    ).toContain('snippets/55/comments/99');
  });

  it('normalizes push, pipeline, issue, deployment, build, and tag push events', () => {
    expect(
      normalizeWebhook(
        {
          object_kind: 'push',
          project,
          after: 'deadbeef',
          before: 'beadfeed',
          commits: [],
          ref: 'refs/heads/main',
        } as GitLabPushWebhook,
        'push',
      ).objectId,
    ).toContain('commits/deadbeef');

    expect(
      normalizeWebhook(
        {
          object_kind: 'pipeline',
          project,
          object_attributes: { id: 4, ref: 'main', sha: 'sha', status: 'success' },
        } as GitLabPipelineWebhook,
        'pipeline.success',
      ).objectId,
    ).toContain('pipelines/4');

    expect(
      normalizeWebhook(
        {
          object_kind: 'issue',
          project,
          object_attributes: {
            id: 5,
            iid: 5,
            title: 'Issue',
            description: null,
            state: 'opened',
            author: { id: 2, username: 'dev', name: 'Dev' },
            labels: [],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            action: 'open',
          },
        } as GitLabIssueWebhook,
        'issue.open',
      ).objectId,
    ).toContain('issues/5');

    expect(
      normalizeWebhook(
        {
          object_kind: 'deployment',
          project,
          id: 7,
          deployable_id: 7,
          status: 'success',
        } as GitLabDeploymentWebhook,
        'deployment.success',
      ).objectId,
    ).toContain('deployments/7');

    expect(
      normalizeWebhook(
        {
          object_kind: 'build',
          project,
          build_id: 12,
          build_name: 'test',
          build_stage: 'test',
          build_status: 'success',
          pipeline_id: 88,
        } as GitLabBuildWebhook,
        'build.success',
      ).objectId,
    ).toContain('pipelines/88/jobs/12');

    expect(
      normalizeWebhook(
        {
          object_kind: 'tag_push',
          project,
          after: 'deadbeef',
          before: 'beadfeed',
          commits: [],
          ref: 'refs/tags/v1.0.0',
        } as GitLabTagPushWebhook,
        'tag_push',
      ).objectId,
    ).toContain('tags/refs%2Ftags%2Fv1.0.0');
  });
});
