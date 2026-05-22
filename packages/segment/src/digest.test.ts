import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Segment bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'segment',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter: Parameters<DigestContext['changeEvents']>[0]) {
      assert.deepEqual(filter, { providers: ['segment'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'track.created',
          canonicalPath: '/segment/track/button-click--msg002.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'identify.create',
          canonicalPath: 'segment/identify/user-42.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'segment',
    bullets: [
      {
        text: 'identify user-42 was created',
        canonicalPath: 'segment/identify/user-42.json',
      },
      {
        text: 'track button-click was created',
        canonicalPath: 'segment/track/button-click--msg002.json',
      },
    ],
  });
});

test('digest classifies upserted Segment events distinctly from created', async () => {
  const ctx: DigestContext = {
    provider: 'segment',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'identify.upsert',
          canonicalPath: 'segment/identify/user-a.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'identify.created',
          canonicalPath: 'segment/identify/user-b.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'segment',
    bullets: [
      {
        text: 'identify user-a was upserted',
        canonicalPath: 'segment/identify/user-a.json',
      },
      {
        text: 'identify user-b was created',
        canonicalPath: 'segment/identify/user-b.json',
      },
    ],
  });
});

test('digest identifies page and group events by resource path', async () => {
  const ctx: DigestContext = {
    provider: 'segment',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'segment/page/home--msg010.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'upserted',
          canonicalPath: 'segment/groups/grp-100.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'segment',
    bullets: [
      {
        text: 'page home was created',
        canonicalPath: 'segment/page/home--msg010.json',
      },
      {
        text: 'group grp-100 was upserted',
        canonicalPath: 'segment/groups/grp-100.json',
      },
    ],
  });
});

test('digest returns null for an empty Segment event window', async () => {
  const ctx: DigestContext = {
    provider: 'segment',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest accepts the exact /segment root canonical path', async () => {
  const ctx: DigestContext = {
    provider: 'segment',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-root',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: '/segment',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'segment',
    bullets: [{ text: 'segment was updated', canonicalPath: 'segment' }],
  });
});
