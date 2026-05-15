import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Confluence bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'confluence',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['confluence'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'archived',
          canonicalPath: '/confluence/pages/123__release-plan.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'confluence/spaces/ENG.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'confluence',
    bullets: [
      {
        text: 'space ENG was created',
        canonicalPath: 'confluence/spaces/ENG.json',
      },
      {
        text: 'page 123 was archived',
        canonicalPath: 'confluence/pages/123__release-plan.json',
      },
    ],
  });
});

test('digest returns null for an empty Confluence event window', async () => {
  const ctx: DigestContext = {
    provider: 'confluence',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
