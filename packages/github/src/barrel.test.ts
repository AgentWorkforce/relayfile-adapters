import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Regression test for the dropped `export * from './operations.js'` re-export
// in commit fc81ad6. Downstream consumers (e.g. AgentWorkforce/cloud) import
// these operation builders from the package root; this guards against any
// future change that quietly drops them from the barrel again.
import * as barrel from './index.js';
import {
  getPull,
  getPullDiff,
  getRepository,
  listIssues,
  listOrgs,
  listPullRequests,
  searchIssues,
  searchRepos,
} from './index.js';

describe('package barrel', () => {
  it('re-exports the canonical GitHub operation builders', () => {
    const expected = [
      'getPull',
      'getPullDiff',
      'getRepository',
      'listIssues',
      'listOrgs',
      'listPullRequests',
      'searchIssues',
      'searchRepos',
    ] as const;

    for (const name of expected) {
      assert.strictEqual(
        typeof (barrel as Record<string, unknown>)[name],
        'function',
        `expected ${name} to be re-exported from the package barrel`,
      );
    }
  });

  it('barrel-imported builders return well-formed GitHubOperation values', () => {
    const ref = { owner: 'AgentWorkforce', repo: 'cloud' };

    for (const op of [
      listIssues(ref),
      listPullRequests(ref),
      getRepository(ref),
      listOrgs(),
      getPull({ ...ref, number: 1 }),
      getPullDiff({ ...ref, number: 1 }),
      searchIssues({ query: 'is:open' }),
      searchRepos({ query: 'language:ts' }),
    ]) {
      assert.ok(op.method, 'operation.method is set');
      assert.ok(typeof op.path === 'string' && op.path.length > 0, 'operation.path is set');
    }
  });
});
