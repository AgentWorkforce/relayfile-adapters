import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestChangeEvent } from './digest.js';

async function runDigest(events: readonly DigestChangeEvent[]) {
  return digest({
    provider: 'docker-hub',
    window: { from: '2026-05-21T00:00:00Z', to: '2026-05-22T00:00:00Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['docker-hub'] });
      return events;
    },
  });
}

test('Docker Hub digest summarizes canonical repository, tag, and webhook events', async () => {
  const section = await runDigest([
    {
      id: '3',
      timestamp: '2026-05-21T10:03:00Z',
      action: 'webhook_created',
      canonicalPath: '/docker-hub/repositories/acme/api/webhooks/123.json',
    },
    {
      id: '1',
      timestamp: '2026-05-21T10:01:00Z',
      action: 'image_push',
      canonicalPath: '/docker-hub/repositories/acme/api/tags/latest.json',
    },
    {
      id: '2',
      timestamp: '2026-05-21T10:02:00Z',
      action: 'updated',
      canonicalPath: '/docker-hub/repositories/acme/api.json',
    },
  ]);

  assert.deepEqual(section, {
    provider: 'docker-hub',
    bullets: [
      { text: 'tag acme/api:latest was updated', canonicalPath: 'docker-hub/repositories/acme/api/tags/latest.json' },
      { text: 'repository acme/api was updated', canonicalPath: 'docker-hub/repositories/acme/api.json' },
      { text: 'webhook acme/api/123 was created', canonicalPath: 'docker-hub/repositories/acme/api/webhooks/123.json' },
    ],
  });
});

test('Docker Hub digest ignores aliases, indexes, layout, and empty windows', async () => {
  assert.equal(await runDigest([]), null);
  assert.equal(await runDigest([
    { path: '/docker-hub/LAYOUT.md', action: 'updated' },
    { path: '/docker-hub/repositories/_index.json', action: 'updated' },
    { path: '/docker-hub/repositories/by-id/acme__api.json', action: 'updated' },
    { path: '/docker-hub/tags/by-id/acme__api__latest.json', action: 'updated' },
    { path: '/docker-hub/webhooks/by-repository/acme__api/_index.json', action: 'updated' },
  ]), null);
});

test('Docker Hub digest classifies tag delete, repo delete, and webhook delete events', async () => {
  const section = await runDigest([
    {
      id: '1',
      timestamp: '2026-05-21T10:01:00Z',
      action: 'tag_delete',
      canonicalPath: '/docker-hub/repositories/acme/api/tags/old.json',
    },
    {
      id: '2',
      timestamp: '2026-05-21T10:02:00Z',
      action: 'repo_deleted',
      canonicalPath: '/docker-hub/repositories/acme/api.json',
    },
    {
      id: '3',
      timestamp: '2026-05-21T10:03:00Z',
      action: 'webhook_delete',
      canonicalPath: '/docker-hub/repositories/acme/api/webhooks/123.json',
    },
  ]);

  assert.deepEqual(section?.bullets.map((bullet) => bullet.text), [
    'tag acme/api:old was deleted',
    'repository acme/api was deleted',
    'webhook acme/api/123 was deleted',
  ]);
});
