import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary derives Stripe summary fields from event payloads', () => {
  assert.deepEqual(
    buildSummary({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          object: 'payment_intent',
          description: 'Priority customer renewal',
          status: 'succeeded',
        },
        previous_attributes: {
          status: 'processing',
        },
      },
    }),
    {
      title: 'Priority customer renewal',
      status: 'succeeded',
      fieldsChanged: ['status'],
      tags: ['object:payment_intent', 'event:payment_intent.succeeded'],
    },
  );
});
