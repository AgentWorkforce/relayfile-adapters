import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Notion bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'notion',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['notion'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: 'notion/pages/roadmap__page_b/page.md',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/notion/pages/launch-plan__page_a/page.md',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'notion',
    bullets: [
      {
        text: 'launch-plan was created',
        canonicalPath: 'notion/pages/launch-plan__page_a/page.md',
      },
      {
        text: 'roadmap was updated',
        canonicalPath: 'notion/pages/roadmap__page_b/page.md',
      },
    ],
  });
});

test('digest returns null for an empty Notion event window', async () => {
  const ctx: DigestContext = {
    provider: 'notion',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
