import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from '../src/digest.js';

test('digest returns deterministic GitLab bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['gitlab'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'closed',
          canonicalPath: 'gitlab/projects/acme/api/issues/43__remove-flake/meta.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'opened',
          canonicalPath: '/gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'MR !42 was opened',
        canonicalPath: 'gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json',
      },
      {
        text: 'issue #43 was closed',
        canonicalPath: 'gitlab/projects/acme/api/issues/43__remove-flake/meta.json',
      },
    ],
  });
});

test('digest classifies reopened as updated and returns null for empty windows', async () => {
  const reopened: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'reopened',
          canonicalPath: 'gitlab/projects/acme/api/issues/42__add-login/meta.json',
        },
      ];
    },
  };
  assert.deepEqual(await digest(reopened), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'issue #42 was updated',
        canonicalPath: 'gitlab/projects/acme/api/issues/42__add-login/meta.json',
      },
    ],
  });

  assert.equal(
    await digest({
      provider: 'gitlab',
      window: reopened.window,
      async changeEvents() {
        return [];
      },
    }),
    null,
  );
});

test('digest classifies merged merge requests distinctly from closed issues', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'merged',
          canonicalPath: 'gitlab/projects/acme/api/merge_requests/42__ship-it/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'MR !42 was merged',
        canonicalPath: 'gitlab/projects/acme/api/merge_requests/42__ship-it/meta.json',
      },
    ],
  });
});
