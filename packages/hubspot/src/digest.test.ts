import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from './digest.js';

test('digest returns deterministic HubSpot bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'hubspot',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['hubspot'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'merged',
          canonicalPath: '/hubspot/contacts/501.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: 'hubspot/deals/enterprise-renewal__101.json',
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: 'hubspot',
    bullets: [
      {
        text: 'deal enterprise-renewal was created',
        canonicalPath: 'hubspot/deals/enterprise-renewal__101.json',
      },
      {
        text: 'contact 501 was merged',
        canonicalPath: 'hubspot/contacts/501.json',
      },
    ],
  });
});

test('digest classifies terminal states distinctly', async () => {
  const ctx: DigestContext = {
    provider: 'hubspot',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'deleted',
          canonicalPath: '/hubspot/companies/old-co__201.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'merged',
          canonicalPath: '/hubspot/contacts/dup__301.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'ticket.resolved',
          canonicalPath: '/hubspot/tickets/support-case__401.json',
        },
        {
          id: 'evt-4',
          timestamp: '2026-05-12T11:00:00.000Z',
          action: 'deal.canceled',
          canonicalPath: '/hubspot/deals/churn-risk__501.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'hubspot',
    bullets: [
      { text: 'company old-co was deleted', canonicalPath: 'hubspot/companies/old-co__201.json' },
      { text: 'contact dup was merged', canonicalPath: 'hubspot/contacts/dup__301.json' },
      { text: 'ticket support-case was resolved', canonicalPath: 'hubspot/tickets/support-case__401.json' },
      { text: 'deal churn-risk was canceled', canonicalPath: 'hubspot/deals/churn-risk__501.json' },
    ],
  });
});

test('digest returns null for an empty HubSpot event window', async () => {
  const ctx: DigestContext = {
    provider: 'hubspot',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest emits one bullet per canonical record and skips the by-id alias mirror', async () => {
  // emitHubSpotAuxiliaryFiles writes canonical + by-id alias for every record;
  // the digest must collapse the pair to a single bullet, not duplicate it.
  const ctx: DigestContext = {
    provider: 'hubspot',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/hubspot/deals/501.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'created',
          canonicalPath: '/hubspot/deals/by-id/501.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: '/hubspot/contacts/301.json',
        },
        {
          id: 'evt-4',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: '/hubspot/contacts/by-id/301.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'hubspot',
    bullets: [
      { text: 'deal 501 was created', canonicalPath: 'hubspot/deals/501.json' },
      { text: 'contact 301 was updated', canonicalPath: 'hubspot/contacts/301.json' },
    ],
  });
});

test('digest handles id-only canonical paths produced by emitHubSpotAuxiliaryFiles', async () => {
  // emit-aux writes /hubspot/<bucket>/<id>.json with no slug prefix because
  // HubSpot CRM ids are stable numeric strings. hubspotIdentifier must surface
  // the bare id when no `<slug>__<id>` form is present.
  const ctx: DigestContext = {
    provider: 'hubspot',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'deal.closed',
          canonicalPath: '/hubspot/deals/501.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'ticket.archived',
          canonicalPath: '/hubspot/tickets/401.json',
        },
      ];
    },
  };

  const result = await digest(ctx);
  assert.deepEqual(result, {
    provider: 'hubspot',
    bullets: [
      { text: 'deal 501 was closed', canonicalPath: 'hubspot/deals/501.json' },
      { text: 'ticket 401 was archived', canonicalPath: 'hubspot/tickets/401.json' },
    ],
  });
});
