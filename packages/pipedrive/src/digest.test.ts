import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Pipedrive bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'pipedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['pipedrive'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'won',
          canonicalPath: '/pipedrive/deals/enterprise-renewal__42.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'pipedrive/persons/jane-doe__101.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'pipedrive',
    bullets: [
      {
        text: 'person jane-doe was created',
        canonicalPath: 'pipedrive/persons/jane-doe__101.json',
      },
      {
        text: 'deal enterprise-renewal was won',
        canonicalPath: 'pipedrive/deals/enterprise-renewal__42.json',
      },
    ],
  });
});

test('digest classifies terminal states distinctly', async () => {
  const ctx: DigestContext = {
    provider: 'pipedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'lost',
          canonicalPath: '/pipedrive/deals/stale-deal__77.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: '/pipedrive/organizations/old-org__88.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'pipedrive',
    bullets: [
      { text: 'deal stale-deal was lost', canonicalPath: 'pipedrive/deals/stale-deal__77.json' },
      { text: 'organization old-org was deleted', canonicalPath: 'pipedrive/organizations/old-org__88.json' },
    ],
  });
});

test('digest returns null for an empty Pipedrive event window', async () => {
  const ctx: DigestContext = {
    provider: 'pipedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
