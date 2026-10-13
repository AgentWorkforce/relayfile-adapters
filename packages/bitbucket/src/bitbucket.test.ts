import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { digest } from './digest.js';
import { computeBitbucketPath } from './path-mapper.js';
import { BITBUCKET_SUPPORTED_EVENTS, normalizeBitbucketWebhook } from './webhook-normalizer.js';
import { emitBitbucketAuxiliaryFiles } from './emit-auxiliary-files.js';
import { bitbucketLayoutPromptFile } from './layout-prompt.js';
import { resources } from './resources.js';
import { bitbucketRecordBucketing } from './sync-bucketing.js';

describe('Bitbucket adapter', () => {
  const repository = { full_name: 'acme/api', uuid: '{repo}', workspace: { slug: 'acme' } };

  it('keeps merged and declined pull requests as records', () => {
    for (const [eventType, state] of [['pullrequest:fulfilled', 'MERGED'], ['pullrequest:rejected', 'DECLINED']] as const) {
      const result = normalizeBitbucketWebhook({ repository, pullrequest: { id: 7, title: 'Ship', state } }, eventType);
      assert.equal(result?.deleted, false);
      assert.equal(result?.record?.state, state);
      assert.equal(computeBitbucketPath(result!.model!, result!.record!), '/bitbucket/repositories/acme/api/pull-requests/7.json');
    }
  });

  it('marks only provider deletion as deletion and follows pushes with commit and tag syncs', () => {
    const removed = normalizeBitbucketWebhook({ repository }, 'repo:deleted');
    assert.equal(removed?.deleted, true);
    assert.deepEqual(removed?.record?._nango_metadata, { last_action: 'deleted' });
    assert.deepEqual(normalizeBitbucketWebhook({ repository }, 'repo:push')?.followUpSyncs, ['fetch-commits', 'fetch-tags']);
  });

  it('maps workspace projects independently of repositories', () => {
    assert.equal(computeBitbucketPath('BitbucketProject', { id: '{project}', workspace: 'acme', key: 'OPS' }), '/bitbucket/workspaces/acme/projects/OPS.json');
    assert.equal(computeBitbucketPath('BitbucketProject', { id: '{project}', workspace: { slug: 'acme', uuid: '{workspace}' }, key: 'OPS' }), '/bitbucket/workspaces/acme/projects/OPS.json');
    assert.equal(computeBitbucketPath('BitbucketPullRequest', { id: 'acme/api:7', pullrequest_id: 7, repository: { full_name: 'acme/api' } }), '/bitbucket/repositories/acme/api/pull-requests/7.json');
    assert.equal(computeBitbucketPath('BitbucketPullRequest', { id: 'acme/api:7', pullrequest_id: 7, workspace: { slug: 'acme' }, repo_slug: 'api' }), '/bitbucket/repositories/acme/api/pull-requests/7.json');
  });

  it('emits discoverable indexes with titles, update times, and stable canonical anchors', async () => {
    const files = new Map<string, string>();
    const client = {
      async readFile(input: { path: string }) { return files.has(input.path) ? { content: files.get(input.path)! } : null; },
      async writeFile(input: { path: string; content: string }) { files.set(input.path, input.content); },
    };
    for (const record of [
      { id: 'acme/api:older', hash: 'older', repository: 'acme/api', message: 'Older commit\nDetails', date: '2026-10-11T12:00:00Z' },
      { id: 'acme/api:newer', hash: 'newer', repository: 'acme/api', message: 'Newer commit', date: '2026-10-12T12:00:00Z' },
    ]) {
      const result = await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketCommit', records: [record] });
      assert.deepEqual(result.errors, []);
    }
    const index = JSON.parse(files.get('/bitbucket/commits/_index.json') ?? 'null');
    assert.deepEqual(index.map((row: { id: string }) => row.id), ['acme/api:newer', 'acme/api:older']);
    assert.equal(index[0].title, 'Newer commit');
    assert.equal(index[0].updated, '2026-10-12T12:00:00Z');
    assert.equal(index[0].canonicalPath, '/bitbucket/repositories/acme/api/commits/newer.json');
    assert.ok(files.has('/bitbucket/commits/by-id/acme%2Fapi%3Anewer.json'));
    const root = JSON.parse(files.get('/bitbucket/_index.json') ?? 'null');
    assert.deepEqual(root.map((row: { id: string }) => row.id), ['commits']);
    const repositoryResult = await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketRepository', records: [{ id: '{repo}', uuid: '{repo}', full_name: 'acme/api', workspace: { slug: 'acme' } }] });
    assert.deepEqual(repositoryResult.errors, []);
    const expandedRoot = JSON.parse(files.get('/bitbucket/_index.json') ?? 'null');
    assert.deepEqual(expandedRoot.map((row: { id: string }) => row.id), ['commits', 'repositories']);
  });

  it('documents the provider tree, indexes, aliases and terminal states', () => {
    const layout = bitbucketLayoutPromptFile();
    assert.ok(Buffer.byteLength(layout.content) >= 1000);
    for (const term of ['by-id', '_index.json', 'jq', 'MERGED', 'DECLINED', 'August 2026']) {
      assert.ok(layout.content.includes(term), term);
    }
    assert.ok(resources.every((resource) => resource.name !== ('issues' as string)));
    assert.ok(resources.every((resource) => resource.operations.length === 0));
    assert.ok(!layout.content.includes('/issues/.schema.json'));
    assert.equal(resources[0]?.sampleIndexPath, '/bitbucket/pull-requests/_index.json');
  });

  it('removes ID-only tombstones from the index and by-id alias', async () => {
    const files = new Map<string, string>();
    const client = {
      async readFile(input: { path: string }) { return files.has(input.path) ? { content: files.get(input.path)! } : null; },
      async writeFile(input: { path: string; content: string }) { files.set(input.path, input.content); },
      async deleteFile(input: { path: string }) { files.delete(input.path); },
    };
    const record = { id: 'acme/api:abc', hash: 'abc', repository: 'acme/api' };
    const alias = '/bitbucket/commits/by-id/acme%2Fapi%3Aabc.json';
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketCommit', records: [record] })).errors, []);
    assert.ok(files.has(alias));
    const tombstones = bitbucketRecordBucketing.bucketRecords([
      { id: record.id, _nango_metadata: { last_action: 'deleted' } },
    ], 'BitbucketCommit').commits ?? [];
    assert.deepEqual(tombstones, [{ id: record.id, _deleted: true }]);
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketCommit', records: tombstones })).errors, []);
    assert.equal(files.has(alias), false);
    assert.deepEqual(JSON.parse(files.get('/bitbucket/commits/_index.json') ?? 'null'), []);
  });

  it('reconciles lifecycle and ownership aliases on update and deletion', async () => {
    const files = new Map<string, string>();
    const client = {
      async readFile(input: { path: string }) { return files.has(input.path) ? { content: files.get(input.path)! } : null; },
      async writeFile(input: { path: string; content: string }) { files.set(input.path, input.content); },
      async deleteFile(input: { path: string }) { files.delete(input.path); },
    };
    const open = { id: 'acme/api:7', pullrequest_id: 7, repository: 'acme/api', state: 'OPEN', author: { nickname: 'alice' } };
    const merged = { ...open, state: 'MERGED', author: { nickname: 'bob' } };
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketPullRequest', records: [open] })).errors, []);
    assert.ok(files.has('/bitbucket/pull-requests/by-state/open/acme%2Fapi%3A7.json'));
    assert.ok(files.has('/bitbucket/pull-requests/by-creator/alice/acme%2Fapi%3A7.json'));
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketPullRequest', records: [merged] })).errors, []);
    assert.equal(files.has('/bitbucket/pull-requests/by-state/open/acme%2Fapi%3A7.json'), false);
    assert.equal(files.has('/bitbucket/pull-requests/by-creator/alice/acme%2Fapi%3A7.json'), false);
    assert.ok(files.has('/bitbucket/pull-requests/by-state/merged/acme%2Fapi%3A7.json'));
    assert.ok(files.has('/bitbucket/pull-requests/by-creator/bob/acme%2Fapi%3A7.json'));
    const issue = { id: 'acme/api:8', issue_id: 8, repository: 'acme/api', state: 'open', assignee: { nickname: 'alice' }, reporter: { nickname: 'bob' }, priority: 'major' };
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketIssue', records: [issue] })).errors, []);
    for (const path of ['by-state/open', 'by-assignee/alice', 'by-creator/bob', 'by-priority/major']) {
      assert.ok(files.has(`/bitbucket/issues/${path}/acme%2Fapi%3A8.json`));
    }
    const secondIssue = { ...issue, id: 'acme/api:9', issue_id: 9 };
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketIssue', records: [secondIssue] })).errors, []);
    for (const path of ['by-state/open', 'by-assignee/alice', 'by-creator/bob', 'by-priority/major']) {
      assert.ok(files.has(`/bitbucket/issues/${path}/acme%2Fapi%3A8.json`));
      assert.ok(files.has(`/bitbucket/issues/${path}/acme%2Fapi%3A9.json`));
    }
    const pipeline = { id: 'acme/api:{pipe}', uuid: '{pipe}', repository: 'acme/api', state: { name: 'COMPLETED' } };
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketPipeline', records: [pipeline] })).errors, []);
    assert.ok(files.has('/bitbucket/pipelines/by-status/completed/acme%2Fapi%3A%7Bpipe%7D.json'));
    const failedPipeline = { ...pipeline, state: { name: 'COMPLETED', result: { name: 'FAILED' } } };
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketPipeline', records: [failedPipeline] })).errors, []);
    assert.equal(files.has('/bitbucket/pipelines/by-status/completed/acme%2Fapi%3A%7Bpipe%7D.json'), false);
    assert.ok(files.has('/bitbucket/pipelines/by-status/failed/acme%2Fapi%3A%7Bpipe%7D.json'));
    const deployment = { id: 'acme/api:{deploy}', uuid: '{deploy}', repository: 'acme/api', state: { name: 'COMPLETED' } };
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketDeployment', records: [deployment] })).errors, []);
    assert.ok(files.has('/bitbucket/deployments/by-status/completed/acme%2Fapi%3A%7Bdeploy%7D.json'));
    const successfulDeployment = { ...deployment, state: { name: 'COMPLETED', status: { name: 'SUCCESSFUL' } } };
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketDeployment', records: [successfulDeployment] })).errors, []);
    assert.equal(files.has('/bitbucket/deployments/by-status/completed/acme%2Fapi%3A%7Bdeploy%7D.json'), false);
    assert.ok(files.has('/bitbucket/deployments/by-status/successful/acme%2Fapi%3A%7Bdeploy%7D.json'));
    assert.deepEqual((await emitBitbucketAuxiliaryFiles(client, { workspaceId: 'workspace', model: 'BitbucketPullRequest', records: [{ id: merged.id, _deleted: true }] })).errors, []);
    assert.equal(files.has('/bitbucket/pull-requests/by-state/merged/acme%2Fapi%3A7.json'), false);
    assert.equal(files.has('/bitbucket/pull-requests/by-creator/bob/acme%2Fapi%3A7.json'), false);
  });

  it('declares upstream event names and classifies terminal digest states', async () => {
    assert.ok(BITBUCKET_SUPPORTED_EVENTS.includes('pullrequest:fulfilled'));
    const section = await digest({ provider: 'bitbucket', window: { from: '2026-10-12T00:00:00Z', to: '2026-10-13T00:00:00Z' }, async changeEvents() {
      return [{ id: '1', timestamp: '2026-10-12T12:00:00Z', action: 'file.updated', canonicalPath: '/bitbucket/repositories/acme/api/pull-requests/7.json', content: { state: 'MERGED' } }];
    } });
    assert.match(section?.bullets[0]?.text ?? '', /was merged/);
    const pipeline = await digest({ provider: 'bitbucket', window: { from: '2026-10-12T00:00:00Z', to: '2026-10-13T00:00:00Z' }, async changeEvents() {
      return [{ id: '2', timestamp: '2026-10-12T12:00:00Z', action: 'file.updated', canonicalPath: '/bitbucket/repositories/acme/api/pipelines/%7Bpipe%7D.json', content: { state: { name: 'COMPLETED' } } }];
    } });
    assert.match(pipeline?.bullets[0]?.text ?? '', /was completed/);
  });
});
