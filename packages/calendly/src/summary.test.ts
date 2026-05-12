import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary derives Calendly event title and status from the webhook payload', () => {
  assert.deepEqual(
    buildSummary({
      event: 'invitee.canceled',
      payload: {
        name: 'Demo call',
        status: 'canceled',
        location: {
          type: 'zoom',
        },
      },
    }),
    {
      title: 'Demo call',
      status: 'canceled',
      tags: ['event:invitee.canceled', 'location:zoom'],
    },
  );
});
