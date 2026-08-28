import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRampIndexFile } from './index-emitter.js';

test('buildRampIndexFile drops malformed rows instead of throwing during sort', () => {
  const file = buildRampIndexFile('bills', [
    { id: 'bill-2', title: 'B', updated: '2026-08-27T09:00:00.000Z', canonicalPath: '/ramp/bills/bill-2__b/meta.json' },
    { id: 'bill-1', title: 'A', updated: '2026-08-27T10:00:00.000Z', canonicalPath: '/ramp/bills/bill-1__a/meta.json' },
    { id: 'broken', title: 'Broken', canonicalPath: '/ramp/bills/broken/meta.json' } as never,
  ]);

  assert.deepEqual(JSON.parse(file.content), [
    { id: 'bill-1', title: 'A', updated: '2026-08-27T10:00:00.000Z', canonicalPath: '/ramp/bills/bill-1__a/meta.json' },
    { id: 'bill-2', title: 'B', updated: '2026-08-27T09:00:00.000Z', canonicalPath: '/ramp/bills/bill-2__b/meta.json' },
  ]);
});
