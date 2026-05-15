import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic GCS bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'gcs',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['gcs'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'gcs/my-bucket/logs/app.log',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'OBJECT_FINALIZE',
          canonicalPath: '/gcs/my-bucket/data/report.csv',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'gcs',
    bullets: [
      {
        text: 'object data/report.csv was uploaded',
        canonicalPath: 'gcs/my-bucket/data/report.csv',
      },
      {
        text: 'object logs/app.log was deleted',
        canonicalPath: 'gcs/my-bucket/logs/app.log',
      },
    ],
  });
});

test('digest classifies GCS archive actions', async () => {
  const ctx: DigestContext = {
    provider: 'gcs',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'OBJECT_ARCHIVE',
          canonicalPath: 'gcs/my-bucket/old-data.bin',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gcs',
    bullets: [
      {
        text: 'object old-data.bin was archived',
        canonicalPath: 'gcs/my-bucket/old-data.bin',
      },
    ],
  });
});

test('digest returns null for an empty GCS event window', async () => {
  const ctx: DigestContext = {
    provider: 'gcs',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
