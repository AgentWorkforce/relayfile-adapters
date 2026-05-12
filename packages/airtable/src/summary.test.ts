import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

test('buildSummary derives the Airtable title from the first changed text cell', () => {
  const summary = buildSummary({
    baseId: 'app_base',
    changedFieldIds: ['fld_name', 'fld_status'],
    changes: [
      { fieldId: 'fld_name', recordId: 'rec_1', tableId: 'tbl_tasks', type: 'update' },
      { fieldId: 'fld_status', recordId: 'rec_1', tableId: 'tbl_tasks', type: 'update' },
    ],
    payload: {
      actionMetadata: {
        sourceMetadata: {
          user: {
            id: 'usr_1',
            displayName: 'Ada Lovelace',
          },
        },
      },
      changedTablesById: {
        tbl_tasks: {
          changedRecordsById: {
            rec_1: {
              current: {
                cellValuesByFieldId: {
                  fld_name: 'Ship Airtable adapter',
                  fld_status: 'Done',
                },
              },
            },
          },
        },
      },
    },
    timestamp: '2026-05-12T01:00:00.000Z',
    webhookId: 'ach_1',
  });

  assert.deepEqual(summary, {
    actor: {
      id: 'usr_1',
      displayName: 'Ada Lovelace',
    },
    fieldsChanged: ['fld_name', 'fld_status'],
    tags: ['airtable', 'notification', 'webhook:ach_1', 'table:tbl_tasks'],
    title: 'Ship Airtable adapter',
  });
});
