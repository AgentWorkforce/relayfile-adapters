import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeIssueCreateDraftPath,
  computeMergeRequestClosePath,
  computeMergeRequestCreateDraftPath,
  computeMergeRequestMergePath,
  computeRefCreateDraftPath,
  gitLabByAssigneeAliasPath,
  gitLabByCreatorAliasPath,
  gitLabByPriorityAliasPath,
  gitLabProjectMetadataPath,
  normalizeGitLabTagRef,
} from '../src/index.js';

test('package root exports GitLab path helper surface', () => {
  assert.equal(normalizeGitLabTagRef('refs/tags/release/v1'), 'release/v1');
  assert.equal(
    gitLabProjectMetadataPath('acme/api'),
    '/gitlab/projects/acme/api/meta.json',
  );
  assert.equal(
    gitLabByAssigneeAliasPath('acme/api', 'issues', 'Ada Lovelace', 7),
    '/gitlab/projects/acme/api/issues/by-assignee/ada-lovelace/7.json',
  );
  assert.equal(
    gitLabByCreatorAliasPath('acme/api', 'merge_requests', 'linus', 42),
    '/gitlab/projects/acme/api/merge_requests/by-creator/linus/42.json',
  );
  assert.equal(
    gitLabByPriorityAliasPath('acme/api', 'issues', 'priority::high', 7),
    '/gitlab/projects/acme/api/issues/by-priority/priority-high/7.json',
  );
  assert.equal(
    computeIssueCreateDraftPath('acme/api', 'create-issue'),
    '/gitlab/projects/acme/api/issues/create-issue.json',
  );
  assert.equal(
    computeMergeRequestCreateDraftPath('acme/api', 'create-merge-request'),
    '/gitlab/projects/acme/api/merge-requests/create-merge-request.json',
  );
  assert.equal(
    computeRefCreateDraftPath('acme/api', 'factory/branch'),
    '/gitlab/projects/acme/api/refs/factory%2Fbranch.json',
  );
  assert.equal(
    computeMergeRequestMergePath('acme/api', 42, 'Add OAuth'),
    '/gitlab/projects/acme/api/merge_requests/42__add-oauth/merge.json',
  );
  assert.equal(
    computeMergeRequestClosePath('acme/api', 42, 'Add OAuth'),
    '/gitlab/projects/acme/api/merge_requests/42__add-oauth/close.json',
  );
});
