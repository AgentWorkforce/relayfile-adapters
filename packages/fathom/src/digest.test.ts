import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Fathom bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'fathom',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter: { providers: string[] }) {
      assert.deepEqual(filter, { providers: ['fathom'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: 'fathom/meetings/123.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'archived',
          canonicalPath: 'fathom/teams/sales.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/fathom/recordings/123/summary.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'fathom',
    bullets: [
      {
        text: 'recording summary 123 was created',
        canonicalPath: 'fathom/recordings/123/summary.json',
      },
      {
        text: 'meeting 123 was updated',
        canonicalPath: 'fathom/meetings/123.json',
      },
      {
        text: 'team sales was archived',
        canonicalPath: 'fathom/teams/sales.json',
      },
    ],
  });
});

test('digest excludes Fathom alias and structural paths', async () => {
  const ctx: DigestContext = {
    provider: 'fathom',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'fathom/LAYOUT.md',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T08:01:00.000Z',
          action: 'created',
          canonicalPath: 'fathom/meetings/_index.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T08:02:00.000Z',
          action: 'created',
          canonicalPath: 'fathom/meetings/by-id/123.json',
        },
      ];
    },
  };

  assert.equal(await digest(ctx), null);
});
