import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Zendesk bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'zendesk',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['zendesk'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'solved',
          canonicalPath: '/zendesk/tickets/4567.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'updated',
          canonicalPath: '/zendesk/tickets/7890.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'zendesk/tickets/1234.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'zendesk',
    bullets: [
      {
        text: 'ticket 1234 was created',
        canonicalPath: 'zendesk/tickets/1234.json',
      },
      {
        text: 'ticket 4567 was solved',
        canonicalPath: 'zendesk/tickets/4567.json',
      },
      {
        text: 'ticket 7890 was updated',
        canonicalPath: 'zendesk/tickets/7890.json',
      },
    ],
  });
});

test('digest classifies terminal states distinctly', async () => {
  const ctx: DigestContext = {
    provider: 'zendesk',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'closed',
          canonicalPath: '/zendesk/tickets/111.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: '/zendesk/users/222.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'zendesk',
    bullets: [
      { text: 'ticket 111 was solved', canonicalPath: 'zendesk/tickets/111.json' },
      { text: 'user 222 was deleted', canonicalPath: 'zendesk/users/222.json' },
    ],
  });
});

test('digest returns null for an empty Zendesk event window', async () => {
  const ctx: DigestContext = {
    provider: 'zendesk',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
