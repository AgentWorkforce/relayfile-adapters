import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Postgres bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'postgres',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['postgres'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'postgres/mydb/public/users/42.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'INSERT',
          canonicalPath: '/postgres/mydb/public/orders/100.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'postgres',
    bullets: [
      {
        text: 'row orders/100 was inserted',
        canonicalPath: 'postgres/mydb/public/orders/100.json',
      },
      {
        text: 'row users/42 was deleted',
        canonicalPath: 'postgres/mydb/public/users/42.json',
      },
    ],
  });
});

test('digest classifies Postgres truncate as terminal state', async () => {
  const ctx: DigestContext = {
    provider: 'postgres',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'TRUNCATE',
          canonicalPath: 'postgres/mydb/public/sessions/all.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'postgres',
    bullets: [
      {
        text: 'row sessions/all was truncated',
        canonicalPath: 'postgres/mydb/public/sessions/all.json',
      },
    ],
  });
});

test('digest returns null for an empty Postgres event window', async () => {
  const ctx: DigestContext = {
    provider: 'postgres',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
