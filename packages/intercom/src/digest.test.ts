import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Intercom bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'intercom',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['intercom'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'closed',
          canonicalPath: '/intercom/conversations/conv-456.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'intercom/contacts/contact-123.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'intercom',
    bullets: [
      {
        text: 'contact contact-123 was created',
        canonicalPath: 'intercom/contacts/contact-123.json',
      },
      {
        text: 'conversation conv-456 was closed',
        canonicalPath: 'intercom/conversations/conv-456.json',
      },
    ],
  });
});

test('digest classifies terminal states distinctly', async () => {
  const ctx: DigestContext = {
    provider: 'intercom',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'archived',
          canonicalPath: '/intercom/conversations/conv-old.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'reopened',
          canonicalPath: '/intercom/conversations/conv-reopen.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'deleted',
          canonicalPath: '/intercom/companies/co-gone.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'intercom',
    bullets: [
      { text: 'conversation conv-old was archived', canonicalPath: 'intercom/conversations/conv-old.json' },
      { text: 'conversation conv-reopen was reopened', canonicalPath: 'intercom/conversations/conv-reopen.json' },
      { text: 'company co-gone was deleted', canonicalPath: 'intercom/companies/co-gone.json' },
    ],
  });
});

test('digest returns null for an empty Intercom event window', async () => {
  const ctx: DigestContext = {
    provider: 'intercom',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
