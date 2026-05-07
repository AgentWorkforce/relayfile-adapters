import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PipedriveAdapter,
  computePipedrivePath,
  pipedriveActivityPath,
  pipedriveDealPath,
  pipedriveOrganizationPath,
  pipedrivePersonPath,
  type ConnectionProvider,
  type NormalizedWebhook,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

interface AdapterHarness {
  adapter: PipedriveAdapter;
  deleted: string[];
  writes: WriteFileInput[];
}

function createHarness(): AdapterHarness {
  const writes: WriteFileInput[] = [];
  const deleted: string[] = [];
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push(input);
      return { created: true };
    },
    async deleteFile(input) {
      deleted.push(input.path);
    },
  };

  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return {
        status: 200,
        headers: {},
        data: null as never,
      };
    },
    async healthCheck() {
      return true;
    },
  };

  return {
    adapter: new PipedriveAdapter(client, provider, { connectionId: 'conn_pipedrive_123' }),
    deleted,
    writes,
  };
}

function normalizedEvent(
  objectType: string,
  objectId: string,
  payload: Record<string, unknown>,
  action = 'created',
): NormalizedWebhook {
  return {
    provider: 'pipedrive',
    connectionId: 'conn_pipedrive_123',
    eventType: `${objectType}.${action}`,
    objectType,
    objectId,
    payload: {
      ...payload,
      _webhook: {
        action,
        eventType: `${objectType}.${action}`,
        objectId,
        objectType,
      },
    },
  };
}

test('PipedriveAdapter exposes provider name and supported webhook events', () => {
  const { adapter } = createHarness();

  assert.equal(adapter.name, 'pipedrive');
  assert.deepEqual(adapter.supportedEvents(), [
    'deal.created',
    'deal.updated',
    'deal.deleted',
    'person.created',
    'person.updated',
    'person.deleted',
    'organization.created',
    'organization.updated',
    'organization.deleted',
    'activity.created',
    'activity.updated',
    'activity.deleted',
  ]);
});

test('ingestWebhook writes deal files with deal semantics', async () => {
  const { adapter, writes } = createHarness();
  const result = await adapter.ingestWebhook(
    'workspace_1',
    normalizedEvent('deal', '101', {
      id: 101,
      title: 'Enterprise renewal',
      value: 12500,
      currency: 'USD',
      status: 'open',
      person_id: { id: 201, name: 'Ada Lovelace' },
      org_id: { id: 301, name: 'Acme Corp' },
    }),
  );

  assert.equal(result.filesWritten, 1);
  assert.equal(writes[0]?.path, '/pipedrive/deals/enterprise-renewal--101.json');
  assert.equal(writes[0]?.semantics?.properties?.['pipedrive.title'], 'Enterprise renewal');
  assert.equal(writes[0]?.semantics?.properties?.['pipedrive.value'], '12500');
  assert.deepEqual(writes[0]?.semantics?.relations, [
    '/pipedrive/organizations/301.json',
    '/pipedrive/persons/201.json',
  ]);
});

test('ingestWebhook writes person files with organization relation', async () => {
  const { adapter, writes } = createHarness();
  const result = await adapter.ingestWebhook(
    'workspace_1',
    normalizedEvent('person', '201', {
      id: 201,
      name: 'Ada Lovelace',
      email: [{ value: 'ada@example.test', primary: true }],
      phone: [{ value: '+15550101', primary: true }],
      org_id: { id: 301, name: 'Acme Corp' },
    }),
  );

  assert.equal(result.paths[0], '/pipedrive/persons/ada-lovelace--201.json');
  assert.equal(writes[0]?.semantics?.properties?.['pipedrive.email'], 'ada@example.test');
  assert.equal(writes[0]?.semantics?.properties?.['pipedrive.phone'], '+15550101');
  assert.deepEqual(writes[0]?.semantics?.relations, ['/pipedrive/organizations/301.json']);
});

test('ingestWebhook writes organization files', async () => {
  const { adapter, writes } = createHarness();
  const result = await adapter.ingestWebhook(
    'workspace_1',
    normalizedEvent('organization', '301', {
      id: 301,
      name: 'Acme Corp',
      address: '1 Market St',
      active_flag: true,
    }),
  );

  assert.equal(result.filesWritten, 1);
  assert.equal(writes[0]?.path, '/pipedrive/organizations/acme-corp--301.json');
  assert.equal(writes[0]?.semantics?.properties?.['pipedrive.name'], 'Acme Corp');
  assert.equal(writes[0]?.semantics?.properties?.['pipedrive.active'], 'true');
});

test('ingestWebhook writes activity files with note comments and entity relations', async () => {
  const { adapter, writes } = createHarness();
  const result = await adapter.ingestWebhook(
    'workspace_1',
    normalizedEvent('activity', '401', {
      id: 401,
      subject: 'Follow up',
      type: 'call',
      done: 0,
      note: 'Call buyer after legal review.',
      deal_id: { id: 101, name: 'Enterprise renewal' },
      person_id: { id: 201, name: 'Ada Lovelace' },
      org_id: { id: 301, name: 'Acme Corp' },
    }),
  );

  assert.equal(result.paths[0], '/pipedrive/activities/follow-up--401.json');
  assert.equal(writes[0]?.semantics?.properties?.['pipedrive.done'], 'false');
  assert.deepEqual(writes[0]?.semantics?.comments, ['Call buyer after legal review.']);
  assert.deepEqual(writes[0]?.semantics?.relations, [
    '/pipedrive/deals/101.json',
    '/pipedrive/organizations/301.json',
    '/pipedrive/persons/201.json',
  ]);
});

test('ingestWebhook deletes files for deleted events', async () => {
  const { adapter, deleted } = createHarness();
  const result = await adapter.ingestWebhook(
    'workspace_1',
    normalizedEvent('deal', '101', { id: 101, title: 'Enterprise renewal' }, 'deleted'),
  );

  assert.equal(result.filesDeleted, 1);
  assert.deepEqual(deleted, ['/pipedrive/deals/enterprise-renewal--101.json']);
});

test('computeSemantics extracts deal status, owner, and linked objects', () => {
  const { adapter } = createHarness();
  const semantics = adapter.computeSemantics('deal', '101', {
    id: 101,
    title: 'Enterprise renewal',
    status: 'won',
    value: '42000',
    user_id: { id: 9, name: 'Owner User' },
    person_id: 201,
    org_id: 301,
  });

  assert.equal(semantics.properties?.['pipedrive.status'], 'won');
  assert.equal(semantics.properties?.['pipedrive.value'], '42000');
  assert.equal(semantics.properties?.['pipedrive.owner_id'], '9');
  assert.equal(semantics.properties?.['pipedrive.owner_name'], 'Owner User');
  assert.deepEqual(semantics.relations, [
    '/pipedrive/organizations/301.json',
    '/pipedrive/persons/201.json',
  ]);
});

test('path mapping stays deterministic for supported Pipedrive VFS objects', () => {
  const { adapter } = createHarness();

  assert.equal(pipedriveDealPath('deal 1/2'), '/pipedrive/deals/deal%201%2F2.json');
  assert.equal(pipedrivePersonPath('person:42'), '/pipedrive/persons/person%3A42.json');
  assert.equal(pipedriveOrganizationPath('org#7'), '/pipedrive/organizations/org%237.json');
  assert.equal(pipedriveActivityPath('activity Q2'), '/pipedrive/activities/activity%20Q2.json');

  assert.equal(computePipedrivePath('Deal', '101', 'Enterprise Renewal'), '/pipedrive/deals/enterprise-renewal--101.json');
  assert.equal(computePipedrivePath('people', '201', 'Ada Lovelace'), '/pipedrive/persons/ada-lovelace--201.json');
  assert.equal(computePipedrivePath('org', '301', 'Acme Corp'), '/pipedrive/organizations/acme-corp--301.json');
  assert.equal(computePipedrivePath('activities', '401', 'Follow Up'), '/pipedrive/activities/follow-up--401.json');

  assert.equal(adapter.computePath('deals', '101', 'Enterprise Renewal'), '/pipedrive/deals/enterprise-renewal--101.json');
  assert.equal(adapter.computePath('person', '201', 'Ada Lovelace'), '/pipedrive/persons/ada-lovelace--201.json');
  assert.equal(adapter.computePath('organization', '301', 'Acme Corp'), '/pipedrive/organizations/acme-corp--301.json');
  assert.equal(adapter.computePath('activity', '401', 'Follow Up'), '/pipedrive/activities/follow-up--401.json');
});

