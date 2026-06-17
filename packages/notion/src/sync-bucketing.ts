import {
  modelBucket,
  normalizeModelKey,
  safeNormalize,
} from '@relayfile/adapter-core/sync-bucketing';

import { normalizeNangoNotionModel } from './path-mapper.js';

export const syncRecordBucketing = modelBucket({
  normalizeModel(model) {
    const normalized = normalizeModelKey(model);
    if (normalized === 'notionuser') return 'user';
    return safeNormalize(normalizeNangoNotionModel)(model);
  },
  buckets: {
    page: 'pages',
    database: 'databases',
    user: 'users',
  },
});
