import { literalModelNormalizer, modelBucket } from '@relayfile/adapter-core/sync-bucketing';

export const syncRecordBucketing = modelBucket({
  normalizeModel: literalModelNormalizer({
    RecallRecording: 'recording',
    recording: 'recording',
    RecallTranscript: 'recording',
    transcript: 'recording',
  }),
  buckets: {
    recording: 'recordings',
  },
});
