import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

const MAX_SUMMARY_JSON_LENGTH = 1024;

function assertSummaryWithinBudget(summary: unknown): void {
  const serialized = JSON.stringify(summary);
  assert.ok(
    serialized.length < MAX_SUMMARY_JSON_LENGTH,
    `expected summary JSON under ${MAX_SUMMARY_JSON_LENGTH} bytes, got ${serialized.length}`,
  );
}

test('buildSummary derives HubSpot deal summary fields from properties and propertyChange events', () => {
  const summary = buildSummary({
    objectType: 'deal',
    subscriptionType: 'deal.propertyChange',
    propertyName: 'dealstage',
    updatedByUserId: 'usr_1',
    updatedByUserName: 'Ada',
    properties: {
      dealname: 'Expand proactive runtime',
      dealstage: 'contract_sent',
      priority: 'high',
    },
  });

  assert.deepEqual(summary, {
    title: 'Expand proactive runtime',
    status: 'contract_sent',
    priority: 'high',
    actor: { id: 'usr_1', displayName: 'Ada' },
    fieldsChanged: ['dealstage'],
    tags: ['subscription:deal.propertyChange', 'object:deal'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary uses the first record for batched HubSpot payloads and redacts free-text PII', () => {
  const summary = buildSummary({
    records: [
      {
        objectType: 'deal',
        subscriptionType: 'deal.propertyChange',
        propertyName: 'dealstage',
        sourceId: 'src_1',
        properties: {
          dealname: 'Renew jane@example.com via +1 555 123 4567',
          dealstage: 'qualifiedtobuy',
        },
      },
      {
        objectType: 'contact',
        subscriptionType: 'contact.propertyChange',
        changedProperties: ['firstname', 'email'],
        properties: {
          firstname: 'Ignored',
        },
      },
    ],
  });

  assert.deepEqual(summary, {
    title: 'Renew [redacted-email] via [redacted-number]',
    status: 'qualifiedtobuy',
    actor: { id: 'src_1' },
    fieldsChanged: ['dealstage', 'firstname', 'email'],
    tags: ['subscription:deal.propertyChange', 'object:deal'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary caps oversized HubSpot summaries under the 1 KB envelope budget', () => {
  const summary = buildSummary({
    objectType: 'deal',
    subscriptionType: 'deal.propertyChange',
    propertyName: 'dealstage',
    properties: {
      dealname: `Expansion ${'renewal '.repeat(30)}jane@example.com +1 (555) 123-4567`,
      dealstage: 'contractsent',
      hs_priority: 'urgent',
    },
  });

  assert.equal(summary.title?.length, 120);
  assert.equal(summary.title?.endsWith('...'), true);
  assertSummaryWithinBudget(summary);
});
