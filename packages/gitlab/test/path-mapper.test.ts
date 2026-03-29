import { describe, expect, it } from 'vitest';

import {
  computeCommitCommentPath,
  computeGitLabPath,
  computeIssueCommentPath,
  computeMergeRequestApprovalsPath,
  computeMergeRequestDiffPath,
  computeMergeRequestDiscussionPath,
  computeMetadataPath,
  computePipelineJobPath,
  computeSnippetCommentPath,
  parseGitLabPath,
} from '../src/path-mapper.js';

describe('path mapper', () => {
  it('computes the expected GitLab VFS paths', () => {
    expect(computeMetadataPath('acme/platform/api', 'merge_requests', 42)).toBe(
      '/gitlab/projects/acme/platform/api/merge_requests/42/metadata.json',
    );
    expect(computeMergeRequestDiffPath('acme/api', 42)).toBe(
      '/gitlab/projects/acme/api/merge_requests/42/diff.patch',
    );
    expect(computeMergeRequestDiscussionPath('acme/api', 42, 'abc')).toBe(
      '/gitlab/projects/acme/api/merge_requests/42/discussions/abc.json',
    );
    expect(computeMergeRequestApprovalsPath('acme/api', 42)).toBe(
      '/gitlab/projects/acme/api/merge_requests/42/approvals.json',
    );
    expect(computeIssueCommentPath('acme/api', 7, 8)).toBe(
      '/gitlab/projects/acme/api/issues/7/comments/8.json',
    );
    expect(computeCommitCommentPath('acme/api', 'abc123', 8)).toBe(
      '/gitlab/projects/acme/api/commits/abc123/comments/8.json',
    );
    expect(computeSnippetCommentPath('acme/api', 12, 8)).toBe(
      '/gitlab/projects/acme/api/snippets/12/comments/8.json',
    );
    expect(computePipelineJobPath('acme/api', 99, 100)).toBe(
      '/gitlab/projects/acme/api/pipelines/99/jobs/100.json',
    );
  });

  it('parses paths with subgroup project names', () => {
    expect(
      parseGitLabPath('/gitlab/projects/acme/platform/api/merge_requests/42/discussions/abc.json'),
    ).toEqual({
      path: '/gitlab/projects/acme/platform/api/merge_requests/42/discussions/abc.json',
      projectPath: 'acme/platform/api',
      objectType: 'merge_requests',
      objectId: '42',
      subResource: 'discussions',
      subResourceId: 'abc',
    });
  });

  it('computes paths from composite object ids', () => {
    expect(computeGitLabPath('merge_requests', 'acme/api/merge_requests/42')).toBe(
      '/gitlab/projects/acme/api/merge_requests/42/metadata.json',
    );
    expect(computeGitLabPath('issues', 'acme/api/issues/7')).toBe(
      '/gitlab/projects/acme/api/issues/7/metadata.json',
    );
    expect(computeGitLabPath('commits', 'acme/api/commits/abc123')).toBe(
      '/gitlab/projects/acme/api/commits/abc123/metadata.json',
    );
    expect(computeGitLabPath('pipelines', 'acme/api/pipelines/9')).toBe(
      '/gitlab/projects/acme/api/pipelines/9/metadata.json',
    );
    expect(computeGitLabPath('jobs', 'acme/api/pipelines/9/jobs/10.json')).toBe(
      '/gitlab/projects/acme/api/pipelines/9/jobs/10.json',
    );
    expect(computeGitLabPath('discussions', 'acme/api/merge_requests/42/discussions/abc.json')).toBe(
      '/gitlab/projects/acme/api/merge_requests/42/discussions/abc.json',
    );
    expect(computeGitLabPath('issue_notes', 'acme/api/issues/7/comments/8.json')).toBe(
      '/gitlab/projects/acme/api/issues/7/comments/8.json',
    );
    expect(computeGitLabPath('commit_notes', 'acme/api/commits/abc123/comments/8.json')).toBe(
      '/gitlab/projects/acme/api/commits/abc123/comments/8.json',
    );
    expect(computeGitLabPath('snippet_notes', 'acme/api/snippets/12/comments/8.json')).toBe(
      '/gitlab/projects/acme/api/snippets/12/comments/8.json',
    );
  });
});
