import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic ClickUp bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'clickup',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['clickup'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'task.updated',
          canonicalPath: '/clickup/tasks/abc123__fix-bug.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'task.created',
          canonicalPath: 'clickup/tasks/def456__add-tests.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'clickup',
    bullets: [
      {
        text: 'task def456 was created',
        canonicalPath: 'clickup/tasks/def456__add-tests.json',
      },
      {
        text: 'task abc123 was updated',
        canonicalPath: 'clickup/tasks/abc123__fix-bug.json',
      },
    ],
  });
});

test('digest classifies terminal states distinctly', async () => {
  const ctx: DigestContext = {
    provider: 'clickup',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'completed',
          canonicalPath: '/clickup/tasks/t1__done-task.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'archived',
          canonicalPath: '/clickup/lists/l1__old-list.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'deleted',
          canonicalPath: '/clickup/folders/f1__temp.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'clickup',
    bullets: [
      { text: 'task t1 was completed', canonicalPath: 'clickup/tasks/t1__done-task.json' },
      { text: 'list l1 was archived', canonicalPath: 'clickup/lists/l1__old-list.json' },
      { text: 'folder f1 was deleted', canonicalPath: 'clickup/folders/f1__temp.json' },
    ],
  });
});

test('digest returns null for an empty ClickUp event window', async () => {
  const ctx: DigestContext = {
    provider: 'clickup',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
