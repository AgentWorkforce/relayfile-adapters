import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mapJobStatusToOperationMode, mapPipelineStatusToOperationMode } from '../src/pipeline/job-mapper.js';

describe('pipeline and job status mapping', () => {
  it('treats active statuses as writes and terminal statuses as updates', () => {
    assert.strictEqual(mapPipelineStatusToOperationMode('created'), 'write');
    assert.strictEqual(mapPipelineStatusToOperationMode('pending'), 'write');
    assert.strictEqual(mapPipelineStatusToOperationMode('running'), 'write');
    assert.strictEqual(mapPipelineStatusToOperationMode('manual'), 'update');
    assert.strictEqual(mapPipelineStatusToOperationMode('skipped'), 'update');
    assert.strictEqual(mapPipelineStatusToOperationMode('waiting_for_resource'), 'update');
    assert.strictEqual(mapPipelineStatusToOperationMode('success'), 'update');
    assert.strictEqual(mapPipelineStatusToOperationMode('failed'), 'update');
    assert.strictEqual(mapPipelineStatusToOperationMode('canceled'), 'update');

    assert.strictEqual(mapJobStatusToOperationMode('created'), 'write');
    assert.strictEqual(mapJobStatusToOperationMode('pending'), 'write');
    assert.strictEqual(mapJobStatusToOperationMode('running'), 'write');
    assert.strictEqual(mapJobStatusToOperationMode('manual'), 'update');
    assert.strictEqual(mapJobStatusToOperationMode('skipped'), 'update');
    assert.strictEqual(mapJobStatusToOperationMode('success'), 'update');
    assert.strictEqual(mapJobStatusToOperationMode('failed'), 'update');
    assert.strictEqual(mapJobStatusToOperationMode('canceled'), 'update');
  });
});
