import { describe, expect, it } from 'vitest';

import { mapJobStatusToOperationMode, mapPipelineStatusToOperationMode } from '../src/pipeline/job-mapper.js';

describe('pipeline and job status mapping', () => {
  it('treats active statuses as writes and terminal statuses as updates', () => {
    expect(mapPipelineStatusToOperationMode('created')).toBe('write');
    expect(mapPipelineStatusToOperationMode('pending')).toBe('write');
    expect(mapPipelineStatusToOperationMode('running')).toBe('write');
    expect(mapPipelineStatusToOperationMode('manual')).toBe('update');
    expect(mapPipelineStatusToOperationMode('skipped')).toBe('update');
    expect(mapPipelineStatusToOperationMode('waiting_for_resource')).toBe('update');
    expect(mapPipelineStatusToOperationMode('success')).toBe('update');
    expect(mapPipelineStatusToOperationMode('failed')).toBe('update');
    expect(mapPipelineStatusToOperationMode('canceled')).toBe('update');

    expect(mapJobStatusToOperationMode('created')).toBe('write');
    expect(mapJobStatusToOperationMode('pending')).toBe('write');
    expect(mapJobStatusToOperationMode('running')).toBe('write');
    expect(mapJobStatusToOperationMode('manual')).toBe('update');
    expect(mapJobStatusToOperationMode('skipped')).toBe('update');
    expect(mapJobStatusToOperationMode('success')).toBe('update');
    expect(mapJobStatusToOperationMode('failed')).toBe('update');
    expect(mapJobStatusToOperationMode('canceled')).toBe('update');
  });
});
