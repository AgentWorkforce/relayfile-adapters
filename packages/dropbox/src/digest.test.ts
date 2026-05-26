import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic Dropbox bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'dropbox',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['dropbox'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'dropbox/user/Photos/old-pic.jpg',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'file.created',
          canonicalPath: '/dropbox/user/Documents/notes.txt',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'dropbox',
    bullets: [
      {
        text: 'file Documents/notes.txt was created',
        canonicalPath: 'dropbox/user/Documents/notes.txt',
      },
      {
        text: 'file Photos/old-pic.jpg was deleted',
        canonicalPath: 'dropbox/user/Photos/old-pic.jpg',
      },
    ],
  });
});

test('digest classifies Dropbox move actions', async () => {
  const ctx: DigestContext = {
    provider: 'dropbox',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'file.moved',
          canonicalPath: 'dropbox/user/Archive/report.pdf',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'dropbox',
    bullets: [
      {
        text: 'file Archive/report.pdf was moved',
        canonicalPath: 'dropbox/user/Archive/report.pdf',
      },
    ],
  });
});

test('digest classifies Dropbox updates as modified', async () => {
  const ctx: DigestContext = {
    provider: 'dropbox',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'file.updated',
          canonicalPath: 'dropbox/user/Documents/notes.txt',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'dropbox',
    bullets: [
      {
        text: 'file Documents/notes.txt was modified',
        canonicalPath: 'dropbox/user/Documents/notes.txt',
      },
    ],
  });
});

test('digest returns null for an empty Dropbox event window', async () => {
  const ctx: DigestContext = {
    provider: 'dropbox',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest keeps real .json suffixes in Dropbox file names', async () => {
  const ctx: DigestContext = {
    provider: 'dropbox',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-json',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'file.updated',
          canonicalPath: 'dropbox/user/config/settings.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'dropbox',
    bullets: [
      {
        text: 'file config/settings.json was modified',
        canonicalPath: 'dropbox/user/config/settings.json',
      },
    ],
  });
});

test('digest classifies Dropbox archived/completed lifecycle verbs as terminal states', async () => {
  const ctx: DigestContext = {
    provider: 'dropbox',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-archived',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'file.archived',
          canonicalPath: '/dropbox/files/engineering/roadmap.md.json',
        },
        {
          id: 'evt-completed',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'file.completed',
          canonicalPath: '/dropbox/files/engineering/q2-checklist.md.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'dropbox',
    bullets: [
      {
        text: 'file engineering/roadmap.md was archived',
        canonicalPath: 'dropbox/files/engineering/roadmap.md.json',
      },
      {
        text: 'file engineering/q2-checklist.md was completed',
        canonicalPath: 'dropbox/files/engineering/q2-checklist.md.json',
      },
    ],
  });
});

test('digest renders shared-folder and shared-link records with stable identifiers', async () => {
  const ctx: DigestContext = {
    provider: 'dropbox',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-sf',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'file.updated',
          canonicalPath: '/dropbox/shared-folders/845281924.json',
        },
        {
          id: 'evt-sl',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'file.shared',
          canonicalPath: '/dropbox/shared-links/sl%3AZXhhbXBsZS1saW5r.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'dropbox',
    bullets: [
      {
        text: 'shared folder 845281924 was modified',
        canonicalPath: 'dropbox/shared-folders/845281924.json',
      },
      {
        text: 'shared link sl%3AZXhhbXBsZS1saW5r was shared',
        canonicalPath: 'dropbox/shared-links/sl%3AZXhhbXBsZS1saW5r.json',
      },
    ],
  });
});
