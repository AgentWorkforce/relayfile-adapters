import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { S3Adapter, S3Bridge, ReadOnlyFieldError, getWebhookChallenge, resolveWritebackRequest, toObjectRelayfilePath, validateConfig } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('s3 validates minimal config and maps object paths', () => {
  const config = validateConfig({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  assert.equal(config.providerConfigKey, "aws-iam");
  assert.equal(toObjectRelayfilePath({ id: 'obj_1', accountId: 'acct', bucket: 'bucket', account: 'acct', container: 'container', db: 'db', schema: 'public', table: 'docs', siteId: 'site', driveId: 'drive', key: 'folder/file.txt', name: 'file.txt', threadId: 'thread_1', primaryKey: 'pk_1' }).startsWith("/s3/"), true);
});

test('s3 normalizes notifications and publishes storage events', async () => {
  const published: StorageBridgeEvent[] = [];
  const bridge = new S3Bridge({ workspaceId: 'ws_1', connectionId: 'conn_1', webhookSecret: 'secret' }, { publish: (event) => { published.push(event); } });
  const body = { eventId: 'evt_1', type: 'created', id: 'obj_1', name: 'file.txt', contentBase64: 'SGk=' } as const;
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', 'secret').update(rawBody).digest('hex');
  const events = await bridge.handleNotification({ body, rawBody, headers: { 'x-relayfile-signature': 'sha256=' + signature } });
  assert.equal(events.length, 1);
  assert.equal(published.length, 1);
  assert.equal(events[0]?.source, "s3");
  assert.equal(events[0]?.changeType, 'created');
  assert.equal(events[0]?.workspaceId, 'ws_1');
});

test('s3 rejects read-only writeback fields', () => {
  assert.throws(() => resolveWritebackRequest("/s3/{bucket}/objects/draft.json", JSON.stringify({ id: 'provider-id' })), ReadOnlyFieldError);
});

test('s3 resolves writeback and nango behavior', () => {
  const body = {"bucket":"reports","key":"q1/report.json","contentBase64":"e30=","contentType":"application/json"};
  const request = resolveWritebackRequest("/s3/{bucket}/objects/draft.json", JSON.stringify(body));
  assert.deepEqual(request, {
    action: 's3.objects.create',
    operation: 'create',
    method: 'POST',
    endpoint: 's3:PutObject',
    resource: 'objects',
    resourceId: 'draft',
    body,
  });
  const adapter = new S3Adapter({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  assert.throws(() => adapter.mapNangoSyncRecord({ id: 'nango_1' }), /does not declare/);
});

test('s3 exposes webhook challenge when provider sends one', () => {
  const challenge = getWebhookChallenge({ body: { validationToken: 'abc' }, query: { challenge: 'xyz' } });
  assert.equal(challenge, 'abc');
});
