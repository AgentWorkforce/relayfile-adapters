import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { OnedriveAdapter, OnedriveBridge, ReadOnlyFieldError, getWebhookChallenge, resolveWritebackRequest, toObjectRelayfilePath, validateConfig } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('onedrive validates minimal config and maps object paths', () => {
  const config = validateConfig({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  assert.equal(config.providerConfigKey, "microsoft");
  assert.equal(toObjectRelayfilePath({ id: 'obj_1', accountId: 'acct', bucket: 'bucket', account: 'acct', container: 'container', db: 'db', schema: 'public', table: 'docs', siteId: 'site', driveId: 'drive', key: 'folder/file.txt', name: 'file.txt', threadId: 'thread_1', primaryKey: 'pk_1' }).startsWith("/onedrive/"), true);
});

test('onedrive normalizes notifications and publishes storage events', async () => {
  const published: StorageBridgeEvent[] = [];
  const bridge = new OnedriveBridge({ workspaceId: 'ws_1', connectionId: 'conn_1', webhookSecret: 'secret' }, { publish: (event) => { published.push(event); } });
  const body = { eventId: 'evt_1', type: 'created', id: 'obj_1', name: 'file.txt', contentBase64: 'SGk=' } as const;
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', 'secret').update(rawBody).digest('hex');
  const events = await bridge.handleNotification({ body, rawBody, headers: { 'x-relayfile-signature': 'sha256=' + signature } });
  assert.equal(events.length, 1);
  assert.equal(published.length, 1);
  assert.equal(events[0]?.source, "onedrive");
  assert.equal(events[0]?.changeType, 'created');
  assert.equal(events[0]?.workspaceId, 'ws_1');
});

test('onedrive rejects read-only writeback fields', () => {
  assert.throws(() => resolveWritebackRequest("/onedrive/{accountId}/items/draft.json", JSON.stringify({ id: 'provider-id' })), ReadOnlyFieldError);
});

test('onedrive resolves writeback and nango behavior', () => {
  const body = {"accountId":"user@example.com","name":"Notes.txt","contentBase64":"SGVsbG8="};
  const request = resolveWritebackRequest("/onedrive/{accountId}/items/draft.json", JSON.stringify(body));
  assert.deepEqual(request, {
    action: 'onedrive.items.create',
    operation: 'create',
    method: 'POST',
    endpoint: '/v1.0/me/drive/items/{itemId}',
    resource: 'items',
    resourceId: 'draft',
    body,
  });
  const adapter = new OnedriveAdapter({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  const event = adapter.mapNangoSyncRecord({ id: 'nango_1', updatedAt: '2026-05-09T00:00:00.000Z' });
  assert.equal(event.source, "onedrive");
});

test('onedrive exposes webhook challenge when provider sends one', () => {
  const challenge = getWebhookChallenge({ body: { validationToken: 'abc' }, query: { challenge: 'xyz' } });
  assert.equal(challenge, 'abc');
});
