import assert from 'node:assert/strict';
import test from 'node:test';

import { GmailAdapter, GmailBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('gmail integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_gmail', accountId: 'me@example.com' };
  const adapter = new GmailAdapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new GmailBridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('gmail', event, await adapter.fetchContent(event)));
    },
  });

  const body = {
    message: { messageId: 'pubsub-gmail-1', publishTime: '2026-05-09T08:36:00.000Z', data: Buffer.from(JSON.stringify({ emailAddress: 'me@example.com', historyId: 'hist-20' })).toString('base64') },
    history: { id: 'hist-20', messagesAdded: [{ message: { id: 'msg-1', threadId: 'thread-1', labelIds: ['INBOX'] } }] },
    thread: { id: 'thread-1', historyId: 'hist-20', messages: [{ id: 'msg-1', threadId: 'thread-1', snippet: 'hello' }] }
  };

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 'gmail:me@example.com:hist-20:thread-1');
  assert.equal(event.source, 'gmail');
  assert.equal(event.changeType, 'created');
  assert.equal(event.relayfilePath, '/gmail/me@example.com/threads/thread-1.json');
  assert.equal(event.resourceId, 'thread-1');
  assert.equal(event.sizeBytes, null);
  assert.equal(event.fingerprint, 'hist-20');
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 'gmail:me@example.com:hist-20:thread-1');
  assert.equal(adapter.resolveWriteback('/gmail/me@example.com/drafts/draft-subject.json', JSON.stringify({"message":{"raw":"RnJvbTogbWVAZXhhbXBsZS5jb20K"}})).operation, 'create');
  const nango = adapter.mapNangoSyncRecord({ id: 'thread-1', model: 'Thread', name: 'example', updatedAt: '2026-05-09T00:00:00.000Z' });
  assert.equal(nango.source, 'gmail');
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
