import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeGitHubPath,
  encodeGitHubPathSegment,
  githubAliasRepoPrefix,
  githubByAssigneeAliasPath,
  githubByCreatorAliasPath,
  githubByEditedAliasPath,
  githubByIdAliasPath,
  githubByPriorityAliasPath,
  githubByStateAliasPath,
  githubByTitleAliasPath,
  githubCheckRunPath,
  githubCommitPath,
  githubDeploymentStatusPath,
  githubIssueCommentLegacyPath,
  githubIssueCommentPath,
  githubIssueCommentReadCandidatePaths,
  githubIssuePath,
  githubLegacyByTitleAliasPath,
  githubNumberedByTitleAliasPath,
  githubPullRequestPath,
  githubRefPath,
  tryNormalizeGitHubObjectType,
  githubRepoPrefix,
  githubRepositoryMetaPath,
  githubRepositoryMetadataPath,
  githubReviewCommentPath,
  githubReviewPath,
  githubRootIndexPath,
  normalizeGitHubObjectType,
  normalizeNangoGitHubModel,
  parseGitHubIssuePath,
  parseGitHubPullPath,
  parseGitHubRefPath,
  parseGitHubRepoPath,
  GITHUB_PATH_ROOT,
  normalizeGitHubRef,
} from '../path-mapper.js';
import { mapIssueComment } from '../issues/comment-mapper.js';

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

  describe('GitHub ref paths', () => {
    it('normalizes branch names and round-trips canonical ref identities', () => {
      assert.equal(normalizeGitHubRef('feature/52'), 'refs/heads/feature/52');
      const path = githubRefPath('octocat', 'hello-world', 'feature/52');
      assert.equal(
        path,
        '/github/repos/octocat/hello-world/refs/refs%2Fheads%2Ffeature%2F52.json',
      );
      assert.deepEqual(parseGitHubRefPath(path), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'refs/refs%2Fheads%2Ffeature%2F52.json',
        ref: 'refs/heads/feature/52',
      });
    });

    it('rejects draft and malformed ref paths', () => {
      assert.equal(parseGitHubRefPath('/github/repos/octocat/hello-world/refs/draft.json'), undefined);
      assert.throws(() => normalizeGitHubRef(''), /non-empty ref/u);
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
      assert.equal(normalizeNangoGitHubModel('DeploymentStatus'), 'deployment_status');
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

    it('githubAliasRepoPrefix uses a double underscore between owner and repo', () => {
      assert.equal(githubAliasRepoPrefix('octocat', 'hello-world'), '/github/repos/octocat__hello-world');
    });

    it('githubRepoPrefix encodes special chars', () => {
      assert.equal(githubRepoPrefix('my org', 'my repo'), '/github/repos/my%20org/my%20repo');
    });

    it('githubRepositoryMetaPath', () => {
      assert.equal(
        githubRepositoryMetaPath('octocat', 'hello-world'),
        '/github/repos/octocat/hello-world/meta.json',
      );
    });

    it('githubRepositoryMetadataPath is retained for legacy compatibility', () => {
      assert.equal(
        githubRepositoryMetadataPath('octocat', 'hello-world'),
        '/github/repos/octocat/hello-world/metadata.json',
      );
    });

    it('githubPullRequestPath', () => {
      assert.equal(
        githubPullRequestPath('octocat', 'hello-world', '42'),
        '/github/repos/octocat/hello-world/pulls/42/meta.json',
      );
    });

    it('githubIssuePath', () => {
      assert.equal(
        githubIssuePath('octocat', 'hello-world', '7'),
        '/github/repos/octocat/hello-world/issues/7/meta.json',
      );
    });

    it('githubReviewPath', () => {
      assert.equal(
        githubReviewPath('octocat', 'hello-world', '123'),
        '/github/repos/octocat/hello-world/reviews/123.json',
      );
      const encoded = githubReviewPath('octocat', 'hello-world', '../issues/owned');
      assert.equal(encoded, '/github/repos/octocat/hello-world/reviews/..%2Fissues%2Fowned.json');
      assert.equal(encoded.includes('/../'), false);
    });

    it('githubReviewCommentPath', () => {
      assert.equal(
        githubReviewCommentPath('octocat', 'hello-world', '456'),
        '/github/repos/octocat/hello-world/comments/456.json',
      );
      const encoded = githubReviewCommentPath('octocat', 'hello-world', 'a/b');
      assert.equal(encoded, '/github/repos/octocat/hello-world/comments/a%2Fb.json');
      assert.equal(encoded.includes('/a/b'), false);
    });

    it('githubCheckRunPath', () => {
      assert.equal(
        githubCheckRunPath('octocat', 'hello-world', '789'),
        '/github/repos/octocat/hello-world/checks/789.json',
      );
      assert.equal(
        githubCheckRunPath('octocat', 'hello-world', '1/2'),
        '/github/repos/octocat/hello-world/checks/1%2F2.json',
      );
    });

    it('githubDeploymentStatusPath', () => {
      assert.equal(
        githubDeploymentStatusPath('octocat', 'hello-world', '42', '789'),
        '/github/repos/octocat/hello-world/deployments/42/statuses/789.json',
      );
      assert.equal(
        githubDeploymentStatusPath('octocat', 'hello-world', 'deploy/1', 'status/2'),
        '/github/repos/octocat/hello-world/deployments/deploy%2F1/statuses/status%2F2.json',
      );
    });

    it('githubCommitPath', () => {
      assert.equal(
        githubCommitPath('octocat', 'hello-world', 'abc123'),
        '/github/repos/octocat/hello-world/commits/abc123/metadata.json',
      );
      const encoded = githubCommitPath('octocat', 'hello-world', 'a/b');
      assert.equal(encoded, '/github/repos/octocat/hello-world/commits/a%2Fb/metadata.json');
      assert.equal(encoded.includes('/a/b/'), false);
    });

    it('githubRootIndexPath', () => {
      assert.equal(githubRootIndexPath(), '/github/_index.json');
    });

    it('maps alias paths under the combined repo segment', () => {
      assert.equal(
        githubByTitleAliasPath('octocat', 'hello-world', 'issues', 'Shared title', 7),
        '/github/repos/octocat__hello-world/issues/by-title/shared-title.json',
      );
      assert.equal(
        githubNumberedByTitleAliasPath('octocat', 'hello-world', 'issues', 'Shared title', 7),
        '/github/repos/octocat__hello-world/issues/by-title/shared-title__7.json',
      );
      assert.equal(
        githubByIdAliasPath('octocat', 'hello-world', 'pulls', 42),
        '/github/repos/octocat__hello-world/pulls/by-id/42.json',
      );
      assert.equal(
        githubByStateAliasPath('octocat', 'hello-world', 'issues', 'in progress', 7),
        '/github/repos/octocat__hello-world/issues/by-state/in-progress/7.json',
      );
      assert.equal(
        githubByAssigneeAliasPath('octocat', 'hello-world', 'issues', 'Mona Lisa', 7),
        '/github/repos/octocat__hello-world/issues/by-assignee/mona-lisa/7.json',
      );
      assert.equal(
        githubByCreatorAliasPath('octocat', 'hello-world', 'pulls', 'octocat', 42),
        '/github/repos/octocat__hello-world/pulls/by-creator/octocat/42.json',
      );
      assert.equal(
        githubByPriorityAliasPath('octocat', 'hello-world', 'issues', 'P0 Critical', 7),
        '/github/repos/octocat__hello-world/issues/by-priority/p0-critical/7.json',
      );
      assert.equal(
        githubByEditedAliasPath('octocat', 'hello-world', 'pulls', '2026-05-12', 42),
        '/github/repos/octocat__hello-world/pulls/by-edited/2026-05-12/42.json',
      );
      assert.equal(
        decodeURIComponent(
          githubByEditedAliasPath('my org', 'my repo', 'issues', '2026-05-12', '7/8')
            .split('/')
            .pop()!
            .replace(/\.json$/u, ''),
        ),
        '7/8',
      );
    });

    it('keys by-title aliases by stable number so duplicate titles do not collide', () => {
      const first = githubNumberedByTitleAliasPath('octocat', 'hello-world', 'issues', 'Shared title', 7);
      const second = githubNumberedByTitleAliasPath('octocat', 'hello-world', 'issues', 'Shared title', 8);

      assert.equal(first, '/github/repos/octocat__hello-world/issues/by-title/shared-title__7.json');
      assert.equal(second, '/github/repos/octocat__hello-world/issues/by-title/shared-title__8.json');
      assert.notEqual(first, second);
      assert.equal(
        githubLegacyByTitleAliasPath('octocat', 'hello-world', 'issues', 'Shared title', 7),
        '/github/repos/octocat__hello-world/issues/by-title/shared-title.json',
      );
    });
  });

  describe('computeGitHubPath', () => {
    it('computes pull_request path with context', () => {
      assert.equal(
        computeGitHubPath('pull_request', '42', { owner: 'octocat', repo: 'hello-world' }),
        '/github/repos/octocat/hello-world/pulls/42/meta.json',
      );
    });

    it('computes issue path with context', () => {
      assert.equal(
        computeGitHubPath('issue', '7', { owner: 'octocat', repo: 'hello-world' }),
        '/github/repos/octocat/hello-world/issues/7/meta.json',
      );
    });

    it('computes repository path with context', () => {
      assert.equal(
        computeGitHubPath('repository', 'octocat/hello-world', { owner: 'octocat', repo: 'hello-world' }),
        '/github/repos/octocat/hello-world/meta.json',
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

    it('computes deployment_status path with context', () => {
      assert.equal(
        computeGitHubPath('deployment_status', '555', {
          owner: 'octocat',
          repo: 'hello-world',
          deploymentId: '42',
        }),
        '/github/repos/octocat/hello-world/deployments/42/statuses/555.json',
      );
    });

    it('falls back to a placeholder deployment root without deployment context', () => {
      assert.equal(
        computeGitHubPath('deployment_status', '555', { owner: 'octocat', repo: 'hello-world' }),
        '/github/repos/octocat/hello-world/deployments/deployment-unknown/statuses/555.json',
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
        '/github/repos/o/r/pulls/42/meta.json',
      );
      assert.equal(
        computeGitHubPath('pulls', '42', { owner: 'o', repo: 'r' }),
        '/github/repos/o/r/pulls/42/meta.json',
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
      assert.equal(tryNormalizeGitHubObjectType('deployment_status'), 'deployment_status');
    });

    it('returns undefined for unknown types', () => {
      assert.equal(tryNormalizeGitHubObjectType('events'), undefined);
      assert.equal(tryNormalizeGitHubObjectType('deployments'), undefined);
    });
  });

  describe('githubIssueCommentPath', () => {
    it('is a directory record and cannot collide with child records under the comment id', () => {
      const comment = githubIssueCommentPath('octocat', 'hello-world', 10, 7001, 'Fix login bug');
      assert.equal(
        comment,
        '/github/repos/octocat/hello-world/issues/10__fix-login-bug/comments/7001/meta.json',
      );

      // A comment's children (e.g. per-comment reactions, which GitHub exposes
      // at /repos/{o}/{r}/issues/comments/{id}/reactions) must nest UNDER the
      // comment's directory — never as a sibling that shares the comment's
      // name with a different node type. This is the invariant whose violation
      // wedges a POSIX mount: a flat leaf file `comments/<id>.json` cannot
      // coexist with a `comments/<id>/` directory
      // (`mkdir ... : not a directory`).
      const commentDir = comment.replace(/\/meta\.json$/u, '');
      assert.ok(commentDir.endsWith('/comments/7001'), 'comment stem is the directory key');
      const hypotheticalReaction = `${commentDir}/reactions/+1--octocat.json`;
      assert.ok(
        hypotheticalReaction.startsWith(`${commentDir}/`),
        'children must nest under the comment directory',
      );
      assert.notEqual(
        comment,
        githubIssueCommentLegacyPath('octocat', 'hello-world', 10, 7001, 'Fix login bug'),
        'comment stem must be a directory record, not the flat .json leaf',
      );

      // Back-compat: readers can still resolve a comment mirrored by a
      // pre-migration adapter at the legacy flat path.
      assert.deepEqual(
        githubIssueCommentReadCandidatePaths('octocat', 'hello-world', 10, 7001, 'Fix login bug'),
        [comment, githubIssueCommentLegacyPath('octocat', 'hello-world', 10, 7001, 'Fix login bug')],
      );
      assert.equal(
        githubIssueCommentLegacyPath('octocat', 'hello-world', 10, 7001, 'Fix login bug'),
        '/github/repos/octocat/hello-world/issues/10__fix-login-bug/comments/7001.json',
      );
    });

    it('agrees with mapIssueComment on the canonical record path', () => {
      const mapped = mapIssueComment(
        { id: 7001, body: 'Looks good', user: { login: 'octocat' } },
        'octocat',
        'hello-world',
        10,
        'Fix login bug',
      );
      assert.equal(
        `/github/repos/octocat/hello-world/${mapped.vfsPath}`,
        githubIssueCommentPath('octocat', 'hello-world', 10, 7001, 'Fix login bug'),
      );
    });
  });

  describe('shared GitHub read-mount path parsers', () => {
    it('parses split repository paths', () => {
      assert.deepEqual(parseGitHubRepoPath('/github/repos/octocat/hello-world/issues/42/meta.json'), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'issues/42/meta.json',
      });
    });

    it('parses compact repository alias paths', () => {
      assert.deepEqual(parseGitHubRepoPath('/github/repos/octocat__hello-world/issues/by-id/42.json'), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'issues/by-id/42.json',
      });
    });

    it('parses encoded repository segments', () => {
      assert.deepEqual(parseGitHubRepoPath('/github/repos/my%20org/my%20repo/pulls/7/meta.json'), {
        owner: 'my org',
        repo: 'my repo',
        rest: 'pulls/7/meta.json',
      });
    });

    it('rejects non-repository paths and invalid encodings', () => {
      assert.equal(parseGitHubRepoPath('/github/repos/_index.json'), undefined);
      assert.equal(parseGitHubRepoPath('/linear/issues/1.json'), undefined);
      assert.equal(parseGitHubRepoPath('/github/repos/%E0%A4%A/repo/issues/1.json'), undefined);
      assert.equal(parseGitHubRepoPath('/github/repos/octo%2Fcat/hello-world/issues/1.json'), undefined);
    });

    it('parses issue mapper output under the split owner/repo tree', () => {
      const path = githubIssuePath('octocat', 'hello-world', 7, 'Track adapter issue ingestion coverage');
      assert.deepEqual(parseGitHubIssuePath(path), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'issues/7__track-adapter-issue-ingestion-coverage/meta.json',
        kind: 'issues',
        number: 7,
        numberText: '7',
        recordSegment: '7__track-adapter-issue-ingestion-coverage',
        shape: 'directory-record',
        subpath: 'meta.json',
      });
    });

    it('parses issue by-id aliases generated by the mapper under compact owner__repo', () => {
      const path = githubByIdAliasPath('octocat', 'hello-world', 'issues', 7);
      assert.deepEqual(parseGitHubIssuePath(path), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'issues/by-id/7.json',
        kind: 'issues',
        number: 7,
        numberText: '7',
        recordSegment: '7.json',
        shape: 'alias',
        subpath: '7.json',
        aliasKey: 'by-id',
      });
    });

    it('parses issue flat records and legacy directory metadata records', () => {
      assert.deepEqual(parseGitHubIssuePath('/github/repos/octocat/hello-world/issues/7.json'), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'issues/7.json',
        kind: 'issues',
        number: 7,
        numberText: '7',
        recordSegment: '7.json',
        shape: 'flat-record',
        subpath: '',
      });
      assert.deepEqual(parseGitHubIssuePath('/github/repos/octocat/hello-world/issues/7/metadata.json'), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'issues/7/metadata.json',
        kind: 'issues',
        number: 7,
        numberText: '7',
        recordSegment: '7',
        shape: 'legacy-directory-record',
        subpath: 'metadata.json',
      });
    });

    it('parses issue child paths anchored by the issue directory', () => {
      const path = githubIssueCommentPath('octocat', 'hello-world', 10, 7001, 'Fix login bug');
      assert.deepEqual(parseGitHubIssuePath(path), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'issues/10__fix-login-bug/comments/7001/meta.json',
        kind: 'issues',
        number: 10,
        numberText: '10',
        recordSegment: '10__fix-login-bug',
        shape: 'directory-record',
        subpath: 'comments/7001/meta.json',
      });
    });

    it('parses pull request mapper output under the split owner/repo tree', () => {
      const path = githubPullRequestPath('octocat', 'hello-world', 42, 'Ship cleaner path names');
      assert.deepEqual(parseGitHubPullPath(path), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'pulls/42__ship-cleaner-path-names/meta.json',
        kind: 'pulls',
        number: 42,
        numberText: '42',
        recordSegment: '42__ship-cleaner-path-names',
        shape: 'directory-record',
        subpath: 'meta.json',
      });
    });

    it('parses pull request by-id aliases generated by the mapper under compact owner__repo', () => {
      const path = githubByIdAliasPath('octocat', 'hello-world', 'pulls', 42);
      assert.deepEqual(parseGitHubPullPath(path), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'pulls/by-id/42.json',
        kind: 'pulls',
        number: 42,
        numberText: '42',
        recordSegment: '42.json',
        shape: 'alias',
        subpath: '42.json',
        aliasKey: 'by-id',
      });
    });

    it('parses pull request flat records and legacy directory metadata records', () => {
      assert.deepEqual(parseGitHubPullPath('/github/repos/octocat/hello-world/pulls/42.json'), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'pulls/42.json',
        kind: 'pulls',
        number: 42,
        numberText: '42',
        recordSegment: '42.json',
        shape: 'flat-record',
        subpath: '',
      });
      assert.deepEqual(parseGitHubPullPath('/github/repos/octocat/hello-world/pulls/42/metadata.json'), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'pulls/42/metadata.json',
        kind: 'pulls',
        number: 42,
        numberText: '42',
        recordSegment: '42',
        shape: 'legacy-directory-record',
        subpath: 'metadata.json',
      });
    });

    it('parses pull request child artifact paths anchored by the pull directory', () => {
      assert.deepEqual(
        parseGitHubPullPath('/github/repos/octocat/hello-world/pulls/42__ship-cleaner-path-names/files/src/index.ts'),
        {
          owner: 'octocat',
          repo: 'hello-world',
          rest: 'pulls/42__ship-cleaner-path-names/files/src/index.ts',
          kind: 'pulls',
          number: 42,
          numberText: '42',
          recordSegment: '42__ship-cleaner-path-names',
          shape: 'directory-record',
          subpath: 'files/src/index.ts',
        },
      );
    });

    it('parses title and bucket aliases when the number is recoverable', () => {
      assert.deepEqual(parseGitHubIssuePath(githubNumberedByTitleAliasPath('octocat', 'hello-world', 'issues', 'Fix bug', 7)), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'issues/by-title/fix-bug__7.json',
        kind: 'issues',
        number: 7,
        numberText: '7',
        recordSegment: 'fix-bug__7.json',
        shape: 'alias',
        subpath: 'fix-bug__7.json',
        aliasKey: 'by-title',
      });
      assert.deepEqual(parseGitHubPullPath(githubByStateAliasPath('octocat', 'hello-world', 'pulls', 'open', 42)), {
        owner: 'octocat',
        repo: 'hello-world',
        rest: 'pulls/by-state/open/42.json',
        kind: 'pulls',
        number: 42,
        numberText: '42',
        recordSegment: '42.json',
        shape: 'alias',
        subpath: 'open/42.json',
        aliasKey: 'by-state',
      });
    });

    it('parses every generated compact issue alias family with recoverable numbers', () => {
      const cases = [
        [githubByIdAliasPath('octocat', 'hello-world', 'issues', 7), 'by-id', '7.json'],
        [githubNumberedByTitleAliasPath('octocat', 'hello-world', 'issues', 'Fix bug', 7), 'by-title', 'fix-bug__7.json'],
        [githubByStateAliasPath('octocat', 'hello-world', 'issues', 'open', 7), 'by-state', 'open/7.json'],
        [githubByAssigneeAliasPath('octocat', 'hello-world', 'issues', 'Mona Lisa', 7), 'by-assignee', 'mona-lisa/7.json'],
        [githubByCreatorAliasPath('octocat', 'hello-world', 'issues', 'Hubot', 7), 'by-creator', 'hubot/7.json'],
        [githubByPriorityAliasPath('octocat', 'hello-world', 'issues', 'P0 Critical', 7), 'by-priority', 'p0-critical/7.json'],
        [githubByEditedAliasPath('octocat', 'hello-world', 'issues', '2026-05-12', 7), 'by-edited', '2026-05-12/7.json'],
      ] as const;

      for (const [path, aliasKey, subpath] of cases) {
        assert.deepEqual(parseGitHubIssuePath(path), {
          owner: 'octocat',
          repo: 'hello-world',
          rest: `issues/${aliasKey}/${subpath}`,
          kind: 'issues',
          number: 7,
          numberText: '7',
          recordSegment: subpath.split('/').at(-1),
          shape: 'alias',
          subpath,
          aliasKey,
        });
      }
    });

    it('parses every generated compact pull request alias family with recoverable numbers', () => {
      const cases = [
        [githubByIdAliasPath('octocat', 'hello-world', 'pulls', 42), 'by-id', '42.json'],
        [githubNumberedByTitleAliasPath('octocat', 'hello-world', 'pulls', 'Ship cleaner path names', 42), 'by-title', 'ship-cleaner-path-names__42.json'],
        [githubByStateAliasPath('octocat', 'hello-world', 'pulls', 'open', 42), 'by-state', 'open/42.json'],
        [githubByAssigneeAliasPath('octocat', 'hello-world', 'pulls', 'Mona Lisa', 42), 'by-assignee', 'mona-lisa/42.json'],
        [githubByCreatorAliasPath('octocat', 'hello-world', 'pulls', 'Hubot', 42), 'by-creator', 'hubot/42.json'],
        [githubByPriorityAliasPath('octocat', 'hello-world', 'pulls', 'P0 Critical', 42), 'by-priority', 'p0-critical/42.json'],
        [githubByEditedAliasPath('octocat', 'hello-world', 'pulls', '2026-05-12', 42), 'by-edited', '2026-05-12/42.json'],
      ] as const;

      for (const [path, aliasKey, subpath] of cases) {
        assert.deepEqual(parseGitHubPullPath(path), {
          owner: 'octocat',
          repo: 'hello-world',
          rest: `pulls/${aliasKey}/${subpath}`,
          kind: 'pulls',
          number: 42,
          numberText: '42',
          recordSegment: subpath.split('/').at(-1),
          shape: 'alias',
          subpath,
          aliasKey,
        });
      }
    });

    it('rejects mismatched resources and aliases without a recoverable number', () => {
      assert.equal(parseGitHubIssuePath('/github/repos/octocat/hello-world/pulls/42/meta.json'), undefined);
      assert.equal(parseGitHubPullPath('/github/repos/octocat/hello-world/issues/7/meta.json'), undefined);
      assert.equal(parseGitHubIssuePath(githubLegacyByTitleAliasPath('octocat', 'hello-world', 'issues', 'Fix bug', 7)), undefined);
      assert.equal(parseGitHubIssuePath('/github/repos/octocat/hello-world/issues/0/meta.json'), undefined);
      assert.equal(parseGitHubIssuePath('/github/repos/octocat/hello-world/issues/not-a-number/meta.json'), undefined);
      assert.equal(parseGitHubIssuePath('/github/repos/octocat/hello-world/issues/7.json/comments/1.json'), undefined);
    });
  });
});
