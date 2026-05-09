export const SHOPIFY_PATH_ROOT = '/shopify';

export const SHOPIFY_OBJECT_TYPES = [
  'order',
  'product',
  'customer',
  'fulfillment',
] as const;

export type ShopifyPathObjectType = (typeof SHOPIFY_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, ShopifyPathObjectType>> = {
  customer: 'customer',
  customers: 'customer',
  shopifycustomer: 'customer',
  fulfillment: 'fulfillment',
  fulfillments: 'fulfillment',
  shopifyfulfillment: 'fulfillment',
  order: 'order',
  orders: 'order',
  shopifyorder: 'order',
  product: 'product',
  products: 'product',
  shopifyproduct: 'product',
};

const NANGO_MODEL_MAP: Readonly<Record<string, ShopifyPathObjectType>> = {
  ShopifyCustomer: 'customer',
  ShopifyFulfillment: 'fulfillment',
  ShopifyOrder: 'order',
  ShopifyProduct: 'product',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Shopify ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeShopifyPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

function slugify(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function titleSegmentWithId(title: string | undefined, id: string): string {
  const normalizedId = assertNonEmptySegment(id, 'object id');
  const slug = title ? slugify(title) : '';
  return slug ? `${slug}--${encodeShopifyPathSegment(normalizedId)}` : encodeShopifyPathSegment(normalizedId);
}

export function normalizeShopifyObjectType(objectType: string): ShopifyPathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[^a-z]/g, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Shopify object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeShopifyObjectType(objectType: string): ShopifyPathObjectType | undefined {
  try {
    return normalizeShopifyObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoShopifyModel(model: string): ShopifyPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeShopifyObjectType(model);
}

export function shopifyOrderPath(orderId: string, name?: string): string {
  return `${SHOPIFY_PATH_ROOT}/orders/${titleSegmentWithId(name, orderId)}.json`;
}

export function shopifyProductPath(productId: string, title?: string): string {
  return `${SHOPIFY_PATH_ROOT}/products/${titleSegmentWithId(title, productId)}.json`;
}

export function shopifyCustomerPath(customerId: string, nameOrEmail?: string): string {
  return `${SHOPIFY_PATH_ROOT}/customers/${titleSegmentWithId(nameOrEmail, customerId)}.json`;
}

export function shopifyFulfillmentPath(fulfillmentId: string, name?: string): string {
  return `${SHOPIFY_PATH_ROOT}/fulfillments/${titleSegmentWithId(name, fulfillmentId)}.json`;
}

export function computeShopifyPath(objectType: string, objectId: string, displayName?: string): string {
  const normalizedType = normalizeShopifyObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'order':
      return shopifyOrderPath(normalizedId, displayName);
    case 'product':
      return shopifyProductPath(normalizedId, displayName);
    case 'customer':
      return shopifyCustomerPath(normalizedId, displayName);
    case 'fulfillment':
      return shopifyFulfillmentPath(normalizedId, displayName);
  }
}

export function extractShopifyIdFromPathSegment(segment: string): string {
  const decoded = decodeURIComponent(segment.trim());
  if (!decoded) {
    throw new Error('Shopify path segment must be non-empty');
  }
  const separatorIndex = decoded.lastIndexOf('--');
  if (separatorIndex >= 0) {
    const suffix = decoded.slice(separatorIndex + 2).trim();
    if (!suffix) {
      throw new Error(`Shopify path segment "${segment}" is missing an id suffix`);
    }
    return suffix;
  }
  return decoded;
}
