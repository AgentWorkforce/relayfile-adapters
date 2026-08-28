import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('Ramp digest classifies paid and archived lifecycle events', async () => {
  const ctx: DigestContext = {
    provider: 'ramp',
    window: { from: '2026-08-27T00:00:00.000Z', to: '2026-08-28T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['ramp'] });
      return [
        {
          id: 'evt_1',
          timestamp: '2026-08-27T10:00:00.000Z',
          action: 'paid',
          canonicalPath: '/ramp/bills/bill_1__inv-42/meta.json',
        },
        {
          id: 'evt_2',
          timestamp: '2026-08-27T11:00:00.000Z',
          action: 'archived',
          canonicalPath: '/ramp/vendor-agreements/agreement_1__msa-2026/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'ramp',
    bullets: [
      {
        text: 'inv-42 was paid',
        canonicalPath: 'ramp/bills/bill_1__inv-42/meta.json',
      },
      {
        text: 'msa-2026 was archived',
        canonicalPath: 'ramp/vendor-agreements/agreement_1__msa-2026/meta.json',
      },
    ],
  });
});

test('Ramp digest returns null for empty windows', async () => {
  assert.equal(
    await digest({
      provider: 'ramp',
      window: { from: '2026-08-27T00:00:00.000Z', to: '2026-08-28T00:00:00.000Z' },
      async changeEvents() {
        return [];
      },
    }),
    null,
  );
});
