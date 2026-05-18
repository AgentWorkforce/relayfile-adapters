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
  gitLabFlatRecordFilename,
  gitLabProjectMetadataPath,
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
      gitLabProjectMetadataPath('acme/api'),
      '/gitlab/projects/acme/api/meta.json',
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
      computeMetadataPath('acme/api', 'tags', 'release/foo__bar', 'release/foo__bar'),
      '/gitlab/projects/acme/api/tags/release-foo-bar__release%2Ffoo__bar.json',
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

  it('round-trips complex GitLab tag refs with slashes and double underscores', () => {
    const path = computeMetadataPath('acme/api', 'tags', 'release/foo__bar', 'release/foo__bar');
    assert.strictEqual(path, '/gitlab/projects/acme/api/tags/release-foo-bar__release%2Ffoo__bar.json');
    assert.deepStrictEqual(parseGitLabPath(path), {
      path,
      projectPath: 'acme/api',
      objectType: 'tags',
      objectId: 'release/foo__bar',
      subResource: undefined,
      subResourceId: undefined,
    });
  });

  it('preserves already-composed flat record filenames for back-compat', () => {
    assert.strictEqual(
      gitLabFlatRecordFilename('ship-fix__abc123'),
      'ship-fix__abc123.json',
    );
    assert.strictEqual(
      gitLabFlatRecordFilename('ship-fix__abc123', 'Different title'),
      'ship-fix__abc123.json',
    );
    assert.strictEqual(gitLabFlatRecordFilename(12345), '12345.json');
    assert.strictEqual(gitLabFlatRecordFilename(12345, 'Production Deploy'), 'production-deploy__12345.json');

    const composedPath = computeMetadataPath('acme/api', 'deployments', 'ship-fix__abc123');
    assert.strictEqual(composedPath, '/gitlab/projects/acme/api/deployments/ship-fix__abc123.json');
    assert.deepStrictEqual(parseGitLabPath(composedPath), {
      path: composedPath,
      projectPath: 'acme/api',
      objectType: 'deployments',
      objectId: 'ship-fix__abc123',
      subResource: undefined,
      subResourceId: undefined,
    });

    const numericPath = computeMetadataPath('acme/api', 'deployments', 12345, 'Production Deploy');
    assert.deepStrictEqual(parseGitLabPath(numericPath), {
      path: numericPath,
      projectPath: 'acme/api',
      objectType: 'deployments',
      objectId: '12345',
      subResource: undefined,
      subResourceId: undefined,
    });
  });

  it('preserves flat provider ids that contain the canonical joiner', () => {
    const path = computeMetadataPath('acme/api', 'tags', 'release__candidate');
    assert.strictEqual(path, '/gitlab/projects/acme/api/tags/release__candidate.json');
    assert.deepStrictEqual(parseGitLabPath(path), {
      path,
      projectPath: 'acme/api',
      objectType: 'tags',
      objectId: 'release__candidate',
      subResource: undefined,
      subResourceId: undefined,
    });
  });

  it('escapes double-underscore directory ids as one path segment', () => {
    const path = computeMetadataPath('acme/api', 'pipelines', 'a__b/../c', 'a__b/../c');

    assert.strictEqual(path, '/gitlab/projects/acme/api/pipelines/a__b%2F..%2Fc/meta.json');
    const recordSegment = path.split('/pipelines/')[1]?.split('/')[0] ?? '';
    assert.equal(recordSegment.includes('/'), false);
    assert.equal(recordSegment.includes('../'), false);
  });

  it('parses resource-named project path segments from the right resource boundary', () => {
    const projectPath = 'org/tags/pipelines/by-ref/api';
    const tagPath = computeMetadataPath(projectPath, 'tags', 'release/foo__bar');
    assert.strictEqual(tagPath, '/gitlab/projects/org/tags/pipelines/by-ref/api/tags/release-foo-bar__release%2Ffoo__bar.json');
    assert.deepStrictEqual(parseGitLabPath(tagPath), {
      path: tagPath,
      projectPath,
      objectType: 'tags',
      objectId: 'release/foo__bar',
      subResource: undefined,
      subResourceId: undefined,
    });
    assert.strictEqual(
      computeGitLabPath('tags', `${projectPath}/tags/release/foo__bar`),
      tagPath,
    );
    assert.strictEqual(
      computeGitLabPath('tags', 'org/api/tags/release/tags/foo'),
      '/gitlab/projects/org/api/tags/release-tags-foo__release%2Ftags%2Ffoo.json',
    );
    assert.strictEqual(
      computeGitLabPath('tags', 'org/foo/tags/bar/tags/v1-0-0__v1.0.0', { ref: 'v1.0.0' }),
      '/gitlab/projects/org/foo/tags/bar/tags/v1-0-0__v1.0.0.json',
    );
    assert.strictEqual(
      computeGitLabPath('tags', 'org/foo/tags/bar/tags/v1-0-0__v1.0.0'),
      '/gitlab/projects/org/foo/tags/bar/tags/v1-0-0__v1.0.0.json',
    );
    assert.strictEqual(
      computeGitLabPath('tags', 'org/foo/tags/bar/tags/release/foo__bar'),
      '/gitlab/projects/org/foo/tags/bar/tags/release-foo-bar__release%2Ffoo__bar.json',
    );

    const pipelinePath = computeMetadataPath(projectPath, 'pipelines', 99, 'main');
    assert.deepStrictEqual(parseGitLabPath(pipelinePath), {
      path: pipelinePath,
      projectPath,
      objectType: 'pipelines',
      objectId: '99',
      subResource: 'meta.json',
      subResourceId: undefined,
    });

    const jobPath = computePipelineJobPath(projectPath, 99, 100, 'main');
    assert.deepStrictEqual(parseGitLabPath(jobPath), {
      path: jobPath,
      projectPath,
      objectType: 'pipelines',
      objectId: '99',
      subResource: 'jobs',
      subResourceId: '100',
    });

    const deploymentPath = computeMetadataPath(projectPath, 'deployments', 7);
    assert.deepStrictEqual(parseGitLabPath(deploymentPath), {
      path: deploymentPath,
      projectPath,
      objectType: 'deployments',
      objectId: '7',
      subResource: undefined,
      subResourceId: undefined,
    });
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
    assert.strictEqual(
      computeGitLabPath('tags', 'acme/api/tags/refs/tags/v1.0.0'),
      '/gitlab/projects/acme/api/tags/refs-tags-v1-0-0__refs%2Ftags%2Fv1.0.0.json',
    );
    assert.strictEqual(
      computeGitLabPath('tags', 'org/tags/api/tags/refs/tags/v1.0.0'),
      '/gitlab/projects/org/tags/api/tags/refs-tags-v1-0-0__refs%2Ftags%2Fv1.0.0.json',
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

// Regression: CORR-1 — gitLabFlatRecordFilename must stay backward-compatible
// for already-composed (id contains "__") inputs and round-trip plain ids.
describe('gitLabFlatRecordFilename round-trip (CORR-1)', () => {
  it('passes a pre-composed id (contains "__") through unchanged with no title', () => {
    assert.strictEqual(
      gitLabFlatRecordFilename('ship-fix__abc123'),
      'ship-fix__abc123.json',
    );
  });

  it('stays idempotent for a pre-composed id even when a differing title is supplied', () => {
    assert.strictEqual(
      gitLabFlatRecordFilename('ship-fix__abc123', 'Some Different Title'),
      'ship-fix__abc123.json',
    );
  });

  it('round-trips a plain numeric FLAT_RESOURCES id (deployments) with and without a title', () => {
    const withTitle = computeMetadataPath('acme/api', 'deployments', 12345, 'Prod Deploy');
    assert.strictEqual(withTitle, '/gitlab/projects/acme/api/deployments/prod-deploy__12345.json');
    assert.strictEqual(parseGitLabPath(withTitle)?.objectId, '12345');

    const noTitle = computeMetadataPath('acme/api', 'deployments', 12345);
    assert.strictEqual(noTitle, '/gitlab/projects/acme/api/deployments/12345.json');
    assert.strictEqual(parseGitLabPath(noTitle)?.objectId, '12345');
  });
});
