import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Jira bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'jira',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['jira'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'done',
          canonicalPath: '/jira/issues/ENG-42__release-plan.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'jira:issue_created',
          canonicalPath: 'jira/issues/ENG-41__triage-login.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'jira',
    bullets: [
      {
        text: 'issue ENG-41 was created',
        canonicalPath: 'jira/issues/ENG-41__triage-login.json',
      },
      {
        text: 'issue ENG-42 was completed',
        canonicalPath: 'jira/issues/ENG-42__release-plan.json',
      },
    ],
  });
});

test('digest returns null for an empty Jira event window', async () => {
  const ctx: DigestContext = {
    provider: 'jira',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
