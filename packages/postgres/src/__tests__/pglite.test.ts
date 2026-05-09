import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import { PostgresBridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('postgres PGlite LISTEN/NOTIFY trigger payload publishes a StorageBridgeEvent', async () => {
  const pglite = new PGlite();
  const published: StorageBridgeEvent[] = [];
  const bridge = new PostgresBridge({ workspaceId: 'ws_storage', connectionId: 'conn_pg', accountId: 'appdb' }, {
    publish: (event) => {
      published.push(event);
    },
  });

  try {
    await pglite.exec(`
      CREATE TABLE documents (
        id integer PRIMARY KEY,
        title text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION relayfile_notify_documents() RETURNS trigger AS $$
      DECLARE
        payload json;
      BEGIN
        payload = json_build_object(
          'database', 'appdb',
          'schema', TG_TABLE_SCHEMA,
          'table', TG_TABLE_NAME,
          'op', TG_OP,
          'pk', NEW.id::text,
          'occurred_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'row_json', row_to_json(NEW),
          'txid', txid_current()::text
        );
        PERFORM pg_notify('relayfile_storage_events', payload::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER relayfile_documents_notify
      AFTER INSERT ON documents
      FOR EACH ROW EXECUTE FUNCTION relayfile_notify_documents();
    `);

    await pglite.listen('relayfile_storage_events', async (rawPayload) => {
      await bridge.handleNotification({
        body: {
          channel: 'relayfile_storage_events',
          notification: rawPayload,
        } as never,
        receivedAt: '2026-05-09T08:39:05.000Z',
      });
    });

    await pglite.query("INSERT INTO documents (id, title) VALUES (42, 'Bridge plan')");
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    await pglite.close();
  }

  assert.equal(published.length, 1);
  assert.equal(published[0]?.source, 'postgres');
  assert.equal(published[0]?.relayfilePath, '/postgres/appdb/public/documents/42.json');
  assert.match(published[0]?.eventId ?? '', /^postgres:appdb:public\.documents:42:\d+$/);
  const row = published[0]?.metadata['postgres.row_json'] as Record<string, unknown>;
  assert.equal(row.id, 42);
  assert.equal(row.title, 'Bridge plan');
});
