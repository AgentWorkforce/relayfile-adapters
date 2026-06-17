import {
  basicTombstone,
  isRecordObject,
  mapToBucket,
  modelBucket,
  readBucketString,
  safeNormalize,
} from '@relayfile/adapter-core/sync-bucketing';

import { normalizeNangoLinearModel } from './path-mapper.js';

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoLinearModel),
  buckets: {
    issue: 'issues',
    comment: 'comments',
    label: 'labels',
    user: 'users',
    team: 'teams',
    project: 'projects',
    state: 'states',
    cycle: 'cycles',
    milestone: 'milestones',
    roadmap: 'roadmaps',
  },
  mapRecords(records, { modelType }) {
    const mapped = mapToBucket(records, basicTombstone);
    return modelType === 'issue'
      ? mapped.map(normalizeLinearIssueForAuxiliaryEmit)
      : mapped;
  },
});

function normalizeLinearIssueForAuxiliaryEmit(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (record._deleted === true) return record;
  if (isRecordObject(record.state)) return record;
  const stateName = readBucketString(record, 'state_name');
  if (!stateName) return record;
  return {
    ...record,
    state: { name: stateName },
  };
}
