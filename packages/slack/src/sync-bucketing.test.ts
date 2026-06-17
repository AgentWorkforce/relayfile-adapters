import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { syncRecordBucketing } from './sync-bucketing.js';

describe('slack sync record bucketing', () => {
  it('splits messages into standalone messages, thread roots, and replies', () => {
    assert.deepEqual(
      syncRecordBucketing.bucketRecords(
        [
          { id: 'm1', channel: 'C1', ts: '1.000', text: 'standalone' },
          { id: 'm2', channel: 'C1', ts: '2.000', thread_ts: '2.000', reply_count: 1 },
          { id: 'm3', channel: 'C1', ts: '2.001', thread_ts: '2.000' },
        ],
        'SlackMessage',
      ),
      {
        messages: [{ id: 'm1', channel: 'C1', channelId: 'C1', ts: '1.000', text: 'standalone' }],
        threads: [
          {
            id: 'm2',
            channel: 'C1',
            channelId: 'C1',
            ts: '2.000',
            thread_ts: '2.000',
            threadTs: '2.000',
            reply_count: 1,
          },
        ],
        threadReplies: [
          {
            id: 'm3',
            channel: 'C1',
            channelId: 'C1',
            ts: '2.001',
            thread_ts: '2.000',
            threadTs: '2.000',
            replyTs: '2.001',
          },
        ],
      },
    );
  });
});
