import { extractShopifyIdFromPathSegment } from './path-mapper.js';
import {
  SHOPIFY_API_VERSION,
  SHOPIFY_CUSTOMERS_ROUTE,
  SHOPIFY_ORDERS_ROUTE,
  SHOPIFY_PRODUCTS_ROUTE,
} from './queries.js';
import type { JsonValue, ShopifyWritebackRequest } from './types.js';

export function resolveShopifyWritebackRequest(path: string, content: string): ShopifyWritebackRequest {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === '/shopify/orders/new.json' || normalizedPath === '/shopify/orders/') {
    return buildOrderCreate(content);
  }

  const orderCancelMatch = normalizedPath.match(/^\/shopify\/orders\/([^/]+)\/cancel\.json$/u);
  if (orderCancelMatch?.[1]) {
    return buildOrderCancel(extractShopifyIdFromPathSegment(orderCancelMatch[1]), content);
  }

  const orderFulfillmentCreateMatch = normalizedPath.match(/^\/shopify\/orders\/([^/]+)\/fulfillments\/new\.json$/u);
  if (orderFulfillmentCreateMatch?.[1]) {
    return buildFulfillmentCreate(extractShopifyIdFromPathSegment(orderFulfillmentCreateMatch[1]), content);
  }

  const orderUpdateMatch = normalizedPath.match(/^\/shopify\/orders\/([^/]+)\.json$/u);
  if (orderUpdateMatch?.[1]) {
    return buildOrderUpdate(extractShopifyIdFromPathSegment(orderUpdateMatch[1]), content);
  }

  if (normalizedPath === '/shopify/products/new.json' || normalizedPath === '/shopify/products/') {
    return buildProductCreate(content);
  }

  const productUpdateMatch = normalizedPath.match(/^\/shopify\/products\/([^/]+)\.json$/u);
  if (productUpdateMatch?.[1]) {
    return buildProductUpdate(extractShopifyIdFromPathSegment(productUpdateMatch[1]), content);
  }

  if (normalizedPath === '/shopify/customers/new.json' || normalizedPath === '/shopify/customers/') {
    return buildCustomerCreate(content);
  }

  const customerUpdateMatch = normalizedPath.match(/^\/shopify\/customers\/([^/]+)\.json$/u);
  if (customerUpdateMatch?.[1]) {
    return buildCustomerUpdate(extractShopifyIdFromPathSegment(customerUpdateMatch[1]), content);
  }

  throw new Error(`No Shopify writeback rule matched ${path}`);
}

function buildOrderCreate(content: string): ShopifyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const order = pickAllowed(payload, [
    'billing_address',
    'buyer_accepts_marketing',
    'currency',
    'customer',
    'discount_codes',
    'email',
    'financial_status',
    'fulfillment_status',
    'inventory_behaviour',
    'line_items',
    'note',
    'phone',
    'processed_at',
    'shipping_address',
    'shipping_lines',
    'tags',
    'tax_lines',
    'transactions',
  ]);
  if (!Array.isArray(order.line_items) || order.line_items.length === 0) {
    throw new Error('orders/new.json writeback requires at least one `line_items` entry');
  }
  return {
    action: 'create_order',
    method: 'POST',
    endpoint: SHOPIFY_ORDERS_ROUTE,
    body: { order },
  };
}

function buildOrderUpdate(orderId: string, content: string): ShopifyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const order = pickAllowed(payload, [
    'email',
    'financial_status',
    'fulfillment_status',
    'metafields',
    'note',
    'phone',
    'shipping_address',
    'tags',
  ]);
  if (Object.keys(order).length === 0) {
    throw new Error('orders/<id>.json update writeback requires at least one mutable Shopify order field');
  }
  order.id = orderId;
  return {
    action: 'update_order',
    method: 'PUT',
    endpoint: `/admin/api/${SHOPIFY_API_VERSION}/orders/${encodeURIComponent(orderId)}.json`,
    body: { order },
  };
}

function buildOrderCancel(orderId: string, content: string): ShopifyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObjectOrEmpty(content));
  const body: Record<string, unknown> = {};
  copyString(payload, body, 'amount');
  copyString(payload, body, 'currency');
  copyString(payload, body, 'reason');
  copyBoolean(payload, body, 'email');
  copyBoolean(payload, body, 'refund');
  copyBoolean(payload, body, 'restock');
  return {
    action: 'cancel_order',
    method: 'POST',
    endpoint: `/admin/api/${SHOPIFY_API_VERSION}/orders/${encodeURIComponent(orderId)}/cancel.json`,
    body,
  };
}

function buildProductCreate(content: string): ShopifyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const title = readString(payload, 'title');
  if (!title) {
    throw new Error('products/new.json writeback requires a non-empty `title`');
  }
  const product = pickAllowed(payload, [
    'body_html',
    'handle',
    'images',
    'metafields',
    'options',
    'product_type',
    'published',
    'published_scope',
    'status',
    'tags',
    'template_suffix',
    'title',
    'variants',
    'vendor',
  ]);
  product.title = title;
  return {
    action: 'create_product',
    method: 'POST',
    endpoint: SHOPIFY_PRODUCTS_ROUTE,
    body: { product },
  };
}

function buildProductUpdate(productId: string, content: string): ShopifyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const product = pickAllowed(payload, [
    'body_html',
    'handle',
    'images',
    'metafields',
    'options',
    'product_type',
    'published',
    'published_scope',
    'status',
    'tags',
    'template_suffix',
    'title',
    'variants',
    'vendor',
  ]);
  if (Object.keys(product).length === 0) {
    throw new Error('products/<id>.json update writeback requires at least one mutable Shopify product field');
  }
  product.id = productId;
  return {
    action: 'update_product',
    method: 'PUT',
    endpoint: `/admin/api/${SHOPIFY_API_VERSION}/products/${encodeURIComponent(productId)}.json`,
    body: { product },
  };
}

function buildCustomerCreate(content: string): ShopifyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const email = readString(payload, 'email');
  const phone = readString(payload, 'phone');
  if (!email && !phone) {
    throw new Error('customers/new.json writeback requires `email` or `phone`');
  }
  const customer = pickAllowed(payload, [
    'accepts_marketing',
    'addresses',
    'email',
    'first_name',
    'last_name',
    'metafields',
    'multipass_identifier',
    'note',
    'phone',
    'send_email_invite',
    'tags',
    'tax_exempt',
    'verified_email',
  ]);
  return {
    action: 'create_customer',
    method: 'POST',
    endpoint: SHOPIFY_CUSTOMERS_ROUTE,
    body: { customer },
  };
}

function buildCustomerUpdate(customerId: string, content: string): ShopifyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const customer = pickAllowed(payload, [
    'accepts_marketing',
    'addresses',
    'email',
    'first_name',
    'last_name',
    'metafields',
    'multipass_identifier',
    'note',
    'phone',
    'tags',
    'tax_exempt',
    'verified_email',
  ]);
  if (Object.keys(customer).length === 0) {
    throw new Error('customers/<id>.json update writeback requires at least one mutable Shopify customer field');
  }
  customer.id = customerId;
  return {
    action: 'update_customer',
    method: 'PUT',
    endpoint: `/admin/api/${SHOPIFY_API_VERSION}/customers/${encodeURIComponent(customerId)}.json`,
    body: { customer },
  };
}

function buildFulfillmentCreate(orderId: string, content: string): ShopifyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const fulfillment = pickAllowed(payload, [
    'line_items_by_fulfillment_order',
    'location_id',
    'message',
    'notify_customer',
    'tracking_info',
  ]);
  if (!fulfillment.location_id && !fulfillment.line_items_by_fulfillment_order) {
    throw new Error('fulfillments/new.json writeback requires `location_id` or `line_items_by_fulfillment_order`');
  }
  return {
    action: 'create_fulfillment',
    method: 'POST',
    endpoint: `/admin/api/${SHOPIFY_API_VERSION}/orders/${encodeURIComponent(orderId)}/fulfillments.json`,
    body: { fulfillment },
  };
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function parseJsonObjectOrEmpty(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed) return {};
  const parsed = safeParseJson(trimmed);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function safeParseJson(content: string): JsonValue | string {
  try {
    return JSON.parse(content) as JsonValue;
  } catch {
    return content.trim();
  }
}

function unwrapEnvelope(payload: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(payload.payload) && (payload.provider === 'shopify' || payload.objectType || payload.workspaceId)) {
    return payload.payload;
  }
  return payload;
}

function pickAllowed(payload: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function copyString(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = readString(source, key);
  if (value) target[key] = value;
}

function copyBoolean(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = source[key];
  if (typeof value === 'boolean') {
    target[key] = value;
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
