import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Dropbox bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'dropbox',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['dropbox'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'dropbox/user/Photos/old-pic.jpg',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'file.created',
          canonicalPath: '/dropbox/user/Documents/notes.txt',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'dropbox',
    bullets: [
      {
        text: 'file Documents/notes.txt was created',
        canonicalPath: 'dropbox/user/Documents/notes.txt',
      },
      {
        text: 'file Photos/old-pic.jpg was deleted',
        canonicalPath: 'dropbox/user/Photos/old-pic.jpg',
      },
    ],
  });
});

test('digest classifies Dropbox move actions', async () => {
  const ctx: DigestContext = {
    provider: 'dropbox',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'file.moved',
          canonicalPath: 'dropbox/user/Archive/report.pdf',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'dropbox',
    bullets: [
      {
        text: 'file Archive/report.pdf was moved',
        canonicalPath: 'dropbox/user/Archive/report.pdf',
      },
    ],
  });
});

test('digest returns null for an empty Dropbox event window', async () => {
  const ctx: DigestContext = {
    provider: 'dropbox',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
