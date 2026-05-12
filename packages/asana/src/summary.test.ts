import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary derives Asana task title, status, labels, and changed fields', () => {
  assert.deepEqual(
    buildSummary({
      data: {
        name: 'Ship M2 review fixes',
        completed: false,
        tags: [{ name: 'runtime' }, { name: 'urgent' }],
      },
      events: [
        {
          action: 'changed',
          change: {
            action: 'changed',
            field: 'completed',
          },
          user: {
            gid: 'usr_asana_1',
            name: 'Ada Lovelace',
          },
        },
      ],
    }),
    {
      title: 'Ship M2 review fixes',
      status: 'open',
      labels: ['runtime', 'urgent'],
      actor: {
        id: 'usr_asana_1',
        displayName: 'Ada Lovelace',
      },
      fieldsChanged: ['completed'],
      tags: ['action:changed'],
    },
  );
});
