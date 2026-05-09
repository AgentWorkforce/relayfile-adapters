import assert from 'node:assert/strict';
import test from 'node:test';

import { BoxAdapter, BoxBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('box integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_box', accountId: 'acct_box' };
  const adapter = new BoxAdapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new BoxBridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('box', event, await adapter.fetchContent(event)));
    },
  });

  const body = { id: 'box-webhook-1', trigger: 'FILE.UPLOADED', created_at: '2026-05-09T08:38:00.000Z', source: { id: 'box-file-1', type: 'file', name: 'Contract.pdf', etag: 'etag-box-1', size: 900, path_collection: { entries: [{ id: '0', name: 'All Files' }, { id: 'f1', name: 'Legal' }] } }, accountId: 'acct_box' };

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 'box:box-webhook-1:box-file-1:etag-box-1');
  assert.equal(event.source, 'box');
  assert.equal(event.changeType, 'created');
  assert.equal(event.relayfilePath, '/box/acct_box/Legal/Contract.pdf');
  assert.equal(event.resourceId, 'box-file-1');
  assert.equal(event.sizeBytes, 900);
  assert.equal(event.fingerprint, 'etag-box-1');
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 'box:box-webhook-1:box-file-1:etag-box-1');
  assert.equal(adapter.resolveWriteback('/box/files/draft-contract.json', JSON.stringify({"name":"Contract.pdf"})).operation, 'create');
  const nango = adapter.mapNangoSyncRecord({ id: 'box-file-1', model: 'BoxDocument', name: 'example', updatedAt: '2026-05-09T00:00:00.000Z' });
  assert.equal(nango.source, 'box');
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
