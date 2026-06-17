import {
  basicTombstone,
  cleanBucketRecord,
  isDeletedSyncRecord,
  mapToBucket,
  normalizeModelKey,
  readBucketId,
  type RecordBucketMap,
  type SyncRecordBucketing,
} from '@relayfile/adapter-core/sync-bucketing';

export const syncRecordBucketing: SyncRecordBucketing = {
  bucketRecords(records, model) {
    const normalized = normalizeModelKey(model);

    if (normalized === 'slackchannel' || normalized === 'channel') {
      return { channels: mapToBucket(records, basicTombstone) };
    }
    if (normalized === 'slackuser' || normalized === 'user') {
      return { users: mapToBucket(records, basicTombstone) };
    }
    if (normalized !== 'slackmessage' && normalized !== 'message') {
      return {};
    }

    const messages: Record<string, unknown>[] = [];
    const threads: Record<string, unknown>[] = [];
    const threadReplies: Record<string, unknown>[] = [];

    for (const raw of records) {
      if (isDeletedSyncRecord(raw)) {
        const cleaned = cleanBucketRecord(raw);
        const channelId =
          readBucketId(cleaned, 'channel') ?? readBucketId(cleaned, 'channelId');
        const ts = readBucketId(cleaned, 'ts');
        const threadTs =
          readBucketId(cleaned, 'thread_ts') ?? readBucketId(cleaned, 'threadTs');
        const replyCount =
          typeof cleaned.reply_count === 'number'
            ? cleaned.reply_count
            : typeof cleaned.replyCount === 'number'
              ? cleaned.replyCount
              : 0;
        const id = readBucketId(cleaned, 'id') ?? ts ?? '';
        if (!id) continue;
        const tombstone: Record<string, unknown> = { id, _deleted: true };
        if (channelId) tombstone.channelId = channelId;
        if (ts) tombstone.ts = ts;

        if (threadTs && ts && threadTs !== ts) {
          tombstone.threadTs = threadTs;
          tombstone.replyTs = ts;
          threadReplies.push(tombstone);
        } else if ((threadTs && ts && threadTs === ts) || replyCount > 0) {
          tombstone.threadTs = threadTs ?? ts;
          threads.push(tombstone);
        } else {
          messages.push(tombstone);
        }
        continue;
      }

      const cleaned = cleanBucketRecord(raw);
      const ts = readBucketId(cleaned, 'ts');
      const threadTs =
        readBucketId(cleaned, 'thread_ts') ?? readBucketId(cleaned, 'threadTs');
      const replyCount =
        typeof cleaned.reply_count === 'number'
          ? cleaned.reply_count
          : typeof cleaned.replyCount === 'number'
            ? cleaned.replyCount
            : 0;

      if (cleaned.channelId === undefined && cleaned.channel) {
        cleaned.channelId = cleaned.channel;
      }

      if (threadTs && ts && threadTs !== ts) {
        if (cleaned.threadTs === undefined) cleaned.threadTs = threadTs;
        if (cleaned.replyTs === undefined) cleaned.replyTs = ts;
        threadReplies.push(cleaned);
      } else if ((threadTs && ts && threadTs === ts) || replyCount > 0) {
        if (cleaned.threadTs === undefined) cleaned.threadTs = threadTs ?? ts;
        threads.push(cleaned);
      } else {
        messages.push(cleaned);
      }
    }

    const buckets: RecordBucketMap = {};
    if (messages.length > 0) buckets.messages = messages;
    if (threads.length > 0) buckets.threads = threads;
    if (threadReplies.length > 0) buckets.threadReplies = threadReplies;
    return buckets;
  },
};
