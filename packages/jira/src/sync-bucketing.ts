import { modelBucket, safeNormalize } from '@relayfile/adapter-core/sync-bucketing';

import { normalizeJiraObjectType } from './path-mapper.js';

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeJiraObjectType),
  buckets: {
    issue: 'issues',
    project: 'projects',
    sprint: 'sprints',
    comment: 'comments',
  },
});
