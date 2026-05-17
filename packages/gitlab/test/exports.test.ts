import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
});
