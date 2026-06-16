import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GitLabApiClient } from '../src/api.js';
import { DEFAULT_CONFIG } from '../src/adapter.js';
import { bulkIngestProject } from '../src/bulk-ingest.js';
import { resolveProjectMaterialization } from '../src/materialization-policy.js';
import { MockProvider, ok } from './helpers.js';

const PROJECT = 'acme/api';
const PROJECT_ID = 'acme%2Fapi';

function makeClient(provider: MockProvider): GitLabApiClient {
  return new GitLabApiClient(provider, {
    ...DEFAULT_CONFIG,
    connectionId: 'conn-1',
    projectPath: PROJECT,
  });
}

function registerIssue(provider: MockProvider, iid: number, title: string): void {
  provider.register(
    'GET',
    `/api/v4/projects/${PROJECT_ID}/issues/${iid}`,
    ok({
      id: iid,
      iid,
      title,
      state: 'opened',
      author: { id: 1, username: 'dev', name: 'Dev' },
      labels: [],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }),
  );
}

function registerCommit(provider: MockProvider, sha: string, title: string): void {
  provider.register(
    'GET',
    `/api/v4/projects/${PROJECT_ID}/repository/commits/${encodeURIComponent(sha)}`,
    ok({
      id: sha,
      short_id: sha.slice(0, 8),
      title,
      message: title,
      author_name: 'Dev',
      created_at: '2024-01-01T00:00:00Z',
    }),
  );
}

describe('bulkIngestProject', () => {
  it('requires a projectPath', async () => {
    const client = makeClient(new MockProvider());
    await assert.rejects(bulkIngestProject(client, {}), /requires options\.projectPath/);
  });

  it('only syncs the requested object types', async () => {
    const provider = new MockProvider();
    provider.register('GET', `/api/v4/projects/${PROJECT_ID}/issues`, ok([{ iid: 7 }]));
    registerIssue(provider, 7, 'Fix login');

    const result = await bulkIngestProject(makeClient(provider), {
      projectPath: PROJECT,
      objectTypes: ['issues'],
    });

    assert.deepStrictEqual(result.syncedObjectTypes, ['issues']);
    assert.strictEqual(result.filesWritten, 1);
    assert.strictEqual(result.filesUpdated, 0);
    assert.strictEqual(result.filesDeleted, 0);
    assert.deepStrictEqual(result.errors, []);
    // Only the list call and the per-issue fetch may hit the provider; merge
    // requests, pipelines, and commits must not be requested at all.
    const endpoints = provider.requests.map((request) => request.endpoint);
    assert.ok(endpoints.every((endpoint) => endpoint.includes('/issues')));
  });

  it('accumulates operations and paths across object types', async () => {
    const provider = new MockProvider();
    provider.register('GET', `/api/v4/projects/${PROJECT_ID}/issues`, ok([{ iid: 1 }, { iid: 2 }]));
    registerIssue(provider, 1, 'First');
    registerIssue(provider, 2, 'Second');
    provider.register(
      'GET',
      `/api/v4/projects/${PROJECT_ID}/repository/commits`,
      ok([{ id: 'abcdef0123456789' }]),
    );
    registerCommit(provider, 'abcdef0123456789', 'Initial commit');

    const result = await bulkIngestProject(makeClient(provider), {
      projectPath: PROJECT,
      objectTypes: ['issues', 'commits'],
    });

    assert.deepStrictEqual(result.syncedObjectTypes, ['issues', 'commits']);
    assert.strictEqual(result.filesWritten, 3);
    assert.strictEqual(result.operations.length, 3);
    assert.strictEqual(result.paths.length, 3);
    assert.ok(result.paths.every((path) => path.startsWith('/gitlab/')));
    assert.ok(result.operations.every((operation) => operation.mode === 'write'));
  });

  it('passes the limit through to pagination', async () => {
    const provider = new MockProvider();
    provider.register('GET', `/api/v4/projects/${PROJECT_ID}/issues`, ok([{ iid: 1 }, { iid: 2 }, { iid: 3 }]));
    registerIssue(provider, 1, 'First');
    registerIssue(provider, 2, 'Second');

    const result = await bulkIngestProject(makeClient(provider), {
      projectPath: PROJECT,
      objectTypes: ['issues'],
      limit: 2,
    });

    assert.strictEqual(result.filesWritten, 2);
  });

  it('threads the incoming cursor into the result', async () => {
    const provider = new MockProvider();
    provider.register('GET', `/api/v4/projects/${PROJECT_ID}/issues`, ok([]));

    const result = await bulkIngestProject(makeClient(provider), {
      projectPath: PROJECT,
      objectTypes: ['issues'],
      cursor: 'cursor-42',
    });

    assert.strictEqual(result.nextCursor, 'cursor-42');
    assert.deepStrictEqual(result.syncedObjectTypes, []);
    assert.strictEqual(result.filesWritten, 0);
  });

  it('uses materialization rules to sync eager resources with provider filters', async () => {
    const provider = new MockProvider();
    provider.register('GET', `/api/v4/projects/${PROJECT_ID}/issues`, ok([{ iid: 7 }]));
    registerIssue(provider, 7, 'Factory issue');

    const result = await bulkIngestProject(makeClient(provider), {
      projectPath: PROJECT,
      cursor: '2026-06-01T00:00:00Z',
      materialization: resolveProjectMaterialization(
        {
          ...DEFAULT_CONFIG,
          materialization: {
            default: 'lazy',
            rules: [
              {
                projects: ['acme/*'],
                issues: {
                  mode: 'eager',
                  filter: { state: 'opened', labels: ['factory'] },
                  incremental: true,
                },
              },
            ],
          },
        },
        PROJECT,
        { cursor: '2026-06-01T00:00:00Z' },
      ),
    });

    assert.deepStrictEqual(result.syncedObjectTypes, ['issues']);
    assert.strictEqual(result.filesWritten, 1);

    const endpoints = provider.requests.map((request) => request.endpoint);
    assert.ok(endpoints.every((endpoint) => endpoint.includes('/issues')));
    assert.deepStrictEqual(provider.requests[0]?.query, {
      state: 'opened',
      labels: 'factory',
      updated_after: '2026-06-01T00:00:00Z',
      page: '1',
      per_page: '50',
    });
  });
});
