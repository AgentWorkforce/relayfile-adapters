import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Box bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'box',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['box'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'trashed',
          canonicalPath: 'box/acct/files/old-report__f456.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'ITEM_UPLOAD',
          canonicalPath: '/box/acct/files/quarterly__f123.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'box',
    bullets: [
      {
        text: 'file quarterly was uploaded',
        canonicalPath: 'box/acct/files/quarterly__f123.json',
      },
      {
        text: 'file old-report was trashed',
        canonicalPath: 'box/acct/files/old-report__f456.json',
      },
    ],
  });
});

test('digest classifies Box lock and copy actions', async () => {
  const ctx: DigestContext = {
    provider: 'box',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'ITEM_COPY',
          canonicalPath: 'box/acct/files/backup__f789.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'LOCK_CREATE',
          canonicalPath: 'box/acct/files/contract__f321.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'box',
    bullets: [
      {
        text: 'file backup was copied',
        canonicalPath: 'box/acct/files/backup__f789.json',
      },
      {
        text: 'file contract was locked',
        canonicalPath: 'box/acct/files/contract__f321.json',
      },
    ],
  });
});

test('digest returns null for an empty Box event window', async () => {
  const ctx: DigestContext = {
    provider: 'box',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
