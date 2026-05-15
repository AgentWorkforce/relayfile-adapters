import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Mixpanel bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'mixpanel',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['mixpanel'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'profile.deleted',
          canonicalPath: '/mixpanel/profiles/user-42.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'event.create',
          canonicalPath: 'mixpanel/events/signup--ev001.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'mixpanel',
    bullets: [
      {
        text: 'event signup was created',
        canonicalPath: 'mixpanel/events/signup--ev001.json',
      },
      {
        text: 'profile user-42 was deleted',
        canonicalPath: 'mixpanel/profiles/user-42.json',
      },
    ],
  });
});

test('digest classifies merged Mixpanel profiles distinctly from deleted', async () => {
  const ctx: DigestContext = {
    provider: 'mixpanel',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'profile.merged',
          canonicalPath: 'mixpanel/profiles/user-a.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'profile.deleted',
          canonicalPath: 'mixpanel/profiles/user-b.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'mixpanel',
    bullets: [
      {
        text: 'profile user-a was merged',
        canonicalPath: 'mixpanel/profiles/user-a.json',
      },
      {
        text: 'profile user-b was deleted',
        canonicalPath: 'mixpanel/profiles/user-b.json',
      },
    ],
  });
});

test('digest identifies cohorts by resource path', async () => {
  const ctx: DigestContext = {
    provider: 'mixpanel',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'mixpanel/cohorts/power-users.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'mixpanel',
    bullets: [
      {
        text: 'cohort power-users was created',
        canonicalPath: 'mixpanel/cohorts/power-users.json',
      },
    ],
  });
});

test('digest returns null for an empty Mixpanel event window', async () => {
  const ctx: DigestContext = {
    provider: 'mixpanel',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
