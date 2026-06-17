import { modelBucket, safeNormalize } from '@relayfile/adapter-core/sync-bucketing';

import { normalizeNangoDaytonaModel } from './path-mapper.js';

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoDaytonaModel),
  buckets: {
    usage: 'usage',
  },
});
