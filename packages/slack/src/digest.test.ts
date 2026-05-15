import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Slack bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'slack',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['slack'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: '/slack/channels/C123/messages/1747046400.000000.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'posted',
          canonicalPath: 'slack/channels/C999.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'slack',
    bullets: [
      {
        text: 'channel C999 was created',
        canonicalPath: 'slack/channels/C999.json',
      },
      {
        text: 'message 1747046400.000000 was deleted',
        canonicalPath: 'slack/channels/C123/messages/1747046400.000000.json',
      },
    ],
  });
});

test('digest returns null for an empty Slack event window', async () => {
  const ctx: DigestContext = {
    provider: 'slack',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest classifies Slack channel archive and unarchive state changes', async () => {
  const ctx: DigestContext = {
    provider: 'slack',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'channel.archived',
          canonicalPath: 'slack/channels/C123__general.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'channel.unarchived',
          canonicalPath: 'slack/channels/C123__general.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'slack',
    bullets: [
      {
        text: 'channel C123 was archived',
        canonicalPath: 'slack/channels/C123__general.json',
      },
      {
        text: 'channel C123 was unarchived',
        canonicalPath: 'slack/channels/C123__general.json',
      },
    ],
  });
});

test('digest classifies Slack channel updates and meta paths', async () => {
  const ctx: DigestContext = {
    provider: 'slack',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'channel.changed',
          canonicalPath: 'slack/channels/C321__ops/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'slack',
    bullets: [
      {
        text: 'channel C321 was updated',
        canonicalPath: 'slack/channels/C321__ops/meta.json',
      },
    ],
  });
});

test('digest accepts the exact /slack root canonical path', async () => {
  const ctx: DigestContext = {
    provider: 'slack',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-root',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: '/slack',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'slack',
    bullets: [{ text: 'slack was updated', canonicalPath: 'slack' }],
  });
});
