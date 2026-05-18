import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Mailgun bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'mailgun',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['mailgun'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'delivered',
          canonicalPath: 'mailgun/domains/mg.example.com/messages/msg-002.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/mailgun/domains/mg.example.com/messages/msg-001.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'mailgun',
    bullets: [
      {
        text: 'message msg-001 was created',
        canonicalPath: 'mailgun/domains/mg.example.com/messages/msg-001.json',
      },
      {
        text: 'message msg-002 was delivered',
        canonicalPath: 'mailgun/domains/mg.example.com/messages/msg-002.json',
      },
    ],
  });
});

test('digest returns null for an empty Mailgun event window', async () => {
  const ctx: DigestContext = {
    provider: 'mailgun',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest classifies Mailgun delivery failure and deletion lifecycle states', async () => {
  const ctx: DigestContext = {
    provider: 'mailgun',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'permanent_fail',
          canonicalPath: 'mailgun/domains/mg.example.com/events/evt-fail-1.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'list.deleted',
          canonicalPath: 'mailgun/lists/news%40mg.example.com.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'mailgun',
    bullets: [
      {
        text: 'event evt-fail-1 failed',
        canonicalPath: 'mailgun/domains/mg.example.com/events/evt-fail-1.json',
      },
      {
        text: 'list news@mg.example.com was deleted',
        canonicalPath: 'mailgun/lists/news%40mg.example.com.json',
      },
    ],
  });
});

test('digest treats undelivered as updated not as delivered (word boundary)', async () => {
  const ctx: DigestContext = {
    provider: 'mailgun',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'undelivered',
          canonicalPath: 'mailgun/domains/mg.example.com/messages/msg-003.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.equal(result?.bullets[0]?.text, 'message msg-003 was updated');
});

test('digest accepts the exact /mailgun root canonical path', async () => {
  const ctx: DigestContext = {
    provider: 'mailgun',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-root',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: '/mailgun',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'mailgun',
    bullets: [{ text: 'mailgun was updated', canonicalPath: 'mailgun' }],
  });
});

test('digest keeps processing when a Mailgun path leaf has invalid percent encoding', async () => {
  const ctx: DigestContext = {
    provider: 'mailgun',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: 'mailgun/domains/mg.example.com/messages/bad%path.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T08:01:00.000Z',
          action: 'created',
          canonicalPath: 'mailgun/domains/mg.example.com/messages/good%40path.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'mailgun',
    bullets: [
      {
        text: 'message bad%path was updated',
        canonicalPath: 'mailgun/domains/mg.example.com/messages/bad%path.json',
      },
      {
        text: 'message good@path was created',
        canonicalPath: 'mailgun/domains/mg.example.com/messages/good%40path.json',
      },
    ],
  });
});
