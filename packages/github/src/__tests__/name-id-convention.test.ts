import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';
import test from 'node:test';

import { buildVFSPath } from '../pr/file-mapper.js';
import {
  githubIssuePath,
  githubNumberSlug,
  githubPullRequestPath,
  githubPullRequestRoot,
  parseNameWithId,
} from '../path-mapper.js';

test('GitHub PR and issue directories use <number>__<slug> while nested file names remain literal', () => {
  const prPath = githubPullRequestPath('octocat', 'hello-world', 42, 'Ship cleaner path names');
  const issuePath = githubIssuePath('octocat', 'hello-world', 7, 'Track adapter issue ingestion coverage');
  const nestedFile = buildVFSPath('octocat', 'hello-world', 42, 'files/src/index.ts', 'Ship cleaner path names');

  assert.equal(prPath, '/github/repos/octocat/hello-world/pulls/42__ship-cleaner-path-names/meta.json');
  assert.equal(issuePath, '/github/repos/octocat/hello-world/issues/7__track-adapter-issue-ingestion-coverage/meta.json');
  assert.equal(nestedFile, '/github/repos/octocat/hello-world/pulls/42__ship-cleaner-path-names/files/src/index.ts');
});

test('GitHub parseNameWithId recovers the numeric id from the directory name', () => {
  const path = githubPullRequestPath('octocat', 'hello-world', 42, 'Ship cleaner path names');
  const parsed = parseNameWithId(basename(dirname(path)));

  assert.deepEqual(parsed, {
    humanReadable: 'ship-cleaner-path-names',
    id: '42',
    ext: null,
  });
});

test('GitHub directory names are stable across re-ingest and collision suffixes are deterministic', () => {
  const first = githubPullRequestRoot('octocat', 'hello-world', 42, 'Ship cleaner path names');
  const second = githubPullRequestRoot('octocat', 'hello-world', 42, 'Ship cleaner path names');
  const seenNames = new Set<string>(['42__ship-cleaner-path-names']);
  const collision = githubNumberSlug(42, 'Ship cleaner path names', { existingNames: seenNames });
  const expectedHash = createHash('sha256').update('42').digest('hex').slice(0, 8);

  assert.equal(first, second);
  assert.equal(collision, `42__ship-cleaner-path-names-${expectedHash}`);
});

test('GitHub drops the separator when there is no usable title slug', () => {
  const prPath = githubPullRequestPath('octocat', 'hello-world', 42);
  const issuePath = githubIssuePath('octocat', 'hello-world', 7, '!!!');
  const nestedFile = buildVFSPath('octocat', 'hello-world', 42, 'files/src/index.ts');

  assert.equal(prPath, '/github/repos/octocat/hello-world/pulls/42/meta.json');
  assert.equal(issuePath, '/github/repos/octocat/hello-world/issues/7/meta.json');
  assert.equal(nestedFile, '/github/repos/octocat/hello-world/pulls/42/files/src/index.ts');
  assert.deepEqual(parseNameWithId('42'), {
    humanReadable: null,
    id: '42',
    ext: null,
  });
});
