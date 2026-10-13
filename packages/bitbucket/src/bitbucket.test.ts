import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { digest } from './digest.js';
import { computeBitbucketPath } from './path-mapper.js';
import { BITBUCKET_SUPPORTED_EVENTS, normalizeBitbucketWebhook } from './webhook-normalizer.js';
import { emitBitbucketAuxiliaryFiles } from './emit-auxiliary-files.js';
import { bitbucketLayoutPromptFile } from './layout-prompt.js';
import { resources } from './resources.js';

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
