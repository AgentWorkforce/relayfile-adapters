import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic SendGrid bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'sendgrid',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter: Parameters<DigestContext['changeEvents']>[0]) {
      assert.deepEqual(filter, { providers: ['sendgrid'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'delivered',
          canonicalPath: 'sendgrid/mail/sg-msg-002.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/sendgrid/mail/sg-msg-001.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'sendgrid',
    bullets: [
      {
        text: 'mail sg-msg-001 was created',
        canonicalPath: 'sendgrid/mail/sg-msg-001.json',
      },
      {
        text: 'mail sg-msg-002 was delivered',
        canonicalPath: 'sendgrid/mail/sg-msg-002.json',
      },
    ],
  });
});

test('digest returns null for an empty SendGrid event window', async () => {
  const ctx: DigestContext = {
    provider: 'sendgrid',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest classifies SendGrid bounce and delete lifecycle states', async () => {
  const ctx: DigestContext = {
    provider: 'sendgrid',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'event.bounce',
          canonicalPath: 'sendgrid/events/sg-evt-001.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'contact.deleted',
          canonicalPath: 'sendgrid/contacts/ct-001.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'sendgrid',
    bullets: [
      {
        text: 'event sg-evt-001 was bounced',
        canonicalPath: 'sendgrid/events/sg-evt-001.json',
      },
      {
        text: 'contact ct-001 was deleted',
        canonicalPath: 'sendgrid/contacts/ct-001.json',
      },
    ],
  });
});

test('digest treats undelivered as updated not as delivered (word boundary)', async () => {
  const ctx: DigestContext = {
    provider: 'sendgrid',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'undelivered',
          canonicalPath: 'sendgrid/mail/sg-msg-003.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.equal(result?.bullets[0]?.text, 'mail sg-msg-003 was updated');
});

test('digest accepts the exact /sendgrid root canonical path', async () => {
  const ctx: DigestContext = {
    provider: 'sendgrid',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-root',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: '/sendgrid',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'sendgrid',
    bullets: [{ text: 'sendgrid was updated', canonicalPath: 'sendgrid' }],
  });
});
