import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary derives ClickUp task summary fields and history-driven fieldsChanged', () => {
  assert.deepEqual(
    buildSummary({
      event: 'taskUpdated',
      data: {
        name: 'Triage runtime backlog',
        status: { status: 'in progress' },
        priority: { priority: 'high' },
        tags: [{ name: 'ops' }],
        creator: {
          id: 'usr_clickup_1',
          username: 'grace',
        },
      },
      history_items: [
        {
          field: 'status',
        },
      ],
    }),
    {
      title: 'Triage runtime backlog',
      status: 'in progress',
      priority: 'high',
      labels: ['ops'],
      actor: {
        id: 'usr_clickup_1',
        displayName: 'grace',
      },
      fieldsChanged: ['status'],
      tags: ['event:taskUpdated'],
    },
  );
});
