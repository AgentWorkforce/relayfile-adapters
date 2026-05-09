import assert from 'node:assert/strict';
import test from 'node:test';

import { AzureBlobAdapter, AzureBlobBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('azure-blob integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_azure', accountId: 'acct' };
  const adapter = new AzureBlobAdapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new AzureBlobBridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('azure-blob', event, await adapter.fetchContent(event)));
    },
  });

  const body = [{ id: 'eventgrid-az-1', eventType: 'Microsoft.Storage.BlobCreated', eventTime: '2026-05-09T08:34:00.000Z', subject: '/blobServices/default/containers/invoices/blobs/2026/may.csv', data: { api: 'PutBlob', contentLength: 2048, contentType: 'text/csv', eTag: 'etag-az-1', url: 'https://acct.blob.core.windows.net/invoices/2026/may.csv' }, account: 'acct' }];

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 'azure-blob:eventgrid-az-1');
  assert.equal(event.source, 'azure-blob');
  assert.equal(event.changeType, 'created');
  assert.equal(event.relayfilePath, '/azure/acct/invoices/2026/may.csv');
  assert.equal(event.resourceId, 'acct/invoices/2026/may.csv');
  assert.equal(event.sizeBytes, 2048);
  assert.equal(event.fingerprint, 'etag-az-1');
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 'azure-blob:eventgrid-az-1');
  assert.equal(adapter.resolveWriteback('/azure/acct/invoices/blobs/draft-may.csv', JSON.stringify({"name":"2026/may.csv"})).operation, 'create');
  assert.throws(() => adapter.mapNangoSyncRecord({ id: 'unsupported' }), /does not declare/);
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
