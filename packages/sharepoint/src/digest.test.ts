import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic SharePoint bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'sharepoint',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['sharepoint'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'sharepoint/site1/drive1/Docs/old-plan.pptx',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/sharepoint/site1/drive1/Docs/new-plan.pptx',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'sharepoint',
    bullets: [
      {
        text: 'item Docs/new-plan.pptx was created',
        canonicalPath: 'sharepoint/site1/drive1/Docs/new-plan.pptx',
      },
      {
        text: 'item Docs/old-plan.pptx was deleted',
        canonicalPath: 'sharepoint/site1/drive1/Docs/old-plan.pptx',
      },
    ],
  });
});

test('digest classifies SharePoint check-in and check-out actions', async () => {
  const ctx: DigestContext = {
    provider: 'sharepoint',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'checked_out',
          canonicalPath: 'sharepoint/site1/drive1/Docs/contract.docx',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'checkin',
          canonicalPath: 'sharepoint/site1/drive1/Docs/contract.docx',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'sharepoint',
    bullets: [
      {
        text: 'item Docs/contract.docx was checked out',
        canonicalPath: 'sharepoint/site1/drive1/Docs/contract.docx',
      },
      {
        text: 'item Docs/contract.docx was checked in',
        canonicalPath: 'sharepoint/site1/drive1/Docs/contract.docx',
      },
    ],
  });
});

test('digest returns null for an empty SharePoint event window', async () => {
  const ctx: DigestContext = {
    provider: 'sharepoint',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest keeps real .json suffixes in SharePoint item names', async () => {
  const ctx: DigestContext = {
    provider: 'sharepoint',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-json',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'item.updated',
          canonicalPath: 'sharepoint/site/drive/config/settings.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'sharepoint',
    bullets: [
      {
        text: 'item config/settings.json was modified',
        canonicalPath: 'sharepoint/site/drive/config/settings.json',
      },
    ],
  });
});

test('digest strips SharePoint artificial record suffixes', async () => {
  const ctx: DigestContext = {
    provider: 'sharepoint',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-wrapper',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'item.updated',
          canonicalPath: 'sharepoint/site-a/drive-a/items/item-sp-1.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'sharepoint',
    bullets: [
      {
        text: 'item item-sp-1 was modified',
        canonicalPath: 'sharepoint/site-a/drive-a/items/item-sp-1.json',
      },
    ],
  });
});
