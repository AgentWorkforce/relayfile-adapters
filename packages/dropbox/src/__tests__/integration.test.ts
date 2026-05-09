import assert from 'node:assert/strict';
import test from 'node:test';

import { DropboxAdapter, DropboxBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('dropbox integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_dropbox', accountId: 'acct_dbx' };
  const adapter = new DropboxAdapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new DropboxBridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('dropbox', event, await adapter.fetchContent(event)));
    },
  });

  const body = { list_folder: { accounts: ['acct_dbx'], cursor: 'cursor-2', entries: [{ '.tag': 'file', id: 'id:dbx-file', name: 'notes.md', path_lower: '/team/notes.md', path_display: '/Team/Notes.md', server_modified: '2026-05-09T08:35:00.000Z', rev: 'rev-1', size: 33, content_hash: 'hash-dbx' }] } };

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 'dropbox:acct_dbx:cursor-2:/team/notes.md:rev-1');
  assert.equal(event.source, 'dropbox');
  assert.equal(event.changeType, 'updated');
  assert.equal(event.relayfilePath, '/dropbox/acct_dbx/Team/Notes.md');
  assert.equal(event.resourceId, 'id:dbx-file');
  assert.equal(event.sizeBytes, 33);
  assert.equal(event.fingerprint, 'hash-dbx');
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 'dropbox:acct_dbx:cursor-2:/team/notes.md:rev-1');
  assert.equal(adapter.resolveWriteback('/dropbox/acct_dbx/files/draft-notes.json', JSON.stringify({"path":"/Team/Notes.md"})).operation, 'create');
  const nango = adapter.mapNangoSyncRecord({ id: 'id:dbx-file', model: 'File', name: 'example', updatedAt: '2026-05-09T00:00:00.000Z' });
  assert.equal(nango.source, 'dropbox');
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
