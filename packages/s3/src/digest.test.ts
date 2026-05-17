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
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'ObjectRestore:Completed',
          canonicalPath: 's3/my-bucket/archive/report.csv',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'ObjectTagsUpdated',
          canonicalPath: 's3/my-bucket/data/report.csv',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 's3',
    bullets: [
      {
        text: 'object backup/data.json was copied',
        canonicalPath: 's3/my-bucket/backup/data.json',
      },
      {
        text: 'object archive/report.csv was restored',
        canonicalPath: 's3/my-bucket/archive/report.csv',
      },
      {
        text: 'object data/report.csv was modified',
        canonicalPath: 's3/my-bucket/data/report.csv',
      },
    ],
  });
});

test('digest keeps canonical object keys with by-prefixed folders', async () => {
  const ctx: DigestContext = {
    provider: 's3',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-by-folder',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'ObjectCreated:Put',
          canonicalPath: '/s3/my-bucket/tasks/by-state/report.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 's3',
    bullets: [
      {
        text: 'object tasks/by-state/report.json was uploaded',
        canonicalPath: 's3/my-bucket/tasks/by-state/report.json',
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

test('digest accepts the exact /s3 root canonical path', async () => {
  const ctx: DigestContext = {
    provider: 's3',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-root',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: '/s3',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 's3',
    bullets: [{ text: 'object s3 was modified', canonicalPath: 's3' }],
  });
});
