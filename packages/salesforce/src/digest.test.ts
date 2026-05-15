import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Salesforce bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'salesforce',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['salesforce'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'closed',
          canonicalPath: '/salesforce/cases/003ABC.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'salesforce/opportunities/big-deal__006XYZ.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'salesforce',
    bullets: [
      {
        text: 'opportunity big-deal was created',
        canonicalPath: 'salesforce/opportunities/big-deal__006XYZ.json',
      },
      {
        text: 'case 003ABC was closed',
        canonicalPath: 'salesforce/cases/003ABC.json',
      },
    ],
  });
});

test('digest classifies terminal states distinctly', async () => {
  const ctx: DigestContext = {
    provider: 'salesforce',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'converted',
          canonicalPath: '/salesforce/leads/hot-lead__00Q123.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: '/salesforce/accounts/old-acct__001ABC.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'salesforce',
    bullets: [
      { text: 'lead hot-lead was converted', canonicalPath: 'salesforce/leads/hot-lead__00Q123.json' },
      { text: 'account old-acct was deleted', canonicalPath: 'salesforce/accounts/old-acct__001ABC.json' },
    ],
  });
});

test('digest returns null for an empty Salesforce event window', async () => {
  const ctx: DigestContext = {
    provider: 'salesforce',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
