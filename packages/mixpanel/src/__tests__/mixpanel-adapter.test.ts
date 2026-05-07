import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MixpanelAdapter,
  computeMixpanelPath,
  mixpanelCohortPath,
  mixpanelEventPath,
  mixpanelProfilePath,
  normalizeMixpanelWebhook,
  type ConnectionProvider,
  type MixpanelAdapterConfig,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

const config: MixpanelAdapterConfig = {
  webhookPass: 'pass',
  webhookUser: 'user',
};

function authHeader(): string {
  return `Basic ${Buffer.from('user:pass', 'utf8').toString('base64')}`;
}

function createAdapter(overrides: Partial<RelayFileClientLike> = {}): {
  adapter: MixpanelAdapter;
  writes: WriteFileInput[];
} {
  const writes: WriteFileInput[] = [];
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push(input);
      return { created: true };
    },
    ...overrides,
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

  return {
    adapter: new MixpanelAdapter(client, provider, config),
    writes,
  };
}

test('MixpanelAdapter exposes provider metadata and supported webhook events', () => {
  const { adapter } = createAdapter();

  assert.equal(adapter.name, 'mixpanel');
  assert.deepEqual(adapter.supportedEvents(), [
    'event.create',
    'event.update',
    'event.delete',
    'event.merge',
    'profile.create',
    'profile.update',
    'profile.delete',
    'profile.merge',
    'cohort.create',
    'cohort.update',
    'cohort.delete',
    'cohort.merge',
  ]);
});

test('ingestWebhook writes Mixpanel event webhooks to deterministic event paths', async () => {
  const { adapter, writes } = createAdapter();
  const normalized = normalizeMixpanelWebhook(
    {
      action: 'create',
      timestamp: 1_000_000,
      type: 'event',
      data: {
        event: 'Signed Up',
        properties: {
          $insert_id: 'evt_123',
          distinct_id: 'user_123',
          time: 1_000_000,
        },
      },
    },
    { authorization: authHeader() },
    config,
    { now: 1_000_100_000 },
  );

  const result = await adapter.ingestWebhook('workspace_1', normalized);

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/mixpanel/events/signed-up--evt123.json']);
  assert.equal(writes[0]?.path, '/mixpanel/events/signed-up--evt123.json');
  assert.equal(writes[0]?.semantics?.properties?.['mixpanel.event'], 'Signed Up');
  assert.deepEqual(writes[0]?.semantics?.relations, ['/mixpanel/profiles/user_123.json']);
});

test('ingestWebhook writes Mixpanel profile webhooks and extracts profile semantics', async () => {
  const { adapter, writes } = createAdapter();

  const result = await adapter.ingestWebhook('workspace_1', {
    action: 'update',
    type: 'profile',
    timestamp: 1_000_000,
    data: {
      $distinct_id: 'user@example.com',
      $set: {
        $email: 'user@example.com',
        $name: 'Ada Lovelace',
        cohort_ids: ['cohort_1'],
        note: 'High value customer',
      },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/mixpanel/profiles/user%40example.com.json']);
  assert.equal(writes[0]?.semantics?.properties?.['mixpanel.email'], 'user@example.com');
  assert.equal(writes[0]?.semantics?.properties?.['mixpanel.name'], 'Ada Lovelace');
  assert.deepEqual(writes[0]?.semantics?.comments, ['High value customer']);
  assert.deepEqual(writes[0]?.semantics?.relations, ['/mixpanel/cohorts/cohort_1.json']);
});

test('ingestWebhook writes Mixpanel cohort webhooks and extracts member relations', async () => {
  const { adapter, writes } = createAdapter();

  const result = await adapter.ingestWebhook('workspace_1', {
    action: 'update',
    type: 'cohort',
    timestamp: 1_000_000,
    data: {
      count: 2,
      description: 'Users ready for expansion',
      id: 'cohort_1',
      member_ids: ['user_1', 'user_2'],
      name: 'Expansion ready',
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/mixpanel/cohorts/cohort_1.json']);
  assert.equal(writes[0]?.semantics?.properties?.['mixpanel.name'], 'Expansion ready');
  assert.equal(writes[0]?.semantics?.properties?.['mixpanel.count'], '2');
  assert.deepEqual(writes[0]?.semantics?.relations, [
    '/mixpanel/profiles/user_1.json',
    '/mixpanel/profiles/user_2.json',
  ]);
});

test('ingestWebhook deletes files for delete events when client supports deleteFile', async () => {
  const deleted: string[] = [];
  const { adapter } = createAdapter({
    async deleteFile(input) {
      deleted.push(input.path);
    },
  });

  const result = await adapter.ingestWebhook('workspace_1', {
    action: 'delete',
    type: 'profile',
    timestamp: 1_000_000,
    data: {
      $distinct_id: 'user_123',
    },
  });

  assert.equal(result.filesDeleted, 1);
  assert.deepEqual(deleted, ['/mixpanel/profiles/user_123.json']);
});

test('computeSemantics extracts event campaign properties and profile relation', () => {
  const { adapter } = createAdapter();

  const semantics = adapter.computeSemantics('event', 'evt_123', {
    event: 'Checkout Completed',
    properties: {
      $insert_id: 'evt_123',
      $revenue: 42.5,
      distinct_id: 'user_123',
      mp_country_code: 'US',
      utm_campaign: 'spring',
      utm_medium: 'email',
      utm_source: 'newsletter',
    },
  });

  assert.equal(semantics.properties?.['mixpanel.event'], 'Checkout Completed');
  assert.equal(semantics.properties?.['mixpanel.revenue'], '42.5');
  assert.equal(semantics.properties?.['mixpanel.utm_campaign'], 'spring');
  assert.deepEqual(semantics.relations, ['/mixpanel/profiles/user_123.json']);
});

test('path mapping stays deterministic for supported Mixpanel VFS objects', () => {
  const { adapter } = createAdapter();

  assert.equal(mixpanelEventPath('evt 1/2', 'Signed Up'), '/mixpanel/events/signed-up--evt12.json');
  assert.equal(mixpanelProfilePath('user@example.com'), '/mixpanel/profiles/user%40example.com.json');
  assert.equal(mixpanelCohortPath('cohort/1'), '/mixpanel/cohorts/cohort%2F1.json');
  assert.equal(computeMixpanelPath('Events', 'evt 1/2', 'Signed Up'), '/mixpanel/events/signed-up--evt12.json');
  assert.equal(computeMixpanelPath('people', 'user@example.com'), '/mixpanel/profiles/user%40example.com.json');
  assert.equal(computeMixpanelPath('cohorts', 'cohort/1'), '/mixpanel/cohorts/cohort%2F1.json');
  assert.equal(adapter.computePath('event', 'evt 1/2', 'Signed Up'), '/mixpanel/events/signed-up--evt12.json');
  assert.equal(adapter.computePath('profile', 'user@example.com'), '/mixpanel/profiles/user%40example.com.json');
  assert.equal(adapter.computePath('cohort', 'cohort/1'), '/mixpanel/cohorts/cohort%2F1.json');
});
