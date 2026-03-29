import type { JobStatus, PipelineStatus } from '../types.js';

export function mapJobStatusToOperationMode(status: JobStatus): 'update' | 'write' {
  switch (status) {
    case 'created':
    case 'pending':
    case 'running':
      return 'write';
    default:
      return 'update';
  }
}

export function mapPipelineStatusToOperationMode(status: PipelineStatus): 'update' | 'write' {
  switch (status) {
    case 'created':
    case 'pending':
    case 'running':
      return 'write';
    default:
      return 'update';
  }
}
