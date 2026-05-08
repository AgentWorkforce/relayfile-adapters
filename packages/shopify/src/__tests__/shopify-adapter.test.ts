import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ShopifyAdapter,
  computeShopifyPath,
  resolveShopifyReadRequest,
  resolveShopifyWritebackRequest,
  shopifyCustomerPath,
  shopifyFulfillmentPath,
  shopifyOrderPath,
  shopifyProductPath,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type ShopifyAdapterConfig,
  type WriteFileInput,
} from '../index.js';

interface CapturingClient extends RelayFileClientLike {
  writes: WriteFileInput[];
  deletes: string[];
}

function createAdapter(config: ShopifyAdapterConfig = {}): { adapter: ShopifyAdapter; client: CapturingClient } {
  const client: CapturingClient = {
    writes: [],
    deletes: [],
    async writeFile(input) {
      this.writes.push(input);
      return { created: true };
    },
    async deleteFile(input) {
      this.deletes.push(input.path);
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

  return { adapter: new ShopifyAdapter(client, provider, config), client };
}

test('ShopifyAdapter exposes supported primary webhook events', () => {
  const { adapter } = createAdapter();

  assert.equal(adapter.name, 'shopify');
  assert.deepEqual(adapter.supportedEvents(), [
    'order.create',
    'order.update',
    'order.delete',
    'product.create',
    'product.update',
    'product.delete',
    'customer.create',
    'customer.update',
    'customer.delete',
    'fulfillment.create',
    'fulfillment.update',
    'fulfillment.delete',
  ]);
});

test('ingestWebhook writes order payloads with order semantics and product relations', async () => {
  const { adapter, client } = createAdapter({ connectionId: 'conn_shopify_123' });

  const result = await adapter.ingestWebhook('workspace_1', {
    provider: 'shopify',
    connectionId: 'conn_shopify_123',
    eventType: 'order.create',
    objectType: 'order',
    objectId: '450789469',
    payload: {
      id: 450789469,
      name: '#1001',
      email: 'buyer@example.com',
      financial_status: 'paid',
      fulfillment_status: 'partial',
      total_price: '199.00',
      customer: { id: 207119551, email: 'buyer@example.com', first_name: 'Ada', last_name: 'Lovelace' },
      line_items: [
        { id: 1, product_id: 632910392, title: 'Relay Tee', sku: 'TEE-1', vendor: 'Relayfile', quantity: 2 },
      ],
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(client.writes.length, 1);
  assert.equal(client.writes[0]?.path, '/shopify/orders/1001--450789469.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['shopify.order.financial_status'], 'paid');
  assert.equal(client.writes[0]?.semantics?.properties?.['shopify.customer_email'], 'buyer@example.com');
  assert.deepEqual(client.writes[0]?.semantics?.relations, [
    '/shopify/customers/ada-lovelace--207119551.json',
    '/shopify/products/relay-tee--632910392.json',
  ]);
});

test('ingestWebhook writes product payloads with product semantics', async () => {
  const { adapter, client } = createAdapter();

  const result = await adapter.ingestWebhook('workspace_1', {
    provider: 'shopify',
    eventType: 'product.update',
    objectType: 'product',
    objectId: '632910392',
    payload: {
      id: 632910392,
      title: 'Relay Tee',
      handle: 'relay-tee',
      vendor: 'Relayfile',
      product_type: 'Apparel',
      status: 'active',
      body_html: '<p>Soft cotton shirt.</p>',
      variants: [
        { id: 808950810, sku: 'TEE-S', inventory_quantity: 4 },
        { id: 49148385, sku: 'TEE-M', inventory_quantity: 6 },
      ],
    },
  });

  assert.equal(result.paths[0], '/shopify/products/relay-tee--632910392.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['shopify.product.variant_count'], '2');
  assert.equal(client.writes[0]?.semantics?.properties?.['shopify.product.inventory_quantity'], '10');
  assert.deepEqual(client.writes[0]?.semantics?.comments, ['Soft cotton shirt.']);
});

test('ingestWebhook writes customer payloads with customer semantics', async () => {
  const { adapter, client } = createAdapter();

  await adapter.ingestWebhook('workspace_1', {
    provider: 'shopify',
    eventType: 'customer.create',
    objectType: 'customer',
    objectId: '207119551',
    payload: {
      id: 207119551,
      email: 'buyer@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      orders_count: 3,
      total_spent: '415.00',
      verified_email: true,
      default_address: {
        city: 'London',
        country: 'United Kingdom',
      },
    },
  });

  assert.equal(client.writes[0]?.path, '/shopify/customers/ada-lovelace--207119551.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['shopify.customer.orders_count'], '3');
  assert.equal(client.writes[0]?.semantics?.properties?.['shopify.customer.default_address.city'], 'London');
});

test('ingestWebhook writes fulfillment payloads with order relation', async () => {
  const { adapter, client } = createAdapter();

  await adapter.ingestWebhook('workspace_1', {
    provider: 'shopify',
    eventType: 'fulfillment.create',
    objectType: 'fulfillment',
    objectId: '255858046',
    payload: {
      id: 255858046,
      name: '#1001.1',
      order_id: 450789469,
      status: 'success',
      shipment_status: 'in_transit',
      tracking_company: 'UPS',
      tracking_numbers: ['1Z999'],
      tracking_urls: ['https://example.test/track/1Z999'],
    },
  });

  assert.equal(client.writes[0]?.path, '/shopify/fulfillments/1001-1--255858046.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['shopify.fulfillment.status'], 'success');
  assert.deepEqual(client.writes[0]?.semantics?.relations, ['/shopify/orders/450789469.json']);
});

test('ingestWebhook deletes files for delete events when the client supports deleteFile', async () => {
  const { adapter, client } = createAdapter();

  const result = await adapter.ingestWebhook('workspace_1', {
    provider: 'shopify',
    eventType: 'product.delete',
    objectType: 'product',
    objectId: '632910392',
    payload: {
      id: 632910392,
      title: 'Relay Tee',
    },
  });

  assert.equal(result.filesDeleted, 1);
  assert.deepEqual(client.deletes, ['/shopify/products/relay-tee--632910392.json']);
  assert.equal(client.writes.length, 0);
});

test('computePath and deterministic path helpers encode every primary object type', () => {
  const { adapter } = createAdapter();

  assert.equal(shopifyOrderPath('gid://shopify/Order/1', '#1001'), '/shopify/orders/1001--gid%3A%2F%2Fshopify%2FOrder%2F1.json');
  assert.equal(shopifyProductPath('product 1/2', 'Relay Tee'), '/shopify/products/relay-tee--product%201%2F2.json');
  assert.equal(shopifyCustomerPath('customer:42', 'Ada Lovelace'), '/shopify/customers/ada-lovelace--customer%3A42.json');
  assert.equal(shopifyFulfillmentPath('fulfillment 7', '#1001.1'), '/shopify/fulfillments/1001-1--fulfillment%207.json');

  assert.equal(adapter.computePath('orders', '450789469', '#1001'), '/shopify/orders/1001--450789469.json');
  assert.equal(computeShopifyPath('products', '632910392', 'Relay Tee'), '/shopify/products/relay-tee--632910392.json');
  assert.equal(computeShopifyPath('customers', '207119551', 'Ada Lovelace'), '/shopify/customers/ada-lovelace--207119551.json');
  assert.equal(computeShopifyPath('fulfillments', '255858046', '#1001.1'), '/shopify/fulfillments/1001-1--255858046.json');
});

test('read routes include Shopify REST endpoints and required route anchors', () => {
  const read = resolveShopifyReadRequest('/shopify/orders');
  assert.equal(read.method, 'GET');
  assert.equal(read.endpoint, '/admin/api/2026-04/orders.json');
  assert.ok(read.query);
  assert.equal(read.query.limit, '250');
  assert.equal(read.query.status, 'any');
  const fieldsQuery = read.query.fields;
  if (typeof fieldsQuery !== 'string') {
    assert.fail('expected Shopify order fields query to be a string');
  }
  const fields = new Set(fieldsQuery.split(','));
  for (const required of [
    'id',
    'admin_graphql_api_id',
    'app_id',
    'created_at',
    'customer',
    'line_items',
    'total_price',
    'updated_at',
  ]) {
    assert.ok(fields.has(required), `expected Shopify order fields to include ${required}`);
  }
  assert.equal(resolveShopifyReadRequest('/shopify/products/relay-tee--632910392.json').endpoint, '/admin/api/2026-04/products/632910392.json');
});

test('writeback routes map VFS writes to Shopify REST mutations', () => {
  assert.deepEqual(resolveShopifyWritebackRequest('/shopify/products/new.json', JSON.stringify({ title: 'Relay Tee', vendor: 'Relayfile' })), {
    action: 'create_product',
    method: 'POST',
    endpoint: '/admin/api/2026-04/products.json',
    body: {
      product: {
        title: 'Relay Tee',
        vendor: 'Relayfile',
      },
    },
  });

  assert.deepEqual(resolveShopifyWritebackRequest('/shopify/customers/ada--207119551.json', JSON.stringify({ email: 'new@example.com' })), {
    action: 'update_customer',
    method: 'PUT',
    endpoint: '/admin/api/2026-04/customers/207119551.json',
    body: {
      customer: {
        email: 'new@example.com',
        id: '207119551',
      },
    },
  });
});
