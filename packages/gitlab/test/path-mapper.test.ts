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
  gitLabByAssigneeAliasPath,
  gitLabByCreatorAliasPath,
  gitLabByPriorityAliasPath,
  gitLabByStateAliasPath,
  parseGitLabPath,
} from '../src/path-mapper.js';

describe('path mapper', () => {
  it('computes the expected GitLab VFS paths', () => {
    assert.strictEqual(
      computeMetadataPath('acme/platform/api', 'merge_requests', 42, 'Add OAuth'),
      '/gitlab/projects/acme/platform/api/merge_requests/42__add-oauth/meta.json',
    );
    assert.strictEqual(
      computeMergeRequestDiffPath('acme/api', 42, 'Add OAuth'),
      '/gitlab/projects/acme/api/merge_requests/42__add-oauth/diff.patch',
    );
    assert.strictEqual(
      computeMergeRequestDiscussionPath('acme/api', 42, 'abc', 'Add OAuth'),
      '/gitlab/projects/acme/api/merge_requests/42__add-oauth/discussions/abc.json',
    );
    assert.strictEqual(
      computeMergeRequestApprovalsPath('acme/api', 42, 'Add OAuth'),
      '/gitlab/projects/acme/api/merge_requests/42__add-oauth/approvals.json',
    );
    assert.strictEqual(
      computeIssueCommentPath('acme/api', 7, 8, 'Fix bug'),
      '/gitlab/projects/acme/api/issues/7__fix-bug/comments/8.json',
    );
    assert.strictEqual(
      computeCommitCommentPath('acme/api', 'abc123', 8, 'Initial commit'),
      '/gitlab/projects/acme/api/commits/abc123__initial-commit/comments/8.json',
    );
    assert.strictEqual(
      computeSnippetCommentPath('acme/api', 12, 8),
      '/gitlab/projects/acme/api/snippets/12/comments/8.json',
    );
    assert.strictEqual(
      computePipelineJobPath('acme/api', 99, 100, 'main'),
      '/gitlab/projects/acme/api/pipelines/99__main/jobs/100.json',
    );
    assert.strictEqual(
      computeMetadataPath('acme/api', 'deployments', 7),
      '/gitlab/projects/acme/api/deployments/7.json',
    );
    assert.strictEqual(
      computeMetadataPath('acme/api', 'tags', 'refs/tags/v1.0.0', 'refs/tags/v1.0.0'),
      '/gitlab/projects/acme/api/tags/refs-tags-v1-0-0__refs%2Ftags%2Fv1.0.0.json',
    );
    assert.strictEqual(
      gitLabByStateAliasPath('acme/api', 'issues', 'in progress', 7),
      '/gitlab/projects/acme/api/issues/by-state/in-progress/7.json',
    );
    assert.strictEqual(
      gitLabByAssigneeAliasPath('acme/api', 'issues', 'Ada Lovelace', 7),
      '/gitlab/projects/acme/api/issues/by-assignee/ada-lovelace/7.json',
    );
    assert.strictEqual(
      gitLabByCreatorAliasPath('acme/api', 'merge_requests', 'linus', 42),
      '/gitlab/projects/acme/api/merge_requests/by-creator/linus/42.json',
    );
    assert.strictEqual(
      gitLabByPriorityAliasPath('acme/api', 'issues', 'priority::high', 7),
      '/gitlab/projects/acme/api/issues/by-priority/priority-high/7.json',
    );
  });

  it('rejects empty stateful alias values', () => {
    assert.throws(
      () => gitLabByStateAliasPath('acme/api', 'issues', '   ', 7),
      /state must be a non-empty string/u,
    );
    assert.throws(
      () => gitLabByAssigneeAliasPath('acme/api', 'issues', '', 7),
      /assignee must be a non-empty string/u,
    );
    assert.throws(
      () => gitLabByCreatorAliasPath('acme/api', 'merge_requests', '', 42),
      /creator must be a non-empty string/u,
    );
    assert.throws(
      () => gitLabByPriorityAliasPath('acme/api', 'issues', '', 7),
      /priority must be a non-empty string/u,
    );
  });

  it('parses paths with subgroup project names', () => {
    assert.deepStrictEqual(
      parseGitLabPath('/gitlab/projects/acme/platform/api/merge_requests/42__add-oauth/discussions/abc.json'),
      {
        path: '/gitlab/projects/acme/platform/api/merge_requests/42__add-oauth/discussions/abc.json',
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
      computeGitLabPath('merge_requests', 'acme/api/merge_requests/42', { title: 'Add OAuth' }),
      '/gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json',
    );
    assert.strictEqual(
      computeGitLabPath('merge_requests', 'acme/api/merge_requests/42__add-oauth'),
      '/gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json',
    );
    assert.strictEqual(
      computeGitLabPath('merge_requests', 'acme/api/merge_requests/42', { slug: 'add-oauth' }),
      '/gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json',
    );
    assert.strictEqual(
      computeGitLabPath('issues', 'acme/api/issues/7', { title: 'Fix Bug' }),
      '/gitlab/projects/acme/api/issues/7__fix-bug/meta.json',
    );
    assert.strictEqual(
      computeGitLabPath('commits', 'acme/api/commits/abc123', { title: 'Initial commit' }),
      '/gitlab/projects/acme/api/commits/abc123__initial-commit/meta.json',
    );
    assert.strictEqual(
      computeGitLabPath('pipelines', 'acme/api/pipelines/9', { ref: 'main' }),
      '/gitlab/projects/acme/api/pipelines/9__main/meta.json',
    );
    assert.strictEqual(
      computeGitLabPath('jobs', 'acme/api/pipelines/9__main/jobs/10.json'),
      '/gitlab/projects/acme/api/pipelines/9__main/jobs/10.json',
    );
    assert.strictEqual(
      computeGitLabPath('discussions', 'acme/api/merge_requests/42__add-oauth/discussions/abc.json'),
      '/gitlab/projects/acme/api/merge_requests/42__add-oauth/discussions/abc.json',
    );
    assert.strictEqual(
      computeGitLabPath('issue_notes', 'acme/api/issues/7__fix-bug/comments/8.json'),
      '/gitlab/projects/acme/api/issues/7__fix-bug/comments/8.json',
    );
    assert.strictEqual(
      computeGitLabPath('commit_notes', 'acme/api/commits/abc123__initial-commit/comments/8.json'),
      '/gitlab/projects/acme/api/commits/abc123__initial-commit/comments/8.json',
    );
    assert.strictEqual(
      computeGitLabPath('snippet_notes', 'acme/api/snippets/12/comments/8.json'),
      '/gitlab/projects/acme/api/snippets/12/comments/8.json',
    );
    assert.strictEqual(
      computeGitLabPath('tags', 'acme/api/tags/refs-tags-v1-0-0__refs%2Ftags%2Fv1.0.0'),
      '/gitlab/projects/acme/api/tags/refs-tags-v1-0-0__refs%2Ftags%2Fv1.0.0.json',
    );
  });

  it('parses legacy metadata paths for reader-side back-compat', () => {
    assert.deepStrictEqual(
      parseGitLabPath('/gitlab/projects/acme/api/issues/7/metadata.json'),
      {
        path: '/gitlab/projects/acme/api/issues/7/metadata.json',
        projectPath: 'acme/api',
        objectType: 'issues',
        objectId: '7',
        subResource: 'metadata.json',
        subResourceId: undefined,
      },
    );
  });
});
