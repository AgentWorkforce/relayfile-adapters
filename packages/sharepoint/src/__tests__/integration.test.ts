import assert from 'node:assert/strict';
import test from 'node:test';

import { SharepointAdapter, SharepointBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('sharepoint integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_sharepoint', accountId: 'acct_sp' };
  const adapter = new SharepointAdapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new SharepointBridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('sharepoint', event, await adapter.fetchContent(event)));
    },
  });

  const body = {
    value: [{
      subscriptionId: 'sub-sp-1', changeType: 'updated', tenantId: 'tenant-a', resource: 'sites/site-a/drives/drive-a/root',
      resourceData: { id: 'item-sp-1', name: 'Plan.docx', eTag: 'etag-sp-1', size: 400, lastModifiedDateTime: '2026-05-09T08:32:00.000Z', parentReference: { siteId: 'site-a', driveId: 'drive-a', path: '/drive/root:/Shared Documents' }, file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } }
    }]
  };

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 'sharepoint:sub-sp-1:item-sp-1:etag-sp-1');
  assert.equal(event.source, 'sharepoint');
  assert.equal(event.changeType, 'updated');
  assert.equal(event.relayfilePath, '/sharepoint/site-a/drive-a/Shared Documents/Plan.docx');
  assert.equal(event.resourceId, 'site-a/drive-a/item-sp-1');
  assert.equal(event.sizeBytes, 400);
  assert.equal(event.fingerprint, 'etag-sp-1');
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 'sharepoint:sub-sp-1:item-sp-1:etag-sp-1');
  assert.equal(adapter.resolveWriteback('/sharepoint/site-a/drive-a/items/draft-plan.json', JSON.stringify({"name":"Plan.docx"})).operation, 'create');
  const nango = adapter.mapNangoSyncRecord({ id: 'item-sp-1', model: 'UserFileMetadata', name: 'example', updatedAt: '2026-05-09T00:00:00.000Z' });
  assert.equal(nango.source, 'sharepoint');
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
