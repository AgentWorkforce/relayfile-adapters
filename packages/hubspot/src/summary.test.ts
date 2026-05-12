import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary derives HubSpot deal summary fields from properties and propertyChange events', () => {
  assert.deepEqual(
    buildSummary({
      objectType: 'deal',
      subscriptionType: 'deal.propertyChange',
      propertyName: 'dealstage',
      properties: {
        dealname: 'Expand proactive runtime',
        dealstage: 'contract_sent',
        priority: 'high',
      },
    }),
    {
      title: 'Expand proactive runtime',
      status: 'contract_sent',
      priority: 'high',
      fieldsChanged: ['dealstage'],
      tags: ['subscription:deal.propertyChange', 'object:deal'],
    },
  );
});
