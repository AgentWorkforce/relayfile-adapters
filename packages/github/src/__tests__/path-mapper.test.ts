import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeGitHubPath,
  encodeGitHubPathSegment,
  githubCheckRunPath,
  githubCommitPath,
  githubIssuePath,
  githubPullRequestPath,
  tryNormalizeGitHubObjectType,
  githubRepoPrefix,
  githubRepositoryMetadataPath,
  githubReviewCommentPath,
  githubReviewPath,
  normalizeGitHubObjectType,
  normalizeNangoGitHubModel,
  GITHUB_PATH_ROOT,
} from '../path-mapper.js';

describe('path-mapper', () => {
  describe('encodeGitHubPathSegment', () => {
    it('encodes special characters', () => {
      assert.equal(encodeGitHubPathSegment('my org'), 'my%20org');
    });

    it('trims whitespace', () => {
      assert.equal(encodeGitHubPathSegment('  hello  '), 'hello');
    });

    it('throws on empty string', () => {
      assert.throws(() => encodeGitHubPathSegment(''), /non-empty/);
    });

    it('throws on whitespace-only string', () => {
      assert.throws(() => encodeGitHubPathSegment('   '), /non-empty/);
    });
  });

  describe('normalizeGitHubObjectType', () => {
    it('normalizes pull_request variants', () => {
      assert.equal(normalizeGitHubObjectType('pull_request'), 'pull_request');
      assert.equal(normalizeGitHubObjectType('pullrequest'), 'pull_request');
      assert.equal(normalizeGitHubObjectType('pr'), 'pull_request');
      assert.equal(normalizeGitHubObjectType('pulls'), 'pull_request');
      assert.equal(normalizeGitHubObjectType('pull'), 'pull_request');
    });

    it('normalizes issue variants', () => {
      assert.equal(normalizeGitHubObjectType('issue'), 'issue');
      assert.equal(normalizeGitHubObjectType('issues'), 'issue');
    });

    it('normalizes repository variants', () => {
      assert.equal(normalizeGitHubObjectType('repository'), 'repository');
      assert.equal(normalizeGitHubObjectType('repo'), 'repository');
    });

    it('is case insensitive', () => {
      assert.equal(normalizeGitHubObjectType('PULL_REQUEST'), 'pull_request');
      assert.equal(normalizeGitHubObjectType('Issue'), 'issue');
    });

    it('throws on unsupported type', () => {
      assert.throws(() => normalizeGitHubObjectType('unknown_thing'), /Unsupported/);
    });
  });

  describe('normalizeNangoGitHubModel', () => {
    it('maps Nango PascalCase models', () => {
      assert.equal(normalizeNangoGitHubModel('Repo'), 'repository');
      assert.equal(normalizeNangoGitHubModel('Repository'), 'repository');
      assert.equal(normalizeNangoGitHubModel('PullRequest'), 'pull_request');
      assert.equal(normalizeNangoGitHubModel('Issue'), 'issue');
      assert.equal(normalizeNangoGitHubModel('Review'), 'review');
      assert.equal(normalizeNangoGitHubModel('ReviewComment'), 'review_comment');
      assert.equal(normalizeNangoGitHubModel('CheckRun'), 'check_run');
      assert.equal(normalizeNangoGitHubModel('Commit'), 'commit');
    });

    it('falls back to normalizeGitHubObjectType for lowercase', () => {
      assert.equal(normalizeNangoGitHubModel('pull_request'), 'pull_request');
      assert.equal(normalizeNangoGitHubModel('issue'), 'issue');
    });
  });

  describe('individual path functions', () => {
    it('githubRepoPrefix', () => {
      assert.equal(githubRepoPrefix('octocat', 'hello-world'), '/github/repos/octocat/hello-world');
    });

    it('githubRepoPrefix encodes special chars', () => {
      assert.equal(githubRepoPrefix('my org', 'my repo'), '/github/repos/my%20org/my%20repo');
    });

    it('githubRepositoryMetadataPath', () => {
      assert.equal(
        githubRepositoryMetadataPath('octocat', 'hello-world'),
        '/github/repos/octocat/hello-world/metadata.json',
      );
    });

    it('githubPullRequestPath', () => {
      assert.equal(
        githubPullRequestPath('octocat', 'hello-world', '42'),
        '/github/repos/octocat/hello-world/pulls/42/metadata.json',
      );
    });

    it('githubIssuePath', () => {
      assert.equal(
        githubIssuePath('octocat', 'hello-world', '7'),
        '/github/repos/octocat/hello-world/issues/7/metadata.json',
      );
    });

    it('githubReviewPath', () => {
      assert.equal(
        githubReviewPath('octocat', 'hello-world', '123'),
        '/github/repos/octocat/hello-world/reviews/123.json',
      );
    });

    it('githubReviewCommentPath', () => {
      assert.equal(
        githubReviewCommentPath('octocat', 'hello-world', '456'),
        '/github/repos/octocat/hello-world/comments/456.json',
      );
    });

    it('githubCheckRunPath', () => {
      assert.equal(
        githubCheckRunPath('octocat', 'hello-world', '789'),
        '/github/repos/octocat/hello-world/checks/789.json',
      );
    });

    it('githubCommitPath', () => {
      assert.equal(
        githubCommitPath('octocat', 'hello-world', 'abc123'),
        '/github/repos/octocat/hello-world/commits/abc123/metadata.json',
      );
    });
  });

  describe('computeGitHubPath', () => {
    it('computes pull_request path with context', () => {
      assert.equal(
        computeGitHubPath('pull_request', '42', { owner: 'octocat', repo: 'hello-world' }),
        '/github/repos/octocat/hello-world/pulls/42/metadata.json',
      );
    });

    it('computes issue path with context', () => {
      assert.equal(
        computeGitHubPath('issue', '7', { owner: 'octocat', repo: 'hello-world' }),
        '/github/repos/octocat/hello-world/issues/7/metadata.json',
      );
    });

    it('computes repository path with context', () => {
      assert.equal(
        computeGitHubPath('repository', 'octocat/hello-world', { owner: 'octocat', repo: 'hello-world' }),
        '/github/repos/octocat/hello-world/metadata.json',
      );
    });

    it('computes review path with context', () => {
      assert.equal(
        computeGitHubPath('review', '99', { owner: 'octocat', repo: 'hello-world' }),
        '/github/repos/octocat/hello-world/reviews/99.json',
      );
    });

    it('computes check_run path with context', () => {
      assert.equal(
        computeGitHubPath('check_run', '555', { owner: 'octocat', repo: 'hello-world' }),
        '/github/repos/octocat/hello-world/checks/555.json',
      );
    });

    it('computes commit path with context', () => {
      assert.equal(
        computeGitHubPath('commit', 'deadbeef', { owner: 'octocat', repo: 'hello-world' }),
        '/github/repos/octocat/hello-world/commits/deadbeef/metadata.json',
      );
    });

    it('falls back to generic path without owner', () => {
      assert.equal(
        computeGitHubPath('pull_request', '42', { repo: 'hello-world' }),
        '/github/pull_request/42.json',
      );
    });

    it('falls back to generic path without repo', () => {
      assert.equal(
        computeGitHubPath('issue', '7', { owner: 'octocat' }),
        '/github/issue/7.json',
      );
    });

    it('falls back to generic path without context', () => {
      assert.equal(
        computeGitHubPath('pull_request', '42'),
        '/github/pull_request/42.json',
      );
    });

    it('normalizes object type aliases', () => {
      assert.equal(
        computeGitHubPath('pr', '42', { owner: 'o', repo: 'r' }),
        '/github/repos/o/r/pulls/42/metadata.json',
      );
      assert.equal(
        computeGitHubPath('pulls', '42', { owner: 'o', repo: 'r' }),
        '/github/repos/o/r/pulls/42/metadata.json',
      );
    });

    it('uses GITHUB_PATH_ROOT constant', () => {
      assert.equal(GITHUB_PATH_ROOT, '/github');
    });

    it('returns fallback path for unknown object types instead of throwing', () => {
      assert.equal(
        computeGitHubPath('events', 'star.created', { owner: 'o', repo: 'r' }),
        '/github/events/star.created.json',
      );
    });

    it('returns fallback path for unknown type without context', () => {
      assert.equal(
        computeGitHubPath('deployments', 'dep-123'),
        '/github/deployments/dep-123.json',
      );
    });

    it('sanitizes unknown type names', () => {
      assert.equal(
        computeGitHubPath('some weird/type', 'id-1'),
        '/github/some_weird_type/id-1.json',
      );
    });
  });

  describe('tryNormalizeGitHubObjectType', () => {
    it('returns the normalized type for known types', () => {
      assert.equal(tryNormalizeGitHubObjectType('pull_request'), 'pull_request');
      assert.equal(tryNormalizeGitHubObjectType('pr'), 'pull_request');
      assert.equal(tryNormalizeGitHubObjectType('issue'), 'issue');
    });

    it('returns undefined for unknown types', () => {
      assert.equal(tryNormalizeGitHubObjectType('events'), undefined);
      assert.equal(tryNormalizeGitHubObjectType('deployments'), undefined);
    });
  });
});
