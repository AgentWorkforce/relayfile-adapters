import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from '../src/digest.js';

test('digest returns deterministic Teams bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'teams',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['teams'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: 'teams/team-1/channels/ch-1/messages/msg-002.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/teams/team-1/channels/ch-1/messages/msg-001.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'teams',
    bullets: [
      {
        text: 'message msg-001 was created',
        canonicalPath: 'teams/team-1/channels/ch-1/messages/msg-001.json',
      },
      {
        text: 'message msg-002 was updated',
        canonicalPath: 'teams/team-1/channels/ch-1/messages/msg-002.json',
      },
    ],
  });
});

test('digest returns null for an empty Teams event window', async () => {
  const ctx: DigestContext = {
    provider: 'teams',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest classifies Teams archive and delete lifecycle states', async () => {
  const ctx: DigestContext = {
    provider: 'teams',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'channel.archived',
          canonicalPath: 'teams/team-1/channels/ch-2/metadata.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'message.deleted',
          canonicalPath: 'teams/team-1/channels/ch-1/messages/msg-003.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'teams',
    bullets: [
      {
        text: 'channel ch-2 was archived',
        canonicalPath: 'teams/team-1/channels/ch-2/metadata.json',
      },
      {
        text: 'message msg-003 was deleted',
        canonicalPath: 'teams/team-1/channels/ch-1/messages/msg-003.json',
      },
    ],
  });
});

test('digest treats unarchived as updated not as archived (word boundary)', async () => {
  const ctx: DigestContext = {
    provider: 'teams',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'unarchived',
          canonicalPath: 'teams/team-1/channels/ch-3/metadata.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.equal(result?.bullets[0]?.text, 'channel ch-3 was updated');
});
