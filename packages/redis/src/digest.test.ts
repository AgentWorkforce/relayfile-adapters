import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Redis bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'redis',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['redis'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'expired',
          canonicalPath: 'redis/0/session:abc123',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'set',
          canonicalPath: '/redis/0/cache:user:42',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'redis',
    bullets: [
      {
        text: 'key cache:user:42 was set',
        canonicalPath: 'redis/0/cache:user:42',
      },
      {
        text: 'key session:abc123 was expired',
        canonicalPath: 'redis/0/session:abc123',
      },
    ],
  });
});

test('digest classifies Redis delete and expiry as terminal states', async () => {
  const ctx: DigestContext = {
    provider: 'redis',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'del',
          canonicalPath: 'redis/0/lock:deploy',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'evicted',
          canonicalPath: 'redis/0/cache:stale',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'redis',
    bullets: [
      {
        text: 'key lock:deploy was deleted',
        canonicalPath: 'redis/0/lock:deploy',
      },
      {
        text: 'key cache:stale was expired',
        canonicalPath: 'redis/0/cache:stale',
      },
    ],
  });
});

test('digest classifies non-terminal Redis mutations as updated', async () => {
  const ctx: DigestContext = {
    provider: 'redis',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'rename',
          canonicalPath: 'redis/0/cache:user:42',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'redis',
    bullets: [
      {
        text: 'key cache:user:42 was updated',
        canonicalPath: 'redis/0/cache:user:42',
      },
    ],
  });
});

test('digest returns null for an empty Redis event window', async () => {
  const ctx: DigestContext = {
    provider: 'redis',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
