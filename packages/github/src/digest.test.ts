import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic GitHub bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'github',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['github'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'closed',
          canonicalPath: 'github/repos/acme/api/issues/43__remove-flake/meta.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'opened',
          canonicalPath: '/github/repos/acme/api/issues/42__add-login/meta.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'github',
    bullets: [
      {
        text: '#42 was opened',
        canonicalPath: 'github/repos/acme/api/issues/42__add-login/meta.json',
      },
      {
        text: '#43 was closed',
        canonicalPath: 'github/repos/acme/api/issues/43__remove-flake/meta.json',
      },
    ],
  });
});

test('digest classifies "reopened" as updated, not opened (word-boundary regex)', async () => {
  const ctx: DigestContext = {
    provider: 'github',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'reopened',
          canonicalPath: 'github/repos/acme/api/issues/42__add-login/meta.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'github',
    bullets: [
      {
        text: '#42 was updated',
        canonicalPath: 'github/repos/acme/api/issues/42__add-login/meta.json',
      },
    ],
  });
});

test('digest classifies merged pull requests distinctly from closed issues', async () => {
  const ctx: DigestContext = {
    provider: 'github',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'merged',
          canonicalPath: 'github/repos/acme/api/pulls/44__ship-it/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'github',
    bullets: [
      {
        text: '#44 was merged',
        canonicalPath: 'github/repos/acme/api/pulls/44__ship-it/meta.json',
      },
    ],
  });
});

test('digest classifies deleted events', async () => {
  const ctx: DigestContext = {
    provider: 'github',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-del-1',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'github/repos/acme/api/issues/45__cleanup/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'github',
    bullets: [
      {
        text: '#45 was deleted',
        canonicalPath: 'github/repos/acme/api/issues/45__cleanup/meta.json',
      },
    ],
  });
});

test('digest accepts path-only Relayfile change events', async () => {
  const ctx: DigestContext = {
    provider: 'github',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-path-1',
          timestamp: '2026-05-12T11:00:00.000Z',
          action: 'closed',
          path: '/github/repos/acme/api/issues/46__path-only/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'github',
    bullets: [
      {
        text: '#46 was closed',
        canonicalPath: 'github/repos/acme/api/issues/46__path-only/meta.json',
      },
    ],
  });
});

test('digest ignores GitHub alias paths without dropping canonical repos with alias-looking names', async () => {
  const ctx: DigestContext = {
    provider: 'github',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-alias',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'opened',
          canonicalPath: 'github/repos/acme__api/issues/by-title/add-login.json',
        },
        {
          id: 'evt-canonical',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'opened',
          canonicalPath: 'github/repos/issues/by-title/issues/42__add-login/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'github',
    bullets: [
      {
        text: '#42 was opened',
        canonicalPath: 'github/repos/issues/by-title/issues/42__add-login/meta.json',
      },
    ],
  });
});

test('digest returns null for an empty GitHub event window', async () => {
  const ctx: DigestContext = {
    provider: 'github',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});
