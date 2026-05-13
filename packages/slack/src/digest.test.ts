import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns null for Slack M1 no-op activity windows', async () => {
  const ctx: DigestContext = {
    provider: 'slack',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          canonicalPath: '/slack/channels/C123/messages/1747046400.000000.json',
        },
      ];
    },
  };

  assert.equal(await digest(ctx), null);
});
