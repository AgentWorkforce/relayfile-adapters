import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { AzureBlobAdapter, AzureBlobBridge, ReadOnlyFieldError, getWebhookChallenge, resolveWritebackRequest, toObjectRelayfilePath, validateConfig } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('azure-blob validates minimal config and maps object paths', () => {
  const config = validateConfig({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  assert.equal(config.providerConfigKey, "azure-storage");
  assert.equal(toObjectRelayfilePath({ id: 'obj_1', accountId: 'acct', bucket: 'bucket', account: 'acct', container: 'container', db: 'db', schema: 'public', table: 'docs', siteId: 'site', driveId: 'drive', key: 'folder/file.txt', name: 'file.txt', threadId: 'thread_1', primaryKey: 'pk_1' }).startsWith("/azure/"), true);
});

test('azure-blob normalizes notifications and publishes storage events', async () => {
  const published: StorageBridgeEvent[] = [];
  const bridge = new AzureBlobBridge({ workspaceId: 'ws_1', connectionId: 'conn_1', webhookSecret: 'secret' }, { publish: (event) => { published.push(event); } });
  const body = { eventId: 'evt_1', type: 'created', id: 'obj_1', name: 'file.txt', contentBase64: 'SGk=' } as const;
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', 'secret').update(rawBody).digest('hex');
  const events = await bridge.handleNotification({ body, rawBody, headers: { 'x-relayfile-signature': 'sha256=' + signature } });
  assert.equal(events.length, 1);
  assert.equal(published.length, 1);
  assert.equal(events[0]?.source, "azure-blob");
  assert.equal(events[0]?.changeType, 'created');
  assert.equal(events[0]?.workspaceId, 'ws_1');
});

test('azure-blob rejects read-only writeback fields', () => {
  assert.throws(() => resolveWritebackRequest("/azure/{account}/{container}/blobs/draft.json", JSON.stringify({ id: 'provider-id' })), ReadOnlyFieldError);
});

test('azure-blob resolves writeback and nango behavior', () => {
  const request = resolveWritebackRequest("/azure/{account}/{container}/blobs/draft.json", JSON.stringify({"account":"acct","container":"docs","name":"report.json","contentBase64":"e30=","contentType":"application/json"}));
  assert.equal(request.operation, 'create');
  const adapter = new AzureBlobAdapter({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  assert.throws(() => adapter.mapNangoSyncRecord({ id: 'nango_1' }), /does not declare/);
});

test('azure-blob exposes webhook challenge when provider sends one', () => {
  const challenge = getWebhookChallenge({ body: { validationToken: 'abc' }, query: { challenge: 'xyz' } });
  assert.equal(challenge, 'abc');
});
