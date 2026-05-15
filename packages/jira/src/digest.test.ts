import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';
import { jiraIssuePath } from './path-mapper.js';

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
          canonicalPath: jiraIssuePath('ENG-42', 'Release Plan'),
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'jira:issue_updated',
          canonicalPath: jiraIssuePath('ENG-43', 'Follow Up'),
        },
        {
          id: 'evt-4',
          timestamp: '2026-05-12T11:00:00.000Z',
          action: 'deleted',
          canonicalPath: jiraIssuePath('ENG-44', 'Obsolete'),
        },
        {
          id: 'evt-5',
          timestamp: '2026-05-12T12:00:00.000Z',
          action: 'canceled',
          canonicalPath: jiraIssuePath('ENG-45', 'Cancelled'),
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'jira:issue_created',
          canonicalPath: jiraIssuePath('ENG-41', 'Triage Login').replace(/^\//u, ''),
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
        canonicalPath: 'jira/issues/triage-login__ENG-41.json',
      },
      {
        text: 'issue ENG-42 was completed',
        canonicalPath: 'jira/issues/release-plan__ENG-42.json',
      },
      {
        text: 'issue ENG-43 was updated',
        canonicalPath: 'jira/issues/follow-up__ENG-43.json',
      },
      {
        text: 'issue ENG-44 was deleted',
        canonicalPath: 'jira/issues/obsolete__ENG-44.json',
      },
      {
        text: 'issue ENG-45 was completed',
        canonicalPath: 'jira/issues/cancelled__ENG-45.json',
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
