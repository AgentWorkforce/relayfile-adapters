import assert from 'node:assert/strict';
import test from 'node:test';

import { GcsAdapter, GcsBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('gcs integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_gcs', accountId: 'acct_google' };
  const adapter = new GcsAdapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new GcsBridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('gcs', event, await adapter.fetchContent(event)));
    },
  });

  const body = {
    message: {
      messageId: 'pubsub-gcs-88',
      publishTime: '2026-05-09T08:31:00.000Z',
      attributes: { eventType: 'OBJECT_FINALIZE', bucketId: 'rf-archive', objectId: 'reports/q2.json', objectGeneration: '1715243460' },
      data: Buffer.from(JSON.stringify({ bucket: 'rf-archive', name: 'reports/q2.json', size: '19', md5Hash: 'gcs-md5', contentType: 'application/json' })).toString('base64')
    }
  };

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 'gcs:pubsub-gcs-88:rf-archive:reports/q2.json:1715243460');
  assert.equal(event.source, 'gcs');
  assert.equal(event.changeType, 'created');
  assert.equal(event.relayfilePath, '/gcs/rf-archive/reports/q2.json');
  assert.equal(event.resourceId, 'rf-archive/reports/q2.json#1715243460');
  assert.equal(event.sizeBytes, 19);
  assert.equal(event.fingerprint, 'gcs-md5');
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 'gcs:pubsub-gcs-88:rf-archive:reports/q2.json:1715243460');
  assert.equal(adapter.resolveWriteback('/gcs/rf-archive/objects/draft-q2.json', JSON.stringify({"bucket":"rf-archive","name":"reports/q2.json"})).operation, 'create');
  assert.throws(() => adapter.mapNangoSyncRecord({ id: 'unsupported' }), /does not declare/);
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
