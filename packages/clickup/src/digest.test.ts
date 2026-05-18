import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';
import { clickUpFolderPath, clickUpListPath, clickUpTaskPath } from './path-mapper.js';

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
          canonicalPath: clickUpTaskPath('abc123', 'Fix bug'),
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'task.created',
          canonicalPath: clickUpTaskPath('def456', 'Add tests').slice(1),
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
        canonicalPath: 'clickup/tasks/def456.json',
      },
      {
        text: 'task abc123 was updated',
        canonicalPath: 'clickup/tasks/abc123.json',
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
          canonicalPath: clickUpTaskPath('t1', 'Done task'),
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'archived',
          canonicalPath: clickUpListPath('l1', 'Old list'),
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'deleted',
          canonicalPath: clickUpFolderPath('f1', 'Temp'),
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'clickup',
    bullets: [
      { text: 'task t1 was completed', canonicalPath: 'clickup/tasks/t1.json' },
      { text: 'list l1 was archived', canonicalPath: 'clickup/lists/l1.json' },
      { text: 'folder f1 was deleted', canonicalPath: 'clickup/folders/f1.json' },
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
