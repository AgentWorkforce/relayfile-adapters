import {
  modelBucket,
  normalizeModelKey,
} from '@relayfile/adapter-core/sync-bucketing';

import { tryNormalizeXObjectType } from './path-mapper.js';

export const syncRecordBucketing = modelBucket({
  normalizeModel(model) {
    const normalized = normalizeModelKey(model);
    if (normalized === 'xsearchbundle' || normalized === 'searchbundle') {
      return 'bundle';
    }
    if (normalized === 'xsearchresult' || normalized === 'searchresult') {
      return 'result';
    }
    return tryNormalizeXObjectType(model.replace(/^X/u, '')) ?? null;
  },
  buckets: {
    bundle: 'bundles',
    search: 'searches',
    post: 'posts',
    user: 'users',
    result: 'results',
  },
});
