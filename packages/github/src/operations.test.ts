import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getPull,
  getPullDiff,
  getRepository,
  listComments,
  listIssues,
  listOrgs,
  listPullRequests,
  listReleases,
  listRepos,
  searchIssues,
  searchRepos,
  type GitHubOperation,
  type GitHubRepoRef,
} from './operations.js';

describe('operations', () => {
  it('listIssues builds the issues endpoint with joined labels and pagination', () => {
    const operation = listIssues({
      owner: 'AgentWorkforce',
      repo: 'cloud',
      state: 'open',
      labels: ['bug', 'p1'],
      since: '2026-01-01T00:00:00Z',
      per_page: 50,
      page: 2,
    });

    assert.strictEqual(operation.method, 'GET');
    assert.strictEqual(operation.path, '/repos/AgentWorkforce/cloud/issues');
    assert.deepStrictEqual(operation.query, {
      state: 'open',
      labels: 'bug,p1',
      since: '2026-01-01T00:00:00Z',
      per_page: 50,
      page: 2,
    });
  });

  it('listPullRequests preserves query filters for the pulls endpoint', () => {
    const operation = listPullRequests({
      owner: 'AgentWorkforce',
      repo: 'cloud',
      state: 'closed',
      base: 'main',
      head: 'AgentWorkforce:feature/refactor-adapter',
      sort: 'updated',
      direction: 'desc',
      per_page: 25,
      page: 4,
    });

    assert.strictEqual(operation.method, 'GET');
    assert.strictEqual(operation.path, '/repos/AgentWorkforce/cloud/pulls');
    assert.deepStrictEqual(operation.query, {
      state: 'closed',
      base: 'main',
      head: 'AgentWorkforce:feature/refactor-adapter',
      sort: 'updated',
      direction: 'desc',
      per_page: 25,
      page: 4,
    });
  });

  it('listComments targets issue comments and preserves comment pagination filters', () => {
    const operation = listComments({
      owner: 'AgentWorkforce',
      repo: 'cloud',
      number: 42,
      since: '2026-02-15T10:00:00Z',
      per_page: 30,
      page: 3,
    });

    assert.strictEqual(operation.method, 'GET');
    assert.strictEqual(operation.path, '/repos/AgentWorkforce/cloud/issues/42/comments');
    assert.deepStrictEqual(operation.query, {
      since: '2026-02-15T10:00:00Z',
      per_page: 30,
      page: 3,
    });
  });

  it('listReleases targets the repository releases endpoint', () => {
    const operation = listReleases({
      owner: 'AgentWorkforce',
      repo: 'cloud',
    });

    assert.strictEqual(operation.method, 'GET');
    assert.strictEqual(operation.path, '/repos/AgentWorkforce/cloud/releases');
    assert.deepStrictEqual(operation.query, { per_page: 100 });
  });

  it('getRepository targets the repository metadata endpoint', () => {
    const operation = getRepository({
      owner: 'AgentWorkforce',
      repo: 'cloud',
    });

    assert.strictEqual(operation.method, 'GET');
    assert.strictEqual(operation.path, '/repos/AgentWorkforce/cloud');
    assert.strictEqual(operation.query, undefined);
  });

  it('listOrgs targets the authenticated user orgs endpoint with pagination', () => {
    const operation = listOrgs({
      per_page: 25,
      page: 3,
    });

    assert.strictEqual(operation.method, 'GET');
    assert.strictEqual(operation.path, '/user/orgs');
    assert.deepStrictEqual(operation.query, {
      per_page: 25,
      page: 3,
    });
  });

  it('listRepos switches between user repos and org repos endpoints', () => {
    const userRepos = listRepos();
    const orgRepos = listRepos({ org: 'AgentWorkforce' });

    assert.strictEqual(userRepos.method, 'GET');
    assert.strictEqual(userRepos.path, '/user/repos');
    assert.deepStrictEqual(userRepos.query, { per_page: 100 });

    assert.strictEqual(orgRepos.method, 'GET');
    assert.strictEqual(orgRepos.path, '/orgs/AgentWorkforce/repos');
    assert.deepStrictEqual(orgRepos.query, { per_page: 100 });
  });

  it('encodes owner, repo, and org path segments and omits undefined query values', () => {
    const repoOperation = listPullRequests({
      owner: 'Agent Workforce',
      repo: 'cloud/api',
      state: undefined,
      base: undefined,
      head: 'AgentWorkforce:feature/refactor-adapter',
      sort: undefined,
      direction: undefined,
      page: undefined,
      per_page: 20,
    });
    const orgOperation = listRepos({
      org: 'Agent Workforce/Platform',
      type: undefined,
      sort: undefined,
      direction: undefined,
      page: undefined,
      per_page: 15,
    });

    assert.strictEqual(repoOperation.path, '/repos/Agent%20Workforce/cloud%2Fapi/pulls');
    assert.deepStrictEqual(repoOperation.query, {
      state: 'all',
      head: 'AgentWorkforce:feature/refactor-adapter',
      per_page: 20,
    });
    assert.strictEqual('base' in (repoOperation.query ?? {}), false);
    assert.strictEqual('sort' in (repoOperation.query ?? {}), false);
    assert.strictEqual('direction' in (repoOperation.query ?? {}), false);
    assert.strictEqual('page' in (repoOperation.query ?? {}), false);

    assert.strictEqual(orgOperation.path, '/orgs/Agent%20Workforce%2FPlatform/repos');
    assert.deepStrictEqual(orgOperation.query, { per_page: 15 });
    assert.strictEqual('type' in (orgOperation.query ?? {}), false);
    assert.strictEqual('sort' in (orgOperation.query ?? {}), false);
    assert.strictEqual('direction' in (orgOperation.query ?? {}), false);
    assert.strictEqual('page' in (orgOperation.query ?? {}), false);
  });

  it('getPull targets the pull request endpoint', () => {
    const operation = getPull({
      owner: 'AgentWorkforce',
      repo: 'cloud',
      number: 42,
    });

    assert.strictEqual(operation.method, 'GET');
    assert.strictEqual(operation.path, '/repos/AgentWorkforce/cloud/pulls/42');
    assert.strictEqual(operation.query, undefined);
  });

  it('getPullDiff reuses the same pure pull request operation', () => {
    const input = {
      owner: 'AgentWorkforce',
      repo: 'cloud',
      number: 42,
    } as const;

    assert.deepStrictEqual(getPullDiff(input), getPull(input));
  });

  it('searchIssues builds the search issues endpoint and optional repo scope', () => {
    const operation = searchIssues({
      query: 'is:open label:bug',
      repoSlug: 'AgentWorkforce/cloud',
      sort: 'updated',
      order: 'desc',
      per_page: 20,
      page: 3,
    });

    assert.strictEqual(operation.method, 'GET');
    assert.strictEqual(operation.path, '/search/issues');
    assert.deepStrictEqual(operation.query, {
      q: 'is:open label:bug repo:AgentWorkforce/cloud',
      sort: 'updated',
      order: 'desc',
      per_page: 20,
      page: 3,
    });
  });

  it('searchRepos builds the repositories search endpoint', () => {
    const operation = searchRepos({
      query: 'cloud',
      sort: 'stars',
      order: 'desc',
      per_page: 10,
      page: 2,
    });

    assert.strictEqual(operation.method, 'GET');
    assert.strictEqual(operation.path, '/search/repositories');
    assert.deepStrictEqual(operation.query, {
      q: 'cloud in:name',
      sort: 'stars',
      order: 'desc',
      per_page: 10,
      page: 2,
    });
  });

  it('throws for invalid pagination inputs, including non-integers', () => {
    const invalidValues = [0, -1, 0.5, 1.5, Number.POSITIVE_INFINITY, Number.NaN];

    for (const per_page of invalidValues) {
      assert.throws(
        () =>
          listIssues({
            owner: 'AgentWorkforce',
            repo: 'cloud',
            per_page,
          }),
        /GitHub per_page must be a positive integer/,
      );
    }

    for (const page of invalidValues) {
      assert.throws(
        () =>
          listIssues({
            owner: 'AgentWorkforce',
            repo: 'cloud',
            page,
          }),
        /GitHub page must be a positive integer/,
      );
    }
  });

  it('provides compile-time coverage for GitHubOperation and GitHubRepoRef', () => {
    const repoRef: GitHubRepoRef = {
      owner: 'AgentWorkforce',
      repo: 'cloud',
    };
    const operation: GitHubOperation = getRepository(repoRef);

    assert.strictEqual(operation.method, 'GET');
    assert.strictEqual(operation.path, '/repos/AgentWorkforce/cloud');
  });
});
