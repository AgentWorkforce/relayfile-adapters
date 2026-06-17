import { modelBucket, safeNormalize } from '@relayfile/adapter-core/sync-bucketing';

import { normalizeNangoHubSpotModel } from './path-mapper.js';

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoHubSpotModel),
  buckets: {
    contact: 'contacts',
    company: 'companies',
    deal: 'deals',
    ticket: 'tickets',
  },
});
