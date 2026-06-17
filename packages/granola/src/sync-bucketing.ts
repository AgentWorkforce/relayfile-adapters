import { literalModelNormalizer, modelBucket } from '@relayfile/adapter-core/sync-bucketing';

export const syncRecordBucketing = modelBucket({
  normalizeModel: literalModelNormalizer({
    GranolaNote: 'note',
    note: 'note',
    GranolaFolder: 'folder',
    folder: 'folder',
  }),
  buckets: {
    note: 'notes',
    folder: 'folders',
  },
});
