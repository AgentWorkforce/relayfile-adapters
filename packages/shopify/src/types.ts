export const SHOPIFY_WEBHOOK_OBJECT_TYPES = [
  'order',
  'product',
  'customer',
  'fulfillment',
] as const;

export const SHOPIFY_WEBHOOK_ACTIONS = [
  'create',
  'update',
  'delete',
  'fulfill',
] as const;

export type ShopifyWebhookObjectType = (typeof SHOPIFY_WEBHOOK_OBJECT_TYPES)[number];
export type ShopifyWebhookAction = (typeof SHOPIFY_WEBHOOK_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface ShopifyAdapterConfig {
  apiVersion?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  shopDomain?: string;
  webhookSecret?: string;
}

export interface ShopifyRestRequest {
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface ShopifyWritebackRequest extends ShopifyRestRequest {
  action:
    | 'cancel_order'
    | 'create_customer'
    | 'create_fulfillment'
    | 'create_order'
    | 'create_product'
    | 'update_customer'
    | 'update_order'
    | 'update_product';
}

export interface ShopifyMoneySet {
  shop_money?: {
    amount?: string;
    currency_code?: string;
  };
  presentment_money?: {
    amount?: string;
    currency_code?: string;
  };
}

export interface ShopifyAddress {
  id?: number | string;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  company?: string | null;
  country?: string | null;
  country_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  phone?: string | null;
  province?: string | null;
  province_code?: string | null;
  zip?: string | null;
}

export interface ShopifyCustomerReference {
  id?: number | string;
  admin_graphql_api_id?: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

export interface ShopifyLineItem {
  id?: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  title?: string;
  product_id?: number | string | null;
  variant_id?: number | string | null;
  sku?: string | null;
  vendor?: string | null;
  quantity?: number;
  price?: string;
  total_discount?: string;
  fulfillment_status?: string | null;
  requires_shipping?: boolean;
}

export interface ShopifyOrder {
  id: number | string;
  admin_graphql_api_id?: string;
  app_id?: number | string | null;
  browser_ip?: string | null;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  closed_at?: string | null;
  created_at?: string;
  currency?: string;
  current_subtotal_price?: string;
  current_total_discounts?: string;
  current_total_price?: string;
  current_total_tax?: string;
  email?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  landing_site?: string | null;
  location_id?: number | string | null;
  name?: string;
  note?: string | null;
  number?: number;
  order_number?: number;
  order_status_url?: string;
  phone?: string | null;
  processed_at?: string | null;
  source_name?: string | null;
  tags?: string;
  test?: boolean;
  token?: string;
  total_line_items_price?: string;
  total_price?: string;
  total_tax?: string;
  updated_at?: string;
  customer?: ShopifyCustomerReference | null;
  billing_address?: ShopifyAddress | null;
  shipping_address?: ShopifyAddress | null;
  line_items?: ShopifyLineItem[];
}

export interface ShopifyVariant {
  id?: number | string;
  admin_graphql_api_id?: string;
  barcode?: string | null;
  compare_at_price?: string | null;
  created_at?: string;
  fulfillment_service?: string;
  inventory_item_id?: number | string;
  inventory_management?: string | null;
  inventory_policy?: string;
  inventory_quantity?: number;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  position?: number;
  price?: string;
  product_id?: number | string;
  sku?: string | null;
  taxable?: boolean;
  title?: string;
  updated_at?: string;
  weight?: number;
  weight_unit?: string;
}

export interface ShopifyImage {
  id?: number | string;
  alt?: string | null;
  created_at?: string;
  position?: number;
  product_id?: number | string;
  src?: string;
  updated_at?: string;
  variant_ids?: Array<number | string>;
}

export interface ShopifyProduct {
  id: number | string;
  admin_graphql_api_id?: string;
  body_html?: string | null;
  created_at?: string;
  handle?: string;
  product_type?: string;
  published_at?: string | null;
  published_scope?: string;
  status?: 'active' | 'archived' | 'draft' | string;
  tags?: string;
  template_suffix?: string | null;
  title?: string;
  updated_at?: string;
  vendor?: string;
  variants?: ShopifyVariant[];
  images?: ShopifyImage[];
}

export interface ShopifyCustomer {
  id: number | string;
  admin_graphql_api_id?: string;
  accepts_marketing?: boolean;
  created_at?: string;
  currency?: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  last_order_id?: number | string | null;
  last_order_name?: string | null;
  multipass_identifier?: string | null;
  note?: string | null;
  orders_count?: number;
  phone?: string | null;
  state?: string;
  tags?: string;
  tax_exempt?: boolean;
  total_spent?: string;
  updated_at?: string;
  verified_email?: boolean;
  addresses?: ShopifyAddress[];
  default_address?: ShopifyAddress | null;
}

export interface ShopifyFulfillmentLineItem {
  id?: number | string;
  line_item_id?: number | string;
  quantity?: number;
}

export interface ShopifyFulfillment {
  id: number | string;
  admin_graphql_api_id?: string;
  created_at?: string;
  delivered_at?: string | null;
  estimated_delivery_at?: string | null;
  location_id?: number | string | null;
  name?: string;
  order_id?: number | string;
  origin_address?: ShopifyAddress | null;
  receipt?: Record<string, unknown>;
  service?: string;
  shipment_status?: string | null;
  status?: string;
  tracking_company?: string | null;
  tracking_number?: string | null;
  tracking_numbers?: string[];
  tracking_url?: string | null;
  tracking_urls?: string[];
  updated_at?: string;
  variant_inventory_management?: string | null;
  line_items?: ShopifyFulfillmentLineItem[];
}

export interface ShopifyWebhookPayload<TData = Record<string, unknown>> {
  topic?: string;
  type?: string;
  action?: string;
  objectType?: string;
  objectId?: string;
  shop_domain?: string;
  shopDomain?: string;
  webhook_id?: string;
  webhookId?: string;
  data?: TData;
  payload?: TData;
  metadata?: Record<string, unknown>;
  _connection?: Record<string, unknown>;
  _webhook?: Record<string, unknown>;
}

export type ShopifyPrimaryPayload =
  | ShopifyCustomer
  | ShopifyFulfillment
  | ShopifyOrder
  | ShopifyProduct
  | Record<string, unknown>;
