import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Confluence bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'confluence',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['confluence'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'archived',
          canonicalPath: '/confluence/pages/123__release-plan.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'page.updated',
          canonicalPath: 'confluence/pages/124__follow-up.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'confluence/spaces/ENG.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'confluence',
    bullets: [
      {
        text: 'space ENG was created',
        canonicalPath: 'confluence/spaces/ENG.json',
      },
      {
        text: 'page 123 was archived',
        canonicalPath: 'confluence/pages/123__release-plan.json',
      },
      {
        text: 'page 124 was updated',
        canonicalPath: 'confluence/pages/124__follow-up.json',
      },
    ],
  });
});

test('digest returns null for an empty Confluence event window', async () => {
  const ctx: DigestContext = {
    provider: 'confluence',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest classifies Confluence trash, archive, and remove actions distinctly', async () => {
  const ctx: DigestContext = {
    provider: 'confluence',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'page.trashed',
          canonicalPath: 'confluence/pages/123__release-plan.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'page.archived',
          canonicalPath: 'confluence/pages/124__old-plan.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'page.remove',
          canonicalPath: 'confluence/pages/125__deleted-plan.json',
        },
        {
          id: 'evt-4',
          timestamp: '2026-05-12T11:00:00.000Z',
          action: 'page.restored',
          canonicalPath: 'confluence/pages/126__restored-plan.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'confluence',
    bullets: [
      {
        text: 'page 123 was trashed',
        canonicalPath: 'confluence/pages/123__release-plan.json',
      },
      {
        text: 'page 124 was archived',
        canonicalPath: 'confluence/pages/124__old-plan.json',
      },
      {
        text: 'page 125 was deleted',
        canonicalPath: 'confluence/pages/125__deleted-plan.json',
      },
      {
        text: 'page 126 was restored',
        canonicalPath: 'confluence/pages/126__restored-plan.json',
      },
    ],
  });
});

test('digest ignores Confluence aliases without dropping canonical alias-shaped space keys', async () => {
  const ctx: DigestContext = {
    provider: 'confluence',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-alias-page',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'page.updated',
          canonicalPath: 'confluence/pages/by-title/release-plan.json',
        },
        {
          id: 'evt-alias-space',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'space.created',
          canonicalPath: 'confluence/spaces/by-title/engineering.json',
        },
        {
          id: 'evt-canonical-page',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'page.updated',
          canonicalPath: 'confluence/spaces/by-title/pages/123__release-plan.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'confluence',
    bullets: [
      {
        text: 'page 123 was updated',
        canonicalPath: 'confluence/spaces/by-title/pages/123__release-plan.json',
      },
    ],
  });
});
