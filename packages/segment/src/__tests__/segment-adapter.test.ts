import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SegmentAdapter,
  computeSegmentPath,
  resolveReadRequest,
  resolveWritebackRequest,
  segmentGroupPath,
  segmentIdentifyPath,
  segmentPagePath,
  segmentTrackPath,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

interface AdapterHarness {
  adapter: SegmentAdapter;
  writes: WriteFileInput[];
}

function createHarness(): AdapterHarness {
  const writes: WriteFileInput[] = [];
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push(input);
      return { created: true };
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
    adapter: new SegmentAdapter(client, provider, { connectionId: 'conn_segment_123' }),
    writes,
  };
}

test('SegmentAdapter ingests identify payloads into deterministic identity paths', async () => {
  const { adapter, writes } = createHarness();

  const result = await adapter.ingestWebhook('workspace_123', {
    type: 'identify',
    userId: 'user_123',
    anonymousId: 'anon_123',
    messageId: 'msg_identify_123',
    traits: {
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      plan: 'enterprise',
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/segment/identify/user_123.json']);
  assert.equal(writes[0]?.path, '/segment/identify/user_123.json');
  assert.equal(writes[0]?.semantics?.properties?.['segment.trait.email'], 'ada@example.com');
  assert.equal(writes[0]?.semantics?.properties?.['segment.trait.plan'], 'enterprise');
});

test('SegmentAdapter ingests track payloads and extracts event semantics', async () => {
  const { adapter, writes } = createHarness();

  const result = await adapter.ingestWebhook('workspace_123', {
    type: 'track',
    userId: 'user_123',
    groupId: 'group_123',
    messageId: 'msg-track-123',
    event: 'Order Completed',
    properties: {
      currency: 'usd',
      orderId: 'order_123',
      revenue: 42.5,
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/segment/track/order-completed--msgtrack123.json']);
  assert.equal(writes[0]?.semantics?.properties?.['segment.track.event'], 'Order Completed');
  assert.equal(writes[0]?.semantics?.properties?.['segment.revenue'], '42.5');
  assert.equal(writes[0]?.semantics?.properties?.['segment.currency'], 'USD');
  assert.deepEqual(writes[0]?.semantics?.relations, [
    '/segment/groups/group_123.json',
    '/segment/identify/user_123.json',
  ]);
});

test('SegmentAdapter ingests page payloads and uses page names in paths', async () => {
  const { adapter, writes } = createHarness();

  const result = await adapter.ingestWebhook('workspace_123', {
    type: 'page',
    userId: 'user_456',
    messageId: 'msg-page-456',
    name: 'Pricing Page',
    category: 'Marketing',
    properties: {
      path: '/pricing',
      title: 'Pricing',
      url: 'https://example.com/pricing',
    },
    context: {
      page: {
        referrer: 'https://google.example',
      },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/segment/page/pricing-page--msgpage456.json']);
  assert.equal(writes[0]?.semantics?.properties?.['segment.page.name'], 'Pricing Page');
  assert.equal(writes[0]?.semantics?.properties?.['segment.page.property.url'], 'https://example.com/pricing');
  assert.equal(writes[0]?.semantics?.properties?.['segment.context.page_referrer'], 'https://google.example');
});

test('SegmentAdapter ingests group payloads and relates groups to users', async () => {
  const { adapter, writes } = createHarness();

  const result = await adapter.ingestWebhook('workspace_123', {
    type: 'group',
    userId: 'user_789',
    groupId: 'company_789',
    messageId: 'msg_group_789',
    traits: {
      industry: 'software',
      name: 'Example Inc.',
      plan: 'business',
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/segment/groups/company_789.json']);
  assert.equal(writes[0]?.semantics?.properties?.['segment.group.trait.industry'], 'software');
  assert.equal(writes[0]?.semantics?.properties?.['segment.group.trait.name'], 'Example Inc.');
  assert.deepEqual(writes[0]?.semantics?.relations, [
    '/segment/groups/company_789.json',
    '/segment/identify/user_789.json',
  ]);
});

test('computeSemantics extracts context and webhook metadata deterministically', () => {
  const { adapter } = createHarness();

  const semantics = adapter.computeSemantics('track', 'msg_123', {
    event: 'Subscription Started',
    messageId: 'msg_123',
    userId: 'user_123',
    context: {
      ip: '203.0.113.10',
      library: {
        name: 'analytics-node',
        version: '6.0.0',
      },
      campaign: {
        name: 'spring',
        source: 'newsletter',
      },
    },
    _webhook: {
      deliveryId: 'delivery_123',
      eventType: 'track.upsert',
      sourceId: 'source_123',
    },
  });

  assert.equal(semantics.properties?.['segment.context.ip'], '203.0.113.10');
  assert.equal(semantics.properties?.['segment.context.library_name'], 'analytics-node');
  assert.equal(semantics.properties?.['segment.context.campaign_source'], 'newsletter');
  assert.equal(semantics.properties?.['segment.webhook.delivery_id'], 'delivery_123');
  assert.equal(semantics.properties?.['segment.webhook.source_id'], 'source_123');
});

test('path mapping covers every Segment object type and aliases', () => {
  const { adapter } = createHarness();

  assert.equal(segmentIdentifyPath('user@example.com'), '/segment/identify/user%40example.com.json');
  assert.equal(segmentTrackPath('msg-123', 'Signed Up'), '/segment/track/signed-up--msg123.json');
  assert.equal(segmentPagePath('msg-456', 'Docs Home'), '/segment/page/docs-home--msg456.json');
  assert.equal(segmentGroupPath('company/123'), '/segment/groups/company%2F123.json');

  assert.equal(computeSegmentPath('Identify', 'user 123'), '/segment/identify/user%20123.json');
  assert.equal(computeSegmentPath('tracks', 'msg-123', 'Signed Up'), '/segment/track/signed-up--msg123.json');
  assert.equal(computeSegmentPath('pages', 'msg-456', 'Docs Home'), '/segment/page/docs-home--msg456.json');
  assert.equal(computeSegmentPath('groups', 'company/123'), '/segment/groups/company%2F123.json');

  assert.equal(adapter.computePath('segmentidentify', 'user_123'), '/segment/identify/user_123.json');
  assert.equal(adapter.computePath('segmenttrack', 'msg_123', 'Activated'), '/segment/track/activated--msg_123.json');
});

test('read routes use Segment Public API delivery overview instead of write-only Tracking API calls', () => {
  assert.deepEqual(resolveReadRequest('/segment/identify/user_123.json'), {
    method: 'GET',
    endpoint: '/delivery-overview/filtered-at-source',
    query: {
      'filter.eventType': 'identify',
      'groupBy.0': 'eventName',
      'groupBy.1': 'eventType',
      granularity: 'DAY',
    },
  });

  assert.deepEqual(resolveReadRequest('/segment/track/order-completed--msgtrack123.json'), {
    method: 'GET',
    endpoint: '/delivery-overview/filtered-at-source',
    query: {
      'filter.eventName': 'order completed',
      'filter.eventType': 'track',
      'groupBy.0': 'eventName',
      'groupBy.1': 'eventType',
      granularity: 'DAY',
    },
  });
});

test('writeback routes emit Segment Tracking API requests', () => {
  assert.deepEqual(resolveWritebackRequest('/segment/identify/user_123.json', '{"traits":{"email":"ada@example.com"}}'), {
    action: 'identify',
    method: 'POST',
    endpoint: '/v1/identify',
    body: {
      traits: { email: 'ada@example.com' },
      userId: 'user_123',
    },
  });

  assert.deepEqual(
    resolveWritebackRequest(
      '/segment/track/signed-up--msg_123.json',
      '{"event":"Signed Up","userId":"user_123","properties":{"plan":"pro"}}',
    ),
    {
      action: 'track',
      method: 'POST',
      endpoint: '/v1/track',
      body: {
        event: 'Signed Up',
        messageId: 'msg_123',
        properties: { plan: 'pro' },
        userId: 'user_123',
      },
    },
  );

  assert.deepEqual(
    resolveWritebackRequest(
      '/segment/page/docs-home--msg_456.json',
      '{"name":"Docs Home","userId":"user_123","properties":{"path":"/docs"}}',
    ),
    {
      action: 'page',
      method: 'POST',
      endpoint: '/v1/page',
      body: {
        messageId: 'msg_456',
        name: 'Docs Home',
        properties: { path: '/docs' },
        userId: 'user_123',
      },
    },
  );

  assert.deepEqual(resolveWritebackRequest('/segment/groups/company_123.json', '{"traits":{"plan":"enterprise"}}'), {
    action: 'group',
    method: 'POST',
    endpoint: '/v1/group',
    body: {
      groupId: 'company_123',
      traits: { plan: 'enterprise' },
    },
  });

  assert.deepEqual(resolveWritebackRequest('/segment/batch/new.json', '{"batch":[{"type":"track","event":"Signed Up"}]}'), {
    action: 'batch',
    method: 'POST',
    endpoint: '/v1/batch',
    body: {
      batch: [{ type: 'track', event: 'Signed Up' }],
      context: undefined,
      integrations: undefined,
    },
  });

  assert.throws(
    () => resolveWritebackRequest('/segment/track/new.json', '{"userId":"user_123"}'),
    /requires `event`/,
  );
});
