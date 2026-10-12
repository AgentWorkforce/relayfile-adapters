import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { digest } from './digest.js';
import { computeBitbucketPath } from './path-mapper.js';
import { BITBUCKET_SUPPORTED_EVENTS, normalizeBitbucketWebhook } from './webhook-normalizer.js';

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
