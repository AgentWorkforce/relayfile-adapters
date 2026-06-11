import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { RedisAdapter, RedisBridge, ReadOnlyFieldError, getWebhookChallenge, resolveWritebackRequest, toObjectRelayfilePath, validateConfig } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('redis validates minimal config and maps object paths', () => {
  const config = validateConfig({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  assert.equal(config.providerConfigKey, "redis");
  assert.equal(toObjectRelayfilePath({ id: 'obj_1', accountId: 'acct', bucket: 'bucket', account: 'acct', container: 'container', db: 'db', schema: 'public', table: 'docs', siteId: 'site', driveId: 'drive', key: 'folder/file.txt', name: 'file.txt', threadId: 'thread_1', primaryKey: 'pk_1' }).startsWith("/redis/"), true);
});

test('redis normalizes notifications and publishes storage events', async () => {
  const published: StorageBridgeEvent[] = [];
  const bridge = new RedisBridge({ workspaceId: 'ws_1', connectionId: 'conn_1', webhookSecret: 'secret' }, { publish: (event) => { published.push(event); } });
  const body = { eventId: 'evt_1', type: 'created', id: 'obj_1', name: 'file.txt', contentBase64: 'SGk=' } as const;
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', 'secret').update(rawBody).digest('hex');
  const events = await bridge.handleNotification({ body, rawBody, headers: { 'x-relayfile-signature': 'sha256=' + signature } });
  assert.equal(events.length, 1);
  assert.equal(published.length, 1);
  assert.equal(events[0]?.source, "redis");
  assert.equal(events[0]?.changeType, 'created');
  assert.equal(events[0]?.workspaceId, 'ws_1');
});

test('redis rejects read-only writeback fields', () => {
  assert.throws(() => resolveWritebackRequest("/redis/{db}/draft.json", JSON.stringify({ id: 'provider-id' })), ReadOnlyFieldError);
});

test('redis resolves writeback and nango behavior', () => {
  const body = {"db":0,"key":"settings:theme","type":"string","value":"dark"};
  const request = resolveWritebackRequest("/redis/{db}/draft.json", JSON.stringify(body));
  assert.deepEqual(request, {
    action: 'redis.keys.create',
    operation: 'create',
    method: 'POST',
    endpoint: 'SET',
    resource: 'keys',
    resourceId: 'draft',
    body,
  });
  const adapter = new RedisAdapter({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  assert.throws(() => adapter.mapNangoSyncRecord({ id: 'nango_1' }), /does not declare/);
});

test('redis exposes webhook challenge when provider sends one', () => {
  const challenge = getWebhookChallenge({ body: { validationToken: 'abc' }, query: { challenge: 'xyz' } });
  assert.equal(challenge, 'abc');
});
