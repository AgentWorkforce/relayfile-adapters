import assert from 'node:assert/strict';
import test from 'node:test';

import { RedisAdapter, RedisBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('redis integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_redis', accountId: '0' };
  const adapter = new RedisAdapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new RedisBridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('redis', event, await adapter.fetchContent(event)));
    },
  });

  const body = { pattern: '__keyspace@0__:*', channel: '__keyspace@0__:session:42', message: 'set', db: 0, key: 'session:42', type: 'hash', value: { userId: 'u1' }, detectedAt: '2026-05-09T08:40:00.000Z' };

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 'redis:0:session:42:set:2026-05-09T08:40:00.000Z');
  assert.equal(event.source, 'redis');
  assert.equal(event.changeType, 'updated');
  assert.equal(event.relayfilePath, '/redis/0/session:42.json');
  assert.equal(event.resourceId, '0/session:42');
  assert.equal(event.sizeBytes, null);
  assert.equal(event.fingerprint, null);
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 'redis:0:session:42:set:2026-05-09T08:40:00.000Z');
  assert.equal(adapter.resolveWriteback('/redis/0/draft-session:43.json', JSON.stringify({"key":"session:43","type":"hash","value":{"userId":"u2"}})).operation, 'create');
  assert.throws(() => adapter.mapNangoSyncRecord({ id: 'unsupported' }), /does not declare/);
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
