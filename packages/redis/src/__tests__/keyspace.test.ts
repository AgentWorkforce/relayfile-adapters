import assert from 'node:assert/strict';
import test from 'node:test';

import { RedisBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('redis mocked keyspace notification routes to relayfile path', async () => {
  const redis = new MockRedisKeyspace();
  const published: StorageBridgeEvent[] = [];
  const bridge = new RedisBridge({ workspaceId: 'ws_storage', connectionId: 'conn_redis', accountId: '0' }, {
    publish: (event) => {
      published.push(event);
    },
  });

  redis.psubscribe('__keyspace@0__:*', async (_pattern, channel, message) => {
    const key = channel.replace('__keyspace@0__:', '');
    await bridge.handleNotification({
      body: {
        eventId: `redis:0:${key}:${message}:2026-05-09T08:41:00.000Z`,
        eventType: message,
        resourceId: `0/${key}`,
        relayfilePath: `/redis/0/${key}`,
        occurredAt: '2026-05-09T08:41:00.000Z',
        redis: { db: 0, key, type: 'string', value: 'enabled' },
      },
      receivedAt: '2026-05-09T08:41:05.000Z',
    });
  });

  await redis.set('feature:flag', 'enabled');

  assert.equal(published.length, 1);
  assert.equal(published[0]?.source, 'redis');
  assert.equal(published[0]?.relayfilePath, '/redis/0/feature:flag');
  assert.deepEqual(((published[0]?.metadata.raw as Record<string, unknown>).redis as Record<string, unknown>).value, 'enabled');
});

class MockRedisKeyspace {
  private handler: ((pattern: string, channel: string, message: string) => Promise<void>) | undefined;

  psubscribe(pattern: string, handler: (pattern: string, channel: string, message: string) => Promise<void>): void {
    assert.equal(pattern, '__keyspace@0__:*');
    this.handler = handler;
  }

  async set(key: string, _value: string): Promise<void> {
    assert.ok(this.handler);
    await this.handler('__keyspace@0__:*', `__keyspace@0__:${key}`, 'set');
  }
}
