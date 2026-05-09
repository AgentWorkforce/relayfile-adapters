import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { DropboxAdapter, DropboxBridge, ReadOnlyFieldError, getWebhookChallenge, resolveWritebackRequest, toObjectRelayfilePath, validateConfig } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('dropbox validates minimal config and maps object paths', () => {
  const config = validateConfig({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  assert.equal(config.providerConfigKey, "dropbox");
  assert.equal(toObjectRelayfilePath({ id: 'obj_1', accountId: 'acct', bucket: 'bucket', account: 'acct', container: 'container', db: 'db', schema: 'public', table: 'docs', siteId: 'site', driveId: 'drive', key: 'folder/file.txt', name: 'file.txt', threadId: 'thread_1', primaryKey: 'pk_1' }).startsWith("/dropbox/"), true);
});

test('dropbox normalizes notifications and publishes storage events', async () => {
  const published: StorageBridgeEvent[] = [];
  const bridge = new DropboxBridge({ workspaceId: 'ws_1', connectionId: 'conn_1', webhookSecret: 'secret' }, { publish: (event) => { published.push(event); } });
  const body = { eventId: 'evt_1', type: 'created', id: 'obj_1', name: 'file.txt', contentBase64: 'SGk=' } as const;
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', 'secret').update(rawBody).digest('hex');
  const events = await bridge.handleNotification({ body, rawBody, headers: { 'x-relayfile-signature': 'sha256=' + signature } });
  assert.equal(events.length, 1);
  assert.equal(published.length, 1);
  assert.equal(events[0]?.source, "dropbox");
  assert.equal(events[0]?.changeType, 'created');
  assert.equal(events[0]?.workspaceId, 'ws_1');
});

test('dropbox rejects read-only writeback fields', () => {
  assert.throws(() => resolveWritebackRequest("/dropbox/{accountId}/files/draft.json", JSON.stringify({ id: 'provider-id' })), ReadOnlyFieldError);
});

test('dropbox resolves writeback and nango behavior', () => {
  const request = resolveWritebackRequest("/dropbox/{accountId}/files/draft.json", JSON.stringify({"accountId":"dbx-account","path":"/Reports/q1.txt","contentBase64":"SGVsbG8="}));
  assert.equal(request.operation, 'create');
  const adapter = new DropboxAdapter({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  const event = adapter.mapNangoSyncRecord({ id: 'nango_1', updatedAt: '2026-05-09T00:00:00.000Z' });
  assert.equal(event.source, "dropbox");
});

test('dropbox exposes webhook challenge when provider sends one', () => {
  const challenge = getWebhookChallenge({ body: { validationToken: 'abc' }, query: { challenge: 'xyz' } });
  assert.equal(challenge, 'abc');
});
