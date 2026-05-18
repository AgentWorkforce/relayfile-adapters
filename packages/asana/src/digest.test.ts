import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';
import { asanaProjectPath, asanaTaskPath } from './path-mapper.js';

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
          canonicalPath: asanaTaskPath('12345', 'Fix login'),
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'added',
          canonicalPath: asanaTaskPath('67890', 'Setup CI').slice(1),
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
        text: 'task 67890 was created',
        canonicalPath: 'asana/tasks/67890.json',
      },
      {
        text: 'task 12345 was completed',
        canonicalPath: 'asana/tasks/12345.json',
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
          canonicalPath: asanaProjectPath('111', 'Old project'),
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'done',
          canonicalPath: asanaTaskPath('222', 'Ship feature'),
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'asana',
    bullets: [
      { text: 'project 111 was deleted', canonicalPath: 'asana/projects/111.json' },
      { text: 'task 222 was completed', canonicalPath: 'asana/tasks/222.json' },
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
          canonicalPath: asanaTaskPath('333', 'Rename title'),
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'asana',
    bullets: [
      { text: 'task 333 was updated', canonicalPath: 'asana/tasks/333.json' },
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
          path: asanaTaskPath('333', 'Rename title'),
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
      { text: 'task 333 was updated', canonicalPath: 'asana/tasks/333.json' },
    ],
  });
});

test('digest keeps canonical filenames whose id starts with by-', async () => {
  const ctx: DigestContext = {
    provider: 'asana',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-canonical-by-slug',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'changed',
          path: asanaTaskPath('by-design', 'Ignored title'),
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'asana',
    bullets: [
      { text: 'task by-design was updated', canonicalPath: 'asana/tasks/by-design.json' },
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
