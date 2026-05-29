import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('reddit digest summarizes canonical events and terminal states', async () => {
  const ctx: DigestContext = {
    provider: 'reddit',
    window: { from: '2026-05-29T00:00:00.000Z', to: '2026-05-30T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['reddit'] });
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-29T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/reddit/subreddits/agentrelay.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-29T08:30:00.000Z',
          action: 'archived',
          canonicalPath: '/reddit/subreddits/agentrelay/posts/launch-week-recap__abc123.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'reddit',
    bullets: [
      {
        text: 'subreddit r/agentrelay was created',
        canonicalPath: 'reddit/subreddits/agentrelay.json',
      },
      {
        text: 'post r/agentrelay/launch-week-recap__abc123 was archived',
        canonicalPath: 'reddit/subreddits/agentrelay/posts/launch-week-recap__abc123.json',
      },
    ],
  });
});

test('reddit digest ignores aliases and non-canonical helper files', async () => {
  const ctx: DigestContext = {
    provider: 'reddit',
    window: { from: '2026-05-29T00:00:00.000Z', to: '2026-05-30T00:00:00.000Z' },
    async changeEvents() {
      return [
        { id: 'evt-1', timestamp: '2026-05-29T08:00:00.000Z', action: 'updated', canonicalPath: '/reddit/LAYOUT.md' },
        {
          id: 'evt-2',
          timestamp: '2026-05-29T08:00:01.000Z',
          action: 'updated',
          canonicalPath: '/reddit/posts/by-id/agentrelay__abc123.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-29T08:00:02.000Z',
          action: 'updated',
          canonicalPath: '/reddit/posts/by-status/archived/agentrelay__abc123.json',
        },
      ];
    },
  };

  assert.equal(await digest(ctx), null);
});
