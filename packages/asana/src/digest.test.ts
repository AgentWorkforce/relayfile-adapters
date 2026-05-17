import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Asana bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'asana',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['asana'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'completed',
          canonicalPath: '/asana/tasks/fix-login__12345.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'added',
          canonicalPath: 'asana/tasks/setup-ci__67890.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'asana',
    bullets: [
      {
        text: 'task setup-ci was created',
        canonicalPath: 'asana/tasks/setup-ci__67890.json',
      },
      {
        text: 'task fix-login was completed',
        canonicalPath: 'asana/tasks/fix-login__12345.json',
      },
    ],
  });
});

test('digest classifies terminal states distinctly', async () => {
  const ctx: DigestContext = {
    provider: 'asana',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'deleted',
          canonicalPath: '/asana/projects/old-project__111.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'done',
          canonicalPath: '/asana/tasks/ship-feature__222.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'asana',
    bullets: [
      { text: 'project old-project was deleted', canonicalPath: 'asana/projects/old-project__111.json' },
      { text: 'task ship-feature was completed', canonicalPath: 'asana/tasks/ship-feature__222.json' },
    ],
  });
});

test('digest renders non-terminal changes as updated', async () => {
  const ctx: DigestContext = {
    provider: 'asana',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'changed',
          canonicalPath: '/asana/tasks/rename-title__333.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'asana',
    bullets: [
      { text: 'task rename-title was updated', canonicalPath: 'asana/tasks/rename-title__333.json' },
    ],
  });
});

test('digest ignores alias, index, and layout writes', async () => {
  const ctx: DigestContext = {
    provider: 'asana',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-canonical',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'changed',
          path: '/asana/tasks/rename-title__333.json',
        },
        {
          id: 'evt-by-id',
          timestamp: '2026-05-12T08:00:01.000Z',
          action: 'changed',
          path: '/asana/tasks/by-id/333.json',
        },
        {
          id: 'evt-by-state',
          timestamp: '2026-05-12T08:00:02.000Z',
          action: 'changed',
          path: '/asana/tasks/by-state/open/333.json',
        },
        {
          id: 'evt-index',
          timestamp: '2026-05-12T08:00:03.000Z',
          action: 'changed',
          path: '/asana/tasks/_index.json',
        },
        {
          id: 'evt-layout',
          timestamp: '2026-05-12T08:00:04.000Z',
          action: 'changed',
          path: '/asana/LAYOUT.md',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'asana',
    bullets: [
      { text: 'task rename-title was updated', canonicalPath: 'asana/tasks/rename-title__333.json' },
    ],
  });
});

test('digest keeps canonical filenames whose slug starts with by-', async () => {
  const ctx: DigestContext = {
    provider: 'asana',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-canonical-by-slug',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'changed',
          path: '/asana/tasks/by-design__333.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'asana',
    bullets: [
      { text: 'task by-design was updated', canonicalPath: 'asana/tasks/by-design__333.json' },
    ],
  });
});

test('digest returns null for an empty Asana event window', async () => {
  const ctx: DigestContext = {
    provider: 'asana',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
