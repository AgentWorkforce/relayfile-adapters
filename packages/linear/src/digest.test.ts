import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Linear bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'linear',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['linear'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: 'linear/issues/AGE-17__lin_17.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/linear/issues/AGE-16__lin_16.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'linear',
    bullets: [
      {
        text: 'AGE-16 was created',
        canonicalPath: 'linear/issues/AGE-16__lin_16.json',
      },
      {
        text: 'AGE-17 was updated',
        canonicalPath: 'linear/issues/AGE-17__lin_17.json',
      },
    ],
  });
});

test('digest returns null for an empty Linear event window', async () => {
  const ctx: DigestContext = {
    provider: 'linear',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
