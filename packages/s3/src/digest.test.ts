import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic S3 bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 's3',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['s3'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: 's3/my-bucket/logs/app.log',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'ObjectCreated:Put',
          canonicalPath: '/s3/my-bucket/data/report.csv',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 's3',
    bullets: [
      {
        text: 'object data/report.csv was uploaded',
        canonicalPath: 's3/my-bucket/data/report.csv',
      },
      {
        text: 'object logs/app.log was deleted',
        canonicalPath: 's3/my-bucket/logs/app.log',
      },
    ],
  });
});

test('digest classifies S3 copy and restore actions', async () => {
  const ctx: DigestContext = {
    provider: 's3',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'ObjectCreated:Copy',
          canonicalPath: 's3/my-bucket/backup/data.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 's3',
    bullets: [
      {
        text: 'object backup/data was copied',
        canonicalPath: 's3/my-bucket/backup/data.json',
      },
    ],
  });
});

test('digest returns null for an empty S3 event window', async () => {
  const ctx: DigestContext = {
    provider: 's3',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
