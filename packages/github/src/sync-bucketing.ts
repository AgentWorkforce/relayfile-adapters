import {
  cleanBucketRecord,
  isDeletedSyncRecord,
  modelBucket,
  readBucketId,
  readBucketString,
  safeNormalize,
} from '@relayfile/adapter-core/sync-bucketing';

import { normalizeNangoGitHubModel } from './path-mapper.js';

export const syncRecordBucketing = modelBucket<string>({
  normalizeModel: safeNormalize(normalizeNangoGitHubModel),
  buckets: {
    pull_request: 'pullRequests',
    issue: 'issues',
    repository: 'repositories',
    review: 'reviews',
    review_comment: 'reviewComments',
    check_run: 'checkRuns',
    commit: 'commits',
  },
  mapRecords(records, { modelType }) {
    const mapped: Record<string, unknown>[] = [];
    for (const raw of records) {
      if (isDeletedSyncRecord(raw)) {
        const cleaned = cleanBucketRecord(raw);
        const id =
          modelType === 'issue' || modelType === 'pull_request'
            ? readBucketId(cleaned, 'number') ?? readBucketId(cleaned, 'id')
            : readBucketId(cleaned, 'id') ?? readBucketId(cleaned, 'number');
        if (!id) continue;
        const tombstone: Record<string, unknown> = { id, _deleted: true };
        const owner = readBucketString(cleaned, 'owner');
        const repo = readBucketString(cleaned, 'repo');
        const fullName = readBucketString(cleaned, 'full_name');
        if (owner) tombstone.owner = owner;
        if (repo) tombstone.repo = repo;
        if (fullName) tombstone.full_name = fullName;
        mapped.push(tombstone);
        continue;
      }
      mapped.push(cleanBucketRecord(raw));
    }
    return mapped;
  },
});
