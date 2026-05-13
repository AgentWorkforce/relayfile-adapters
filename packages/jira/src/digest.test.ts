import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns null for Jira M1 no-op activity windows', async () => {
  const ctx: DigestContext = {
    provider: 'jira',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          canonicalPath: '/jira/issues/ENG-42.json',
        },
      ];
    },
  };

  assert.equal(await digest(ctx), null);
});
