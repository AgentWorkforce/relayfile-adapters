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
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'updated',
          canonicalPath: '/airtable/bases/appXYZ/tables/tblABC/records/rec789__status.json',
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
      {
        text: 'record rec789 was updated',
        canonicalPath: 'airtable/bases/appXYZ/tables/tblABC/records/rec789__status.json',
      },
    ],
  });
});

test('digest classifies Airtable terminal lifecycle actions explicitly', async () => {
  const ctx: DigestContext = {
    provider: 'airtable',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'archived',
          canonicalPath: 'airtable/bases/appXYZ/tables/tblABC/records/rec999__old.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'canceled',
          canonicalPath: 'airtable/bases/appXYZ/tables/tblABC/records/rec998__void.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'resolved',
          canonicalPath: 'airtable/bases/appXYZ/tables/tblABC/records/rec997__ticket.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'airtable',
    bullets: [
      {
        text: 'record rec999 was archived',
        canonicalPath: 'airtable/bases/appXYZ/tables/tblABC/records/rec999__old.json',
      },
      {
        text: 'record rec998 was canceled',
        canonicalPath: 'airtable/bases/appXYZ/tables/tblABC/records/rec998__void.json',
      },
      {
        text: 'record rec997 was resolved',
        canonicalPath: 'airtable/bases/appXYZ/tables/tblABC/records/rec997__ticket.json',
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
