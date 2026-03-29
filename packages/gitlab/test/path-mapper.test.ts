import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
    assert.strictEqual(
      computeMetadataPath('acme/platform/api', 'merge_requests', 42),
      '/gitlab/projects/acme/platform/api/merge_requests/42/metadata.json',
    );
    assert.strictEqual(
      computeMergeRequestDiffPath('acme/api', 42),
      '/gitlab/projects/acme/api/merge_requests/42/diff.patch',
    );
    assert.strictEqual(
      computeMergeRequestDiscussionPath('acme/api', 42, 'abc'),
      '/gitlab/projects/acme/api/merge_requests/42/discussions/abc.json',
    );
    assert.strictEqual(
      computeMergeRequestApprovalsPath('acme/api', 42),
      '/gitlab/projects/acme/api/merge_requests/42/approvals.json',
    );
    assert.strictEqual(
      computeIssueCommentPath('acme/api', 7, 8),
      '/gitlab/projects/acme/api/issues/7/comments/8.json',
    );
    assert.strictEqual(
      computeCommitCommentPath('acme/api', 'abc123', 8),
      '/gitlab/projects/acme/api/commits/abc123/comments/8.json',
    );
    assert.strictEqual(
      computeSnippetCommentPath('acme/api', 12, 8),
      '/gitlab/projects/acme/api/snippets/12/comments/8.json',
    );
    assert.strictEqual(
      computePipelineJobPath('acme/api', 99, 100),
      '/gitlab/projects/acme/api/pipelines/99/jobs/100.json',
    );
  });

  it('parses paths with subgroup project names', () => {
    assert.deepStrictEqual(
      parseGitLabPath('/gitlab/projects/acme/platform/api/merge_requests/42/discussions/abc.json'),
      {
        path: '/gitlab/projects/acme/platform/api/merge_requests/42/discussions/abc.json',
        projectPath: 'acme/platform/api',
        objectType: 'merge_requests',
        objectId: '42',
        subResource: 'discussions',
        subResourceId: 'abc',
      },
    );
  });

  it('computes paths from composite object ids', () => {
    assert.strictEqual(
      computeGitLabPath('merge_requests', 'acme/api/merge_requests/42'),
      '/gitlab/projects/acme/api/merge_requests/42/metadata.json',
    );
    assert.strictEqual(
      computeGitLabPath('issues', 'acme/api/issues/7'),
      '/gitlab/projects/acme/api/issues/7/metadata.json',
    );
    assert.strictEqual(
      computeGitLabPath('commits', 'acme/api/commits/abc123'),
      '/gitlab/projects/acme/api/commits/abc123/metadata.json',
    );
    assert.strictEqual(
      computeGitLabPath('pipelines', 'acme/api/pipelines/9'),
      '/gitlab/projects/acme/api/pipelines/9/metadata.json',
    );
    assert.strictEqual(
      computeGitLabPath('jobs', 'acme/api/pipelines/9/jobs/10.json'),
      '/gitlab/projects/acme/api/pipelines/9/jobs/10.json',
    );
    assert.strictEqual(
      computeGitLabPath('discussions', 'acme/api/merge_requests/42/discussions/abc.json'),
      '/gitlab/projects/acme/api/merge_requests/42/discussions/abc.json',
    );
    assert.strictEqual(
      computeGitLabPath('issue_notes', 'acme/api/issues/7/comments/8.json'),
      '/gitlab/projects/acme/api/issues/7/comments/8.json',
    );
    assert.strictEqual(
      computeGitLabPath('commit_notes', 'acme/api/commits/abc123/comments/8.json'),
      '/gitlab/projects/acme/api/commits/abc123/comments/8.json',
    );
    assert.strictEqual(
      computeGitLabPath('snippet_notes', 'acme/api/snippets/12/comments/8.json'),
      '/gitlab/projects/acme/api/snippets/12/comments/8.json',
    );
  });
});
