import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Google Drive bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'google-drive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['google-drive'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'trashed',
          canonicalPath: 'google-drive/me/Documents/old-report.docx',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/google-drive/me/Documents/new-report.docx',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'google-drive',
    bullets: [
      {
        text: 'file Documents/new-report.docx was created',
        canonicalPath: 'google-drive/me/Documents/new-report.docx',
      },
      {
        text: 'file Documents/old-report.docx was trashed',
        canonicalPath: 'google-drive/me/Documents/old-report.docx',
      },
    ],
  });
});

test('digest classifies Google Drive move and delete actions', async () => {
  const ctx: DigestContext = {
    provider: 'google-drive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'moved',
          canonicalPath: 'google-drive/me/Archive/report.pdf',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'google-drive/me/Trash/draft.txt',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'google-drive',
    bullets: [
      {
        text: 'file Archive/report.pdf was moved',
        canonicalPath: 'google-drive/me/Archive/report.pdf',
      },
      {
        text: 'file Trash/draft.txt was deleted',
        canonicalPath: 'google-drive/me/Trash/draft.txt',
      },
    ],
  });
});

test('digest returns null for an empty Google Drive event window', async () => {
  const ctx: DigestContext = {
    provider: 'google-drive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
