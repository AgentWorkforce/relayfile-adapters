import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from '../digest.js';

test('digest returns deterministic Google Calendar bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'google-calendar',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter: Parameters<DigestContext['changeEvents']>[0]) {
      assert.deepEqual(filter, { providers: ['google-calendar'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: 'google-calendar/calendars/primary/events/evt456.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/google-calendar/calendars/primary/events/evt123.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'google-calendar',
    bullets: [
      {
        text: 'event evt123 was created',
        canonicalPath: 'google-calendar/calendars/primary/events/evt123.json',
      },
      {
        text: 'event evt456 was updated',
        canonicalPath: 'google-calendar/calendars/primary/events/evt456.json',
      },
    ],
  });
});

test('digest returns null for an empty Google Calendar event window', async () => {
  const ctx: DigestContext = {
    provider: 'google-calendar',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest classifies Google Calendar cancelled and deleted lifecycle states', async () => {
  const ctx: DigestContext = {
    provider: 'google-calendar',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'event.cancelled',
          canonicalPath: 'google-calendar/calendars/primary/events/evt789.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'google-calendar/calendars/work/events/evt101.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'google-calendar',
    bullets: [
      {
        text: 'event evt789 was cancelled',
        canonicalPath: 'google-calendar/calendars/primary/events/evt789.json',
      },
      {
        text: 'event evt101 was deleted',
        canonicalPath: 'google-calendar/calendars/work/events/evt101.json',
      },
    ],
  });
});

test('digest treats uncancelled as updated not as cancelled (word boundary)', async () => {
  const ctx: DigestContext = {
    provider: 'google-calendar',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'uncancelled',
          canonicalPath: 'google-calendar/calendars/primary/events/evt999.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.equal(result?.bullets[0]?.text, 'event evt999 was updated');
});
