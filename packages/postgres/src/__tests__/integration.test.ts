import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresAdapter, PostgresBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('postgres integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_pg', accountId: 'appdb' };
  const adapter = new PostgresAdapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new PostgresBridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('postgres', event, await adapter.fetchContent(event)));
    },
  });

  const body = { channel: 'relayfile_storage_events', processId: 100, notification: { database: 'appdb', schema: 'public', table: 'documents', op: 'INSERT', pk: '42', occurred_at: '2026-05-09T08:39:00.000Z', row_json: { id: 42, title: 'Bridge plan' }, txid: '7331' } };

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 'postgres:appdb:public.documents:42:7331');
  assert.equal(event.source, 'postgres');
  assert.equal(event.changeType, 'created');
  assert.equal(event.relayfilePath, '/postgres/appdb/public/documents/42.json');
  assert.equal(event.resourceId, 'appdb/public/documents/42');
  assert.equal(event.sizeBytes, null);
  assert.equal(event.fingerprint, '7331');
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 'postgres:appdb:public.documents:42:7331');
  assert.equal(adapter.resolveWriteback('/postgres/appdb/public/documents/draft-bridge-plan.json', JSON.stringify({"row":{"title":"Bridge plan"}})).operation, 'create');
  assert.throws(() => adapter.mapNangoSyncRecord({ id: 'unsupported' }), /does not declare/);
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
