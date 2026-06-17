import {
  mapToBucket,
  modelBucket,
  safeNormalize,
} from '@relayfile/adapter-core/sync-bucketing';

import { normalizeNangoRedditModel } from './path-mapper.js';

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoRedditModel),
  buckets: {
    subreddit: 'subreddits',
    post: 'posts',
  },
  mapRecords(records, { modelType }) {
    return mapToBucket(records, (id) => ({ id, _deleted: true, objectType: modelType }));
  },
});
