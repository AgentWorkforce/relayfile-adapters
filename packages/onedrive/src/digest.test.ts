import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic OneDrive bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'onedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['onedrive'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'onedrive/me/Documents/old-draft.docx',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/onedrive/me/Documents/budget.xlsx',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'onedrive',
    bullets: [
      {
        text: 'item Documents/budget.xlsx was created',
        canonicalPath: 'onedrive/me/Documents/budget.xlsx',
      },
      {
        text: 'item Documents/old-draft.docx was deleted',
        canonicalPath: 'onedrive/me/Documents/old-draft.docx',
      },
    ],
  });
});

test('digest classifies OneDrive move actions', async () => {
  const ctx: DigestContext = {
    provider: 'onedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'moved',
          canonicalPath: 'onedrive/me/Archive/report.pdf',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'onedrive',
    bullets: [
      {
        text: 'item Archive/report.pdf was moved',
        canonicalPath: 'onedrive/me/Archive/report.pdf',
      },
    ],
  });
});

test('digest maps non-terminal OneDrive actions to modified wording', async () => {
  const ctx: DigestContext = {
    provider: 'onedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: 'onedrive/me/Documents/notes.txt',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'onedrive',
    bullets: [
      {
        text: 'item Documents/notes.txt was modified',
        canonicalPath: 'onedrive/me/Documents/notes.txt',
      },
    ],
  });
});

test('digest accepts the leading-slash OneDrive root path', async () => {
  const ctx: DigestContext = {
    provider: 'onedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: '/onedrive',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'onedrive',
    bullets: [
      {
        text: 'item onedrive was modified',
        canonicalPath: 'onedrive',
      },
    ],
  });
});

test('digest returns null for an empty OneDrive event window', async () => {
  const ctx: DigestContext = {
    provider: 'onedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest keeps real .json suffixes in OneDrive item names', async () => {
  const ctx: DigestContext = {
    provider: 'onedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-json',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'item.updated',
          canonicalPath: 'onedrive/user/config/settings.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'onedrive',
    bullets: [
      {
        text: 'item config/settings.json was modified',
        canonicalPath: 'onedrive/user/config/settings.json',
      },
    ],
  });
});

test('digest strips OneDrive artificial record suffixes', async () => {
  const ctx: DigestContext = {
    provider: 'onedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-wrapper',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'item.updated',
          canonicalPath: 'onedrive/acct_one/items/item-od-1.json',
          content: { id: 'item-od-1', name: 'Budget.xlsx', webUrl: 'https://example.test/budget' },
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'onedrive',
    bullets: [
      {
        text: 'item Budget.xlsx was modified',
        canonicalPath: 'onedrive/acct_one/items/item-od-1.json',
      },
    ],
  });
});

test('digest strips OneDrive wrapper suffixes for encoded ids', async () => {
  const ctx: DigestContext = {
    provider: 'onedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-wrapper-encoded',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'item.updated',
          canonicalPath: 'onedrive/acct_one/items/item%20123.json',
          content: { id: 'item 123', name: 'Budget.xlsx', webUrl: 'https://example.test/budget' },
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'onedrive',
    bullets: [
      {
        text: 'item Budget.xlsx was modified',
        canonicalPath: 'onedrive/acct_one/items/item%20123.json',
      },
    ],
  });
});

test('digest uses provider names for .json writeback wrapper records', async () => {
  const ctx: DigestContext = {
    provider: 'onedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-collision',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'item.updated',
          canonicalPath: 'onedrive/acct_one/items/settings.json',
          content: { id: 'settings', name: 'settings.json', webUrl: 'https://example.test/settings' },
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'onedrive',
    bullets: [
      {
        text: 'item settings.json was modified',
        canonicalPath: 'onedrive/acct_one/items/settings.json',
      },
    ],
  });
});

test('digest preserves nested .json files when items is a real OneDrive folder name', async () => {
  const ctx: DigestContext = {
    provider: 'onedrive',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-collision',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'item.updated',
          canonicalPath: 'onedrive/acct_one/items/config/settings.json',
          content: { id: 'settings', name: 'settings.json', webUrl: 'https://example.test/settings' },
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'onedrive',
    bullets: [
      {
        text: 'item items/config/settings.json was modified',
        canonicalPath: 'onedrive/acct_one/items/config/settings.json',
      },
    ],
  });
});
