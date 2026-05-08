import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AirtableAdapter,
  airtableBasePath,
  airtableRecordPath,
  airtableTablePath,
  computeAirtablePath,
  resolveAirtableReadRequest,
  resolveAirtableWritebackRequest,
  type AirtableAdapterConfig,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

function createAdapter(config: AirtableAdapterConfig = {}, writes: WriteFileInput[] = []): AirtableAdapter {
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push(input);
      return { created: true };
    },
    async deleteFile() {
      return undefined;
    },
  };

  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return {
        data: null as never,
        headers: {},
        status: 200,
      };
    },
    async healthCheck() {
      return true;
    },
  };

  return new AirtableAdapter(client, provider, config);
}

test('AirtableAdapter exposes provider name and supported Airtable webhook events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'airtable');
  assert.deepEqual(adapter.supportedEvents(), [
    'record.create',
    'record.update',
    'record.delete',
    'table.create',
    'table.update',
    'table.delete',
    'base.create',
    'base.update',
    'base.delete',
  ]);
});

test('ingestWebhook writes record events with deterministic content and semantics', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({}, writes);

  const result = await adapter.ingestWebhook('ws_relay', {
    eventType: 'record.update',
    objectId: 'rec_1',
    objectType: 'record',
    payload: {
      baseId: 'app_base',
      fields: {
        Assignee: 'Ada',
        Linked: ['rec_2'],
        Notes: 'Implementation notes',
        Status: 'In progress',
      },
      id: 'rec_1',
      tableId: 'tbl_tasks',
    },
    provider: 'airtable',
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/airtable/bases/app_base/tables/tbl_tasks/records/rec_1.json']);
  assert.equal(writes[0]?.path, '/airtable/bases/app_base/tables/tbl_tasks/records/rec_1.json');
  assert.equal(writes[0]?.semantics?.properties?.['airtable.field.assignee'], 'Ada');
  assert.equal(writes[0]?.semantics?.properties?.['airtable.field.status'], 'In progress');
  assert.deepEqual(writes[0]?.semantics?.comments, ['Implementation notes']);
  assert.deepEqual(writes[0]?.semantics?.relations, [
    '/airtable/bases/app_base.json',
    '/airtable/bases/app_base/tables/tbl_tasks.json',
    '/airtable/bases/app_base/tables/tbl_tasks/records/rec_2.json',
  ]);
});

test('ingestWebhook writes table events and extracts schema semantics', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({}, writes);

  const result = await adapter.ingestWebhook('ws_relay', {
    eventType: 'table.update',
    objectId: 'tbl_tasks',
    objectType: 'table',
    payload: {
      base: { id: 'app_base', name: 'Ops' },
      description: 'Operational work tracker',
      fields: [
        { id: 'fld_name', name: 'Name', type: 'singleLineText' },
        { id: 'fld_status', name: 'Status', type: 'singleSelect' },
      ],
      id: 'tbl_tasks',
      name: 'Tasks',
      views: [{ id: 'viw_grid', name: 'Grid view', type: 'grid' }],
    },
    provider: 'airtable',
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/airtable/bases/app_base/tables/tbl_tasks.json']);
  assert.equal(writes[0]?.semantics?.properties?.['airtable.field_count'], '2');
  assert.equal(writes[0]?.semantics?.properties?.['airtable.schema.status.type'], 'singleSelect');
  assert.deepEqual(writes[0]?.semantics?.relations, ['/airtable/bases/app_base.json']);
});

test('ingestWebhook writes base events and extracts child table relations', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({}, writes);

  const result = await adapter.ingestWebhook('ws_relay', {
    eventType: 'base.update',
    objectId: 'app_base',
    objectType: 'base',
    payload: {
      id: 'app_base',
      name: 'Ops',
      permissionLevel: 'create',
      tables: [
        { id: 'tbl_tasks', name: 'Tasks' },
        { id: 'tbl_bugs', name: 'Bugs' },
      ],
      workspace: { id: 'wsp_1', name: 'Engineering' },
    },
    provider: 'airtable',
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/airtable/bases/app_base.json']);
  assert.equal(writes[0]?.semantics?.properties?.['airtable.table_count'], '2');
  assert.equal(writes[0]?.semantics?.properties?.['airtable.workspace_name'], 'Engineering');
  assert.deepEqual(writes[0]?.semantics?.relations, [
    '/airtable/bases/app_base/tables/tbl_bugs.json',
    '/airtable/bases/app_base/tables/tbl_tasks.json',
  ]);
});

test('ingestWebhook normalizes raw Airtable record payloads using adapter config context', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({ baseId: 'app_base', connectionId: 'conn_airtable_1', tableId: 'tbl_tasks' }, writes);

  const result = await adapter.ingestWebhook('ws_relay', {
    action: 'changed',
    data: {
      fields: {
        Name: 'Ship Airtable adapter',
        Status: 'Done',
      },
      id: 'rec_1',
    },
    type: 'record',
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/airtable/bases/app_base/tables/tbl_tasks/records/rec_1.json']);
  assert.equal(JSON.parse(writes[0]?.content ?? '{}').connectionId, 'conn_airtable_1');
  assert.equal(writes[0]?.semantics?.properties?.['airtable.record_title'], 'Ship Airtable adapter');
});

test('computeSemantics extracts record fields, comments, and webhook metadata', () => {
  const adapter = createAdapter({ baseId: 'app_base', tableId: 'tbl_tasks' });

  const semantics = adapter.computeSemantics('AirtableRecord', 'rec_1', {
    fields: {
      Name: 'Review launch list',
      Notes: 'Needs owner review',
      Score: 3,
      Tags: ['launch', 'adapter'],
    },
    id: 'rec_1',
    _webhook: {
      action: 'update',
      deliveryId: 'delivery_1',
      eventType: 'record.update',
      webhookTimestamp: 1_777_639_200_000,
    },
  });

  assert.equal(semantics.properties?.['airtable.field.name'], 'Review launch list');
  assert.equal(semantics.properties?.['airtable.field.score'], '3');
  assert.equal(semantics.properties?.['airtable.field.tags'], 'launch, adapter');
  assert.equal(semantics.properties?.['airtable.webhook.delivery_id'], 'delivery_1');
  assert.deepEqual(semantics.comments, ['Needs owner review']);
});

test('path mapper, read routes, and writeback routes cover primary Airtable objects', () => {
  const adapter = createAdapter({ baseId: 'app_base', tableId: 'tbl_tasks' });

  assert.equal(airtableBasePath('app base'), '/airtable/bases/app%20base.json');
  assert.equal(airtableTablePath('app/base', 'tbl tasks'), '/airtable/bases/app%2Fbase/tables/tbl%20tasks.json');
  assert.equal(
    airtableRecordPath('app_base', 'tbl_tasks', 'rec#7'),
    '/airtable/bases/app_base/tables/tbl_tasks/records/rec%237.json',
  );
  assert.equal(computeAirtablePath('records', 'rec_1', { baseId: 'app_base', tableId: 'tbl_tasks' }), '/airtable/bases/app_base/tables/tbl_tasks/records/rec_1.json');
  assert.equal(adapter.computePath('table', 'tbl_tasks'), '/airtable/bases/app_base/tables/tbl_tasks.json');

  assert.deepEqual(resolveAirtableReadRequest('/airtable/bases/app_base/tables/tbl_tasks.json'), {
    action: 'get_table_records',
    endpoint: '/v0/app_base/tbl_tasks',
    method: 'GET',
    routeTemplate: '/v0/{baseId}/{tableId}',
  });

  assert.deepEqual(resolveAirtableWritebackRequest('/airtable/bases/app_base/tables/tbl_tasks/records/rec_1.json', '{"fields":{"Status":"Done"}}'), {
    action: 'update_record',
    body: {
      records: [
        {
          fields: { Status: 'Done' },
          id: 'rec_1',
        },
      ],
    },
    endpoint: '/v0/app_base/tbl_tasks',
    method: 'PATCH',
    routeTemplate: '/v0/{baseId}/{tableId}',
  });

  assert.throws(
    () => resolveAirtableWritebackRequest('/airtable/bases/app_base/tables/tbl_tasks/records/rec_1.json', '{"fields":{}}'),
    /at least one field/,
  );
});
