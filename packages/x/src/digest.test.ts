import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestChangeEvent } from './digest.js';

async function runDigest(events: readonly DigestChangeEvent[]) {
  return digest({
    provider: 'x',
    window: { from: '2026-05-17T00:00:00Z', to: '2026-05-18T00:00:00Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['x'] });
      return events;
    },
  });
}

test('X digest summarizes canonical search and post events deterministically', async () => {
  const section = await runDigest([
    {
      id: '2',
      timestamp: '2026-05-17T10:02:00Z',
      action: 'updated',
      path: '/x/posts/agent-workflow__1880001.json',
    },
    {
      id: '1',
      timestamp: '2026-05-17T10:01:00Z',
      action: 'search',
      canonicalPath: '/x/searches/s1__agent-workflow/meta.json',
    },
  ]);

  assert.deepEqual(section, {
    provider: 'x',
    bullets: [
      { text: 'search s1 ran', canonicalPath: 'x/searches/s1__agent-workflow/meta.json' },
      { text: 'post 1880001 was updated', canonicalPath: 'x/posts/agent-workflow__1880001.json' },
    ],
  });
});

test('X digest ignores aliases, result pointers, layout, and empty windows', async () => {
  assert.equal(await runDigest([]), null);
  assert.equal(await runDigest([
    { path: '/x/LAYOUT.md', action: 'updated' },
    { path: '/x/posts/by-id/1880001.json', action: 'updated' },
    { path: '/x/searches/s1__agent-workflow/results/1880001.json', action: 'updated' },
    { path: '/x/searches/_index.json', action: 'updated' },
  ]), null);
});

test('X digest classifies deletions', async () => {
  const section = await runDigest([
    {
      id: '3',
      timestamp: '2026-05-17T10:03:00Z',
      action: 'deleted',
      canonicalPath: '/x/users/xdevelopers__2244994945.json',
    },
  ]);

  assert.equal(section?.bullets[0]?.text, 'user 2244994945 was deleted');
});

test('X digest classifies creates and preserves canonical paths', async () => {
  const section = await runDigest([
    {
      id: '4',
      timestamp: '2026-05-17T10:04:00Z',
      action: 'created',
      canonicalPath: '/x/posts/new-post__1880002.json',
    },
  ]);

  assert.deepEqual(section?.bullets, [
    { text: 'post 1880002 was created', canonicalPath: 'x/posts/new-post__1880002.json' },
  ]);
});

test('X digest classifies terminal lifecycle actions', async () => {
  const section = await runDigest([
    {
      id: '5',
      timestamp: '2026-05-17T10:05:00Z',
      action: 'archived',
      canonicalPath: '/x/searches/s2__release-train/meta.json',
    },
  ]);

  assert.deepEqual(section?.bullets, [
    { text: 'search s2 was archived', canonicalPath: 'x/searches/s2__release-train/meta.json' },
  ]);
});

test('X digest uses locale-independent tie-breaks for equal timestamps', async () => {
  const section = await runDigest([
    {
      id: 'evt-é',
      timestamp: '2026-05-17T10:03:00Z',
      action: 'updated',
      canonicalPath: '/x/posts/with-accent__2.json',
    },
    {
      id: 'evt-Z',
      timestamp: '2026-05-17T10:03:00Z',
      action: 'updated',
      canonicalPath: '/x/posts/uppercase__1.json',
    },
  ]);

  assert.deepEqual(section?.bullets.map((bullet) => bullet.canonicalPath), [
    'x/posts/uppercase__1.json',
    'x/posts/with-accent__2.json',
  ]);
});
