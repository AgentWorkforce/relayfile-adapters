import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRepoIndexFile,
  buildRepoIssuesIndexFile,
  buildRepoPullsIndexFile,
} from '../index-emitter.js';
import {
  githubIssuePath,
  githubPullRequestPath,
  githubRepositoryMetadataPath,
} from '../path-mapper.js';

describe('github index emission', () => {
  it('emits deterministic repo, issue, and pull indexes', () => {
    const repoRows = [
      { id: 'octocat/hello-world', title: 'octocat/hello-world', updated: '2026-04-03T10:00:00.000Z' },
      { id: 'acme/widgets', title: 'acme/widgets', updated: '2026-04-03T10:00:00.000Z' },
    ];
    const issueRows = [
      {
        id: '10',
        title: 'Closed issue',
        updated: '2026-04-04T12:00:00.000Z',
        number: 10,
        state: 'closed',
      },
      {
        id: '7',
        title: 'Open issue',
        updated: '2026-04-04T12:00:00.000Z',
        number: 7,
        state: 'open',
      },
    ];
    const pullRows = [
      {
        id: '12',
        title: 'Merged pull request',
        updated: '2026-04-05T12:00:00.000Z',
        number: 12,
        state: 'merged',
      },
      {
        id: '9',
        title: 'Open pull request',
        updated: '2026-04-05T12:00:00.000Z',
        number: 9,
        state: 'open',
      },
    ];

    const repoIndex = buildRepoIndexFile(repoRows);
    const repoIndexAgain = buildRepoIndexFile([...repoRows].reverse());
    const issueIndex = buildRepoIssuesIndexFile('octocat', 'hello-world', issueRows);
    const issueIndexAgain = buildRepoIssuesIndexFile('octocat', 'hello-world', [...issueRows].reverse());
    const pullIndex = buildRepoPullsIndexFile('octocat', 'hello-world', pullRows);

    assert.deepEqual(repoIndex, repoIndexAgain);
    assert.deepEqual(issueIndex, issueIndexAgain);
    assert.equal(repoIndex.path, '/github/repos/_index.json');
    assert.equal(issueIndex.path, '/github/repos/octocat/hello-world/issues/_index.json');
    assert.equal(pullIndex.path, '/github/repos/octocat/hello-world/pulls/_index.json');
    assert.equal(repoIndex.contentType, 'application/json; charset=utf-8');

    assert.deepEqual(JSON.parse(repoIndex.content), [
      { id: 'acme/widgets', title: 'acme/widgets', updated: '2026-04-03T10:00:00.000Z' },
      { id: 'octocat/hello-world', title: 'octocat/hello-world', updated: '2026-04-03T10:00:00.000Z' },
    ]);
    assert.deepEqual(JSON.parse(issueIndex.content), [
      {
        id: '7',
        title: 'Open issue',
        updated: '2026-04-04T12:00:00.000Z',
        number: 7,
        state: 'open',
      },
      {
        id: '10',
        title: 'Closed issue',
        updated: '2026-04-04T12:00:00.000Z',
        number: 10,
        state: 'closed',
      },
    ]);
    assert.deepEqual(JSON.parse(pullIndex.content), [
      {
        id: '9',
        title: 'Open pull request',
        updated: '2026-04-05T12:00:00.000Z',
        number: 9,
        state: 'open',
      },
      {
        id: '12',
        title: 'Merged pull request',
        updated: '2026-04-05T12:00:00.000Z',
        number: 12,
        state: 'merged',
      },
    ]);

    assert.equal(githubRepositoryMetadataPath('octocat', 'hello-world'), '/github/repos/octocat/hello-world/metadata.json');
    assert.equal(githubIssuePath('octocat', 'hello-world', 7), '/github/repos/octocat/hello-world/issues/7/metadata.json');
    assert.equal(githubPullRequestPath('octocat', 'hello-world', 9), '/github/repos/octocat/hello-world/pulls/9/metadata.json');
  });

  it('emits empty per-repo indexes when a repo directory has no current records', () => {
    const issueIndex = buildRepoIssuesIndexFile('octocat', 'hello-world', []);
    const pullIndex = buildRepoPullsIndexFile('octocat', 'hello-world', []);

    assert.deepEqual(JSON.parse(issueIndex.content), []);
    assert.deepEqual(JSON.parse(pullIndex.content), []);
  });
});
