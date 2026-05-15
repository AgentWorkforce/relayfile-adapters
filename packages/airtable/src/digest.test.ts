import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Airtable bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'airtable',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['airtable'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: '/airtable/bases/appXYZ/tables/tblABC/records/rec456__invoice.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'airtable/bases/appXYZ/tables/tblABC/records/rec123__contact.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'airtable',
    bullets: [
      {
        text: 'record rec123 was created',
        canonicalPath: 'airtable/bases/appXYZ/tables/tblABC/records/rec123__contact.json',
      },
      {
        text: 'record rec456 was deleted',
        canonicalPath: 'airtable/bases/appXYZ/tables/tblABC/records/rec456__invoice.json',
      },
    ],
  });
});

test('digest returns null for an empty Airtable event window', async () => {
  const ctx: DigestContext = {
    provider: 'airtable',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
