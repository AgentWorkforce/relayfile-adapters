import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Gmail bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'gmail',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['gmail'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: 'gmail/user@example.com/threads/thread-002.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/gmail/user@example.com/threads/thread-001.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'gmail',
    bullets: [
      {
        text: 'thread thread-001 was created',
        canonicalPath: 'gmail/user@example.com/threads/thread-001.json',
      },
      {
        text: 'thread thread-002 was updated',
        canonicalPath: 'gmail/user@example.com/threads/thread-002.json',
      },
    ],
  });
});

test('digest returns null for an empty Gmail event window', async () => {
  const ctx: DigestContext = {
    provider: 'gmail',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest classifies Gmail send and delete lifecycle states', async () => {
  const ctx: DigestContext = {
    provider: 'gmail',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'draft.sent',
          canonicalPath: 'gmail/user@example.com/drafts/draft-abc.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'messages.deleted',
          canonicalPath: 'gmail/user@example.com/threads/thread-003.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gmail',
    bullets: [
      {
        text: 'draft draft-abc was sent',
        canonicalPath: 'gmail/user@example.com/drafts/draft-abc.json',
      },
      {
        text: 'thread thread-003 was deleted',
        canonicalPath: 'gmail/user@example.com/threads/thread-003.json',
      },
    ],
  });
});

test('digest treats unsent as updated not as sent (word boundary)', async () => {
  const ctx: DigestContext = {
    provider: 'gmail',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'unsent',
          canonicalPath: 'gmail/user@example.com/threads/thread-004.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.equal(result?.bullets[0]?.text, 'thread thread-004 was updated');
});
