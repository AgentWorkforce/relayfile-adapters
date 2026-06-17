import { modelBucket, safeNormalize } from '@relayfile/adapter-core/sync-bucketing';

import { normalizeNangoConfluenceModel } from './path-mapper.js';

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoConfluenceModel),
  buckets: {
    page: 'pages',
    space: 'spaces',
  },
});
