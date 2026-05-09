import assert from 'node:assert/strict';
import test from 'node:test';

import { OnedriveAdapter, OnedriveBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('onedrive integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_onedrive', accountId: 'acct_one' };
  const adapter = new OnedriveAdapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new OnedriveBridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('onedrive', event, await adapter.fetchContent(event)));
    },
  });

  const body = {
    value: [{
      subscriptionId: 'sub-od-1', changeType: 'updated', resource: 'me/drive/root', accountId: 'acct_one',
      resourceData: { id: 'item-od-1', name: 'Budget.xlsx', eTag: 'etag-od-1', size: 512, lastModifiedDateTime: '2026-05-09T08:33:00.000Z', parentReference: { driveId: 'drive-one', path: '/drive/root:/Finance' }, file: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }
    }]
  };

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 'onedrive:sub-od-1:item-od-1:etag-od-1');
  assert.equal(event.source, 'onedrive');
  assert.equal(event.changeType, 'updated');
  assert.equal(event.relayfilePath, '/onedrive/acct_one/Finance/Budget.xlsx');
  assert.equal(event.resourceId, 'drive-one/item-od-1');
  assert.equal(event.sizeBytes, 512);
  assert.equal(event.fingerprint, 'etag-od-1');
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 'onedrive:sub-od-1:item-od-1:etag-od-1');
  assert.equal(adapter.resolveWriteback('/onedrive/acct_one/items/draft-budget.json', JSON.stringify({"name":"Budget.xlsx"})).operation, 'create');
  const nango = adapter.mapNangoSyncRecord({ id: 'item-od-1', model: 'OneDriveFile', name: 'example', updatedAt: '2026-05-09T00:00:00.000Z' });
  assert.equal(nango.source, 'onedrive');
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
