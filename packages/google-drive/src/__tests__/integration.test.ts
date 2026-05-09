import assert from 'node:assert/strict';
import test from 'node:test';

import { GoogleDriveAdapter, GoogleDriveBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('google-drive integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_drive', accountId: 'acct_google' };
  const adapter = new GoogleDriveAdapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new GoogleDriveBridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('google-drive', event, await adapter.fetchContent(event)));
    },
  });

  const body = {
    change: {
      time: '2026-05-09T08:30:00.000Z',
      fileId: 'file_123',
      file: { id: 'file_123', name: 'Roadmap.pdf', mimeType: 'application/pdf', size: '120', md5Checksum: 'md5-drive', driveId: 'drive_acme' }
    },
    accountId: 'acct_google'
  };

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z', headers: { 'x-goog-channel-id': 'chan-drive-1', 'x-goog-resource-id': 'drive-resource-9', 'x-goog-resource-state': 'update', 'x-goog-message-number': '42' } });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z', headers: { 'x-goog-channel-id': 'chan-drive-1', 'x-goog-resource-id': 'drive-resource-9', 'x-goog-resource-state': 'update', 'x-goog-message-number': '42' } });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 'google-drive:chan-drive-1:42:file_123');
  assert.equal(event.source, 'google-drive');
  assert.equal(event.changeType, 'updated');
  assert.equal(event.relayfilePath, '/google-drive/acct_google/Roadmap.pdf');
  assert.equal(event.resourceId, 'file_123');
  assert.equal(event.sizeBytes, 120);
  assert.equal(event.fingerprint, 'md5-drive');
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 'google-drive:chan-drive-1:42:file_123');
  assert.equal(adapter.resolveWriteback('/google-drive/files/draft-roadmap.json', JSON.stringify({"name":"Roadmap.pdf"})).operation, 'create');
  const nango = adapter.mapNangoSyncRecord({ id: 'file_123', model: 'File', name: 'example', updatedAt: '2026-05-09T00:00:00.000Z' });
  assert.equal(nango.source, 'google-drive');
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
