import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Azure Blob bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'azure-blob',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['azure-blob'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'azure-blob/acct/container/logs/app.log',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'BlobCreated',
          canonicalPath: '/azure-blob/acct/container/data/report.csv',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'azure-blob',
    bullets: [
      {
        text: 'blob data/report.csv was uploaded',
        canonicalPath: 'azure-blob/acct/container/data/report.csv',
      },
      {
        text: 'blob logs/app.log was deleted',
        canonicalPath: 'azure-blob/acct/container/logs/app.log',
      },
    ],
  });
});

test('digest classifies Azure Blob archive tier changes', async () => {
  const ctx: DigestContext = {
    provider: 'azure-blob',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'BlobTiered',
          canonicalPath: 'azure-blob/acct/container/old-data.bin',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'azure-blob',
    bullets: [
      {
        text: 'blob old-data.bin was archived',
        canonicalPath: 'azure-blob/acct/container/old-data.bin',
      },
    ],
  });
});

test('digest returns null for an empty Azure Blob event window', async () => {
  const ctx: DigestContext = {
    provider: 'azure-blob',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
