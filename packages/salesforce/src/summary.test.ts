import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary uses ChangeEventHeader changed fields when Salesforce omits a top-level changes block', () => {
  assert.deepEqual(
    buildSummary({
      data: {
        Subject: 'Escalated enterprise case',
        Status: 'Working',
        Priority: 'High',
        RecordTypeId: '012000000000001',
      },
      ChangeEventHeader: {
        changedFields: ['Status', 'Priority'],
      },
    }),
    {
      title: 'Escalated enterprise case',
      status: 'Working',
      priority: 'High',
      fieldsChanged: ['Status', 'Priority'],
      tags: ['record_type:012000000000001'],
    },
  );
});
