import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { PostgresAdapter, PostgresBridge, ReadOnlyFieldError, getWebhookChallenge, quoteSqlIdentifier, resolveWritebackRequest, toObjectRelayfilePath, validateConfig } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('postgres validates minimal config and maps object paths', () => {
  const config = validateConfig({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  assert.equal(config.providerConfigKey, "postgres");
  assert.equal(toObjectRelayfilePath({ id: 'obj_1', accountId: 'acct', bucket: 'bucket', account: 'acct', container: 'container', db: 'db', schema: 'public', table: 'docs', siteId: 'site', driveId: 'drive', key: 'folder/file.txt', name: 'file.txt', threadId: 'thread_1', primaryKey: 'pk_1' }).startsWith("/postgres/"), true);
});

test('postgres normalizes notifications and publishes storage events', async () => {
  const published: StorageBridgeEvent[] = [];
  const bridge = new PostgresBridge({ workspaceId: 'ws_1', connectionId: 'conn_1', webhookSecret: 'secret' }, { publish: (event) => { published.push(event); } });
  const body = { eventId: 'evt_1', type: 'created', id: 'obj_1', name: 'file.txt', contentBase64: 'SGk=' } as const;
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', 'secret').update(rawBody).digest('hex');
  const events = await bridge.handleNotification({ body, rawBody, headers: { 'x-relayfile-signature': 'sha256=' + signature } });
  assert.equal(events.length, 1);
  assert.equal(published.length, 1);
  assert.equal(events[0]?.source, "postgres");
  assert.equal(events[0]?.changeType, 'created');
  assert.equal(events[0]?.workspaceId, 'ws_1');
});

test('postgres rejects read-only writeback fields', () => {
  assert.throws(() => resolveWritebackRequest("/postgres/{db}/{schema}/{table}/draft.json", JSON.stringify({ id: 'provider-id' })), ReadOnlyFieldError);
});

test('postgres writeback rejects unsafe SQL identifiers', () => {
  assert.equal(quoteSqlIdentifier('public_table'), '"public_table"');
  assert.throws(() => quoteSqlIdentifier('bad name'), /Invalid Postgres/);
  assert.throws(() => quoteSqlIdentifier('bad"name'), /Invalid Postgres/);
  assert.throws(() => quoteSqlIdentifier('tåble'), /Invalid Postgres/);
  assert.throws(
    () => resolveWritebackRequest('/postgres/appdb/public/documents/42.json', JSON.stringify({ primaryKey: 'bad name', row: { title: 'Bridge plan' } })),
    /Invalid Postgres primaryKey identifier/,
  );
});

test('postgres resolves writeback and nango behavior', () => {
  const request = resolveWritebackRequest("/postgres/app/public/documents/draft.json", JSON.stringify({"primaryKey":"id","row":{"title":"Roadmap"}}));
  assert.equal(request.operation, 'create');
  const adapter = new PostgresAdapter({ workspaceId: 'ws_1', connectionId: 'conn_1' });
  assert.throws(() => adapter.mapNangoSyncRecord({ id: 'nango_1' }), /does not declare/);
});

test('postgres exposes webhook challenge when provider sends one', () => {
  const challenge = getWebhookChallenge({ body: { validationToken: 'abc' }, query: { challenge: 'xyz' } });
  assert.equal(challenge, 'abc');
});
