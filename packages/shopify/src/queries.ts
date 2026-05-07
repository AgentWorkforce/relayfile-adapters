import { extractShopifyIdFromPathSegment } from './path-mapper.js';
import type { ShopifyRestRequest } from './types.js';

export const SHOPIFY_API_VERSION = '2024-01';
export const SHOPIFY_ORDERS_ROUTE = '/admin/api/2024-01/orders.json';
export const SHOPIFY_PRODUCTS_ROUTE = '/admin/api/2024-01/products.json';
export const SHOPIFY_CUSTOMERS_ROUTE = '/admin/api/2024-01/customers.json';
export const SHOPIFY_FULFILLMENTS_ROUTE = '/admin/api/2024-01/fulfillments.json';

export const SHOPIFY_ORDER_FIELDS = [
  'id',
  'admin_graphql_api_id',
  'app_id',
  'cancel_reason',
  'cancelled_at',
  'closed_at',
  'created_at',
  'currency',
  'current_subtotal_price',
  'current_total_discounts',
  'current_total_price',
  'current_total_tax',
  'customer',
  'email',
  'financial_status',
  'fulfillment_status',
  'line_items',
  'name',
  'note',
  'order_number',
  'order_status_url',
  'processed_at',
  'shipping_address',
  'tags',
  'total_price',
  'updated_at',
] as const;

export const SHOPIFY_PRODUCT_FIELDS = [
  'id',
  'admin_graphql_api_id',
  'body_html',
  'created_at',
  'handle',
  'images',
  'product_type',
  'published_at',
  'status',
  'tags',
  'title',
  'updated_at',
  'variants',
  'vendor',
] as const;

export const SHOPIFY_CUSTOMER_FIELDS = [
  'id',
  'admin_graphql_api_id',
  'accepts_marketing',
  'addresses',
  'created_at',
  'currency',
  'default_address',
  'email',
  'first_name',
  'last_name',
  'last_order_id',
  'last_order_name',
  'note',
  'orders_count',
  'phone',
  'state',
  'tags',
  'tax_exempt',
  'total_spent',
  'updated_at',
  'verified_email',
] as const;

export const SHOPIFY_FULFILLMENT_FIELDS = [
  'id',
  'admin_graphql_api_id',
  'created_at',
  'delivered_at',
  'estimated_delivery_at',
  'line_items',
  'location_id',
  'name',
  'order_id',
  'service',
  'shipment_status',
  'status',
  'tracking_company',
  'tracking_number',
  'tracking_numbers',
  'tracking_url',
  'tracking_urls',
  'updated_at',
] as const;

export function resolveShopifyReadRequest(path: string): ShopifyRestRequest {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === '/shopify/orders' || normalizedPath === '/shopify/orders/') {
    return {
      method: 'GET',
      endpoint: SHOPIFY_ORDERS_ROUTE,
      query: {
        limit: '250',
        status: 'any',
        fields: SHOPIFY_ORDER_FIELDS.join(','),
      },
    };
  }

  const orderFulfillmentsMatch = normalizedPath.match(/^\/shopify\/orders\/([^/]+)\/fulfillments\/?$/u);
  if (orderFulfillmentsMatch?.[1]) {
    const orderId = extractShopifyIdFromPathSegment(orderFulfillmentsMatch[1]);
    return {
      method: 'GET',
      endpoint: `/admin/api/${SHOPIFY_API_VERSION}/orders/${encodeURIComponent(orderId)}/fulfillments.json`,
      query: {
        limit: '250',
        fields: SHOPIFY_FULFILLMENT_FIELDS.join(','),
      },
    };
  }

  const orderMatch = normalizedPath.match(/^\/shopify\/orders\/([^/]+)\.json$/u);
  if (orderMatch?.[1]) {
    const orderId = extractShopifyIdFromPathSegment(orderMatch[1]);
    return {
      method: 'GET',
      endpoint: `/admin/api/${SHOPIFY_API_VERSION}/orders/${encodeURIComponent(orderId)}.json`,
      query: {
        fields: SHOPIFY_ORDER_FIELDS.join(','),
      },
    };
  }

  if (normalizedPath === '/shopify/products' || normalizedPath === '/shopify/products/') {
    return {
      method: 'GET',
      endpoint: SHOPIFY_PRODUCTS_ROUTE,
      query: {
        limit: '250',
        fields: SHOPIFY_PRODUCT_FIELDS.join(','),
      },
    };
  }

  const productMatch = normalizedPath.match(/^\/shopify\/products\/([^/]+)\.json$/u);
  if (productMatch?.[1]) {
    const productId = extractShopifyIdFromPathSegment(productMatch[1]);
    return {
      method: 'GET',
      endpoint: `/admin/api/${SHOPIFY_API_VERSION}/products/${encodeURIComponent(productId)}.json`,
      query: {
        fields: SHOPIFY_PRODUCT_FIELDS.join(','),
      },
    };
  }

  if (normalizedPath === '/shopify/customers' || normalizedPath === '/shopify/customers/') {
    return {
      method: 'GET',
      endpoint: SHOPIFY_CUSTOMERS_ROUTE,
      query: {
        limit: '250',
        fields: SHOPIFY_CUSTOMER_FIELDS.join(','),
      },
    };
  }

  const customerOrdersMatch = normalizedPath.match(/^\/shopify\/customers\/([^/]+)\/orders\/?$/u);
  if (customerOrdersMatch?.[1]) {
    const customerId = extractShopifyIdFromPathSegment(customerOrdersMatch[1]);
    return {
      method: 'GET',
      endpoint: SHOPIFY_ORDERS_ROUTE,
      query: {
        customer_id: customerId,
        limit: '250',
        status: 'any',
        fields: SHOPIFY_ORDER_FIELDS.join(','),
      },
    };
  }

  const customerMatch = normalizedPath.match(/^\/shopify\/customers\/([^/]+)\.json$/u);
  if (customerMatch?.[1]) {
    const customerId = extractShopifyIdFromPathSegment(customerMatch[1]);
    return {
      method: 'GET',
      endpoint: `/admin/api/${SHOPIFY_API_VERSION}/customers/${encodeURIComponent(customerId)}.json`,
      query: {
        fields: SHOPIFY_CUSTOMER_FIELDS.join(','),
      },
    };
  }

  if (normalizedPath === '/shopify/fulfillments' || normalizedPath === '/shopify/fulfillments/') {
    return {
      method: 'GET',
      endpoint: SHOPIFY_FULFILLMENTS_ROUTE,
      query: {
        limit: '250',
        fields: SHOPIFY_FULFILLMENT_FIELDS.join(','),
      },
    };
  }

  const fulfillmentMatch = normalizedPath.match(/^\/shopify\/fulfillments\/([^/]+)\.json$/u);
  if (fulfillmentMatch?.[1]) {
    const fulfillmentId = extractShopifyIdFromPathSegment(fulfillmentMatch[1]);
    return {
      method: 'GET',
      endpoint: `/admin/api/${SHOPIFY_API_VERSION}/fulfillments/${encodeURIComponent(fulfillmentId)}.json`,
      query: {
        fields: SHOPIFY_FULFILLMENT_FIELDS.join(','),
      },
    };
  }

  throw new Error(`No Shopify read route matched ${path}`);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
