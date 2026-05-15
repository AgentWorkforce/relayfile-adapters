import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Calendly bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'calendly',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['calendly'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'canceled',
          canonicalPath: '/calendly/scheduled-events/abc-123.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'invitee.created',
          canonicalPath: 'calendly/invitees/inv-456.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'calendly',
    bullets: [
      {
        text: 'invitee inv-456 was created',
        canonicalPath: 'calendly/invitees/inv-456.json',
      },
      {
        text: 'event abc-123 was canceled',
        canonicalPath: 'calendly/scheduled-events/abc-123.json',
      },
    ],
  });
});

test('digest classifies canceled Calendly events distinctly from deleted', async () => {
  const ctx: DigestContext = {
    provider: 'calendly',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'scheduled_event.canceled',
          canonicalPath: 'calendly/scheduled-events/abc-111.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'scheduled_event.deleted',
          canonicalPath: 'calendly/scheduled-events/abc-222.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'calendly',
    bullets: [
      {
        text: 'event abc-111 was canceled',
        canonicalPath: 'calendly/scheduled-events/abc-111.json',
      },
      {
        text: 'event abc-222 was deleted',
        canonicalPath: 'calendly/scheduled-events/abc-222.json',
      },
    ],
  });
});

test('digest identifies event types by resource path', async () => {
  const ctx: DigestContext = {
    provider: 'calendly',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'calendly/event-types/et-789.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'calendly',
    bullets: [
      {
        text: 'event type et-789 was created',
        canonicalPath: 'calendly/event-types/et-789.json',
      },
    ],
  });
});

test('digest returns null for an empty Calendly event window', async () => {
  const ctx: DigestContext = {
    provider: 'calendly',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
