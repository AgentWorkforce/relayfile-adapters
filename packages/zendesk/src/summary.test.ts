import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary derives Zendesk changed fields from ticket comments when no top-level changes block is present', () => {
  assert.deepEqual(
    buildSummary({
      ticket: {
        subject: 'Customer cannot complete checkout',
        status: 'open',
        priority: 'high',
        comments: [
          {
            id: 1,
            body: 'Updated ticket status',
          },
        ],
      },
    }),
    {
      title: 'Customer cannot complete checkout',
      status: 'open',
      priority: 'high',
      fieldsChanged: ['comments'],
    },
  );
});
