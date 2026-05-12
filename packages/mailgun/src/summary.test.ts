import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary derives Mailgun event titles and statuses from event-data', () => {
  assert.deepEqual(
    buildSummary({
      'event-data': {
        event: 'delivered',
        severity: 'temporary',
        domain: 'mail.example.com',
        tags: ['outbound'],
      },
    }),
    {
      title: 'delivered',
      status: 'temporary',
      labels: ['outbound'],
      tags: ['domain:mail.example.com', 'event:delivered'],
    },
  );
});
