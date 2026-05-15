import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeShopifyPath,
  normalizeShopifyObjectType,
  shopifyCustomerPath,
  shopifyFulfillmentPath,
  shopifyOrderPath,
  shopifyProductPath,
} from './path-mapper.js';
import { SHOPIFY_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  ShopifyAdapterConfig,
  ShopifyAddress,
  ShopifyCustomer,
  ShopifyCustomerReference,
  ShopifyFulfillment,
  ShopifyLineItem,
  ShopifyProduct,
  ShopifyVariant,
  ShopifyWebhookPayload,
} from './types.js';

export interface FileSemantics {
  properties?: Record<string, string>;
  relations?: string[];
  permissions?: string[];
  comments?: string[];
}

export interface IngestError {
  path: string;
  error: string;
}

export interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: IngestError[];
}

export interface NormalizedWebhook {
  provider: string;
  connectionId?: string;
  eventType: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
}

export interface WriteFileInput {
  workspaceId: string;
  path: string;
  content: string;
  contentType?: string;
  semantics?: FileSemantics;
}

export interface WriteFileResult {
  created?: boolean;
  updated?: boolean;
  status?: 'created' | 'updated' | 'queued' | 'pending';
}

export interface DeleteFileInput {
  workspaceId: string;
  path: string;
}

export interface RelayFileClientLike {
  writeFile(input: WriteFileInput): Promise<WriteFileResult | void>;
  deleteFile?(input: DeleteFileInput): Promise<void> | void;
}

export abstract class IntegrationAdapter {
  protected readonly client: RelayFileClientLike;
  protected readonly provider: ConnectionProvider;

  abstract readonly name: string;
  abstract readonly version: string;

  constructor(client: RelayFileClientLike, provider: ConnectionProvider) {
    this.client = client;
    this.provider = provider;
  }

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | ShopifyWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;

  supportedEvents?(): string[];
}

type ShopifyRecord = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SHOPIFY_PROVIDER_NAME = 'shopify';
const SUPPORTED_EVENTS = SHOPIFY_WEBHOOK_OBJECT_TYPES;

export class ShopifyAdapter extends IntegrationAdapter {
  override readonly name = SHOPIFY_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: ShopifyAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: ShopifyAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return SUPPORTED_EVENTS.flatMap((objectType) => [
      `${objectType}.create`,
      `${objectType}.update`,
      `${objectType}.delete`,
      `${objectType}.cancel`,
      `${objectType}.paid`,
      `${objectType}.fulfill`,
    ]);
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | ShopifyWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = computeShopifyPath(
        normalized.objectType,
        normalized.objectId,
        readDisplayName(normalized.objectType, normalized.payload),
      );
      const semantics = this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload);

      if (this.isDeleteEvent(normalized)) {
        if (this.client.deleteFile) {
          await this.client.deleteFile({ workspaceId, path });
          return {
            filesWritten: 0,
            filesUpdated: 0,
            filesDeleted: 1,
            paths: [path],
            errors: [],
          };
        }

        const deleteResult = await this.client.writeFile({
          workspaceId,
          path,
          content: this.renderContent(workspaceId, normalized, true),
          contentType: JSON_CONTENT_TYPE,
          semantics,
        });
        const counts = inferWriteCounts(deleteResult, true);
        return {
          filesWritten: counts.filesWritten,
          filesUpdated: counts.filesUpdated,
          filesDeleted: counts.filesDeleted,
          paths: [path],
          errors: [],
        };
      }

      const writeResult = await this.client.writeFile({
        workspaceId,
        path,
        content: this.renderContent(workspaceId, normalized, false),
        contentType: JSON_CONTENT_TYPE,
        semantics,
      });
      const counts = inferWriteCounts(writeResult, false);
      return {
        filesWritten: counts.filesWritten,
        filesUpdated: counts.filesUpdated,
        filesDeleted: 0,
        paths: [path],
        errors: [],
      };
    } catch (error) {
      const fallbackPath = inferFallbackPath(event);
      return {
        filesWritten: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        paths: fallbackPath ? [fallbackPath] : [],
        errors: [
          {
            path: fallbackPath,
            error: toErrorMessage(error),
          },
        ],
      };
    }
  }

  override computePath(objectType: string, objectId: string, displayName?: string): string {
    return computeShopifyPath(objectType, objectId, displayName);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeShopifyObjectType(objectType);
    const properties: Record<string, string> = {
      provider: SHOPIFY_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'shopify.id': objectId,
      'shopify.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    addFirstStringProperty(properties, 'shopify.graphql_id', payload.admin_graphql_api_id, payload.adminGraphqlApiId);
    addStringProperty(properties, 'shopify.shop_domain', payload.shop_domain);

    const connection = getRecord(payload._connection);
    if (connection) {
      addStringProperty(properties, 'shopify.connection_id', connection.connectionId);
      addStringProperty(properties, 'shopify.provider_config_key', connection.providerConfigKey);
      addStringProperty(properties, 'shopify.shop_domain', connection.shopDomain);
    }

    const webhook = getRecord(payload._webhook);
    if (webhook) {
      addStringProperty(properties, 'shopify.webhook.action', webhook.action);
      addStringProperty(properties, 'shopify.webhook.api_version', webhook.apiVersion);
      addStringProperty(properties, 'shopify.webhook.event_type', webhook.eventType);
      addStringProperty(properties, 'shopify.webhook.id', webhook.webhookId);
      addStringProperty(properties, 'shopify.webhook.shop_domain', webhook.shopDomain);
      addStringProperty(properties, 'shopify.webhook.topic', webhook.topic);
      addNumberProperty(properties, 'shopify.webhook.timestamp', webhook.webhookTimestamp);
    }

    switch (normalizedType) {
      case 'order':
        applyOrderSemantics(properties, relations, comments, payload as ShopifyRecord);
        break;
      case 'product':
        applyProductSemantics(properties, comments, payload as ShopifyRecord);
        break;
      case 'customer':
        applyCustomerSemantics(properties, comments, payload as ShopifyRecord);
        break;
      case 'fulfillment':
        applyFulfillmentSemantics(properties, relations, payload as ShopifyRecord);
        break;
    }

    const semantics: FileSemantics = {
      properties,
      relations: sortStrings(relations),
    };
    if (comments.length > 0) {
      semantics.comments = comments;
    }
    return compactSemantics(semantics);
  }

  private normalizeEvent(event: NormalizedWebhook | ShopifyWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || SHOPIFY_PROVIDER_NAME,
        eventType: event.eventType,
        objectType: normalizeShopifyObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const payload = getPrimaryPayload(event);
    const objectType = normalizeShopifyObjectType(
      asString(event.objectType) ?? asString(event.type) ?? objectTypeFromTopic(asString(event.topic)) ?? inferObjectType(payload),
    );
    const objectId =
      asString(event.objectId) ??
      readObjectId(payload) ??
      readObjectId(event as ShopifyRecord);
    if (!objectId) {
      throw new Error(`Shopify ${objectType} webhook is missing an object identifier`);
    }
    const action = normalizeAction(asString(event.action) ?? actionFromTopic(asString(event.topic)) ?? 'update');
    const mergedPayload = mergeShopifyPayload(event, payload, objectType, objectId, action);
    const normalized: NormalizedWebhook = {
      provider: this.config.provider || SHOPIFY_PROVIDER_NAME,
      eventType: `${objectType}.${action}`,
      objectType,
      objectId,
      payload: mergedPayload,
    };
    if (this.config.connectionId) {
      normalized.connectionId = this.config.connectionId;
    }
    return normalized;
  }

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const action = getWebhookAction(event.payload) ?? getEventAction(event.eventType);
    return action === 'delete' || action === 'deleted' || action === 'remove';
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeShopifyObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function applyOrderSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  payload: ShopifyRecord,
): void {
  const order = payload as Partial<ShopifyOrderLike> & ShopifyRecord;

  addStringProperty(properties, 'shopify.order.name', order.name);
  addNumberProperty(properties, 'shopify.order.number', order.order_number ?? order.number);
  addStringProperty(properties, 'shopify.order.email', order.email);
  addStringProperty(properties, 'shopify.order.phone', order.phone);
  addStringProperty(properties, 'shopify.order.currency', order.currency);
  addStringProperty(properties, 'shopify.order.financial_status', order.financial_status);
  addStringProperty(properties, 'shopify.order.fulfillment_status', order.fulfillment_status);
  addStringProperty(properties, 'shopify.order.cancel_reason', order.cancel_reason);
  addStringProperty(properties, 'shopify.order.source_name', order.source_name);
  addStringProperty(properties, 'shopify.order.status_url', order.order_status_url);
  addStringProperty(properties, 'shopify.order.tags', order.tags);
  addStringProperty(properties, 'shopify.order.total_price', order.total_price ?? order.current_total_price);
  addStringProperty(properties, 'shopify.order.total_tax', order.total_tax ?? order.current_total_tax);
  addStringProperty(properties, 'shopify.order.total_discounts', order.current_total_discounts);
  addFirstStringProperty(properties, 'shopify.created_at', order.created_at, order.createdAt);
  addFirstStringProperty(properties, 'shopify.updated_at', order.updated_at, order.updatedAt);
  addStringProperty(properties, 'shopify.closed_at', order.closed_at);
  addStringProperty(properties, 'shopify.cancelled_at', order.cancelled_at);
  addStringProperty(properties, 'shopify.processed_at', order.processed_at);
  addBooleanProperty(properties, 'shopify.order.test', order.test);

  const customer = order.customer as ShopifyCustomerReference | null | undefined;
  const customerId = stringifyId(customer?.id) ?? asString(order.customer_id);
  if (customerId) {
    relations.add(shopifyCustomerPath(customerId, customerDisplayName(customer)));
    addStringProperty(properties, 'shopify.customer_id', customerId);
    addStringProperty(properties, 'shopify.customer_email', customer?.email);
  }

  const lineItems = asLineItems(order.line_items);
  if (lineItems.length > 0) {
    properties['shopify.order.line_item_count'] = String(lineItems.length);
    addStringListProperty(properties, 'shopify.order.skus', lineItems.map((item) => item.sku).filter(isString));
    addStringListProperty(properties, 'shopify.order.vendors', lineItems.map((item) => item.vendor).filter(isString));
    for (const lineItem of lineItems) {
      const productId = stringifyId(lineItem.product_id);
      if (productId) {
        relations.add(shopifyProductPath(productId, lineItem.title ?? lineItem.name));
      }
    }
  }

  const shipping = order.shipping_address as ShopifyAddress | null | undefined;
  if (shipping) {
    addAddressProperties(properties, 'shopify.shipping', shipping);
  }
  const billing = order.billing_address as ShopifyAddress | null | undefined;
  if (billing) {
    addAddressProperties(properties, 'shopify.billing', billing);
  }

  const note = asString(order.note);
  if (note) {
    comments.push(note);
    properties['shopify.order.note_length'] = String(note.length);
  }
}

type ShopifyOrderLike = import('./types.js').ShopifyOrder & {
  createdAt?: string;
  customer_id?: string | number;
  updatedAt?: string;
};

function applyProductSemantics(
  properties: Record<string, string>,
  comments: string[],
  payload: ShopifyRecord,
): void {
  const product = payload as Partial<ShopifyProduct> & ShopifyRecord;

  addStringProperty(properties, 'shopify.product.title', product.title);
  addStringProperty(properties, 'shopify.product.handle', product.handle);
  addStringProperty(properties, 'shopify.product.status', product.status);
  addStringProperty(properties, 'shopify.product.vendor', product.vendor);
  addStringProperty(properties, 'shopify.product.type', product.product_type);
  addStringProperty(properties, 'shopify.product.tags', product.tags);
  addStringProperty(properties, 'shopify.product.published_scope', product.published_scope);
  addFirstStringProperty(properties, 'shopify.created_at', product.created_at, product.createdAt);
  addFirstStringProperty(properties, 'shopify.updated_at', product.updated_at, product.updatedAt);
  addStringProperty(properties, 'shopify.published_at', product.published_at);

  const variants = asVariants(product.variants);
  if (variants.length > 0) {
    properties['shopify.product.variant_count'] = String(variants.length);
    addStringListProperty(properties, 'shopify.product.skus', variants.map((variant) => variant.sku).filter(isString));
    const inventoryTotal = variants
      .map((variant) => variant.inventory_quantity)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .reduce((sum, value) => sum + value, 0);
    properties['shopify.product.inventory_quantity'] = String(inventoryTotal);
  }

  const images = Array.isArray(product.images) ? product.images : [];
  if (images.length > 0) {
    properties['shopify.product.image_count'] = String(images.length);
  }

  const body = asString(product.body_html);
  if (body) {
    comments.push(stripHtml(body));
    properties['shopify.product.description_length'] = String(body.length);
  }
}

function applyCustomerSemantics(
  properties: Record<string, string>,
  comments: string[],
  payload: ShopifyRecord,
): void {
  const customer = payload as Partial<ShopifyCustomerWithAliases> & ShopifyRecord;

  addStringProperty(properties, 'shopify.customer.email', customer.email);
  addStringProperty(properties, 'shopify.customer.first_name', customer.first_name);
  addStringProperty(properties, 'shopify.customer.last_name', customer.last_name);
  addStringProperty(properties, 'shopify.customer.name', customerDisplayName(customer));
  addStringProperty(properties, 'shopify.customer.phone', customer.phone);
  addStringProperty(properties, 'shopify.customer.currency', customer.currency);
  addStringProperty(properties, 'shopify.customer.state', customer.state);
  addStringProperty(properties, 'shopify.customer.tags', customer.tags);
  addStringProperty(properties, 'shopify.customer.total_spent', customer.total_spent);
  addStringProperty(properties, 'shopify.customer.last_order_id', stringifyId(customer.last_order_id));
  addStringProperty(properties, 'shopify.customer.last_order_name', customer.last_order_name);
  addNumberProperty(properties, 'shopify.customer.orders_count', customer.orders_count);
  addBooleanProperty(properties, 'shopify.customer.accepts_marketing', customer.accepts_marketing);
  addBooleanProperty(properties, 'shopify.customer.tax_exempt', customer.tax_exempt);
  addBooleanProperty(properties, 'shopify.customer.verified_email', customer.verified_email);
  addFirstStringProperty(properties, 'shopify.created_at', customer.created_at, customer.createdAt);
  addFirstStringProperty(properties, 'shopify.updated_at', customer.updated_at, customer.updatedAt);

  const defaultAddress = customer.default_address;
  if (defaultAddress) {
    addAddressProperties(properties, 'shopify.customer.default_address', defaultAddress);
  }

  const addresses = Array.isArray(customer.addresses) ? customer.addresses : [];
  if (addresses.length > 0) {
    properties['shopify.customer.address_count'] = String(addresses.length);
  }

  const note = asString(customer.note);
  if (note) {
    comments.push(note);
    properties['shopify.customer.note_length'] = String(note.length);
  }
}

type ShopifyCustomerWithAliases = ShopifyCustomer & {
  createdAt?: string;
  updatedAt?: string;
};

function applyFulfillmentSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  payload: ShopifyRecord,
): void {
  const fulfillment = payload as Partial<ShopifyFulfillmentWithAliases> & ShopifyRecord;

  addStringProperty(properties, 'shopify.fulfillment.name', fulfillment.name);
  addStringProperty(properties, 'shopify.fulfillment.status', fulfillment.status);
  addStringProperty(properties, 'shopify.fulfillment.shipment_status', fulfillment.shipment_status);
  addStringProperty(properties, 'shopify.fulfillment.service', fulfillment.service);
  addStringProperty(properties, 'shopify.fulfillment.tracking_company', fulfillment.tracking_company);
  addStringProperty(properties, 'shopify.fulfillment.tracking_number', fulfillment.tracking_number);
  addStringListProperty(properties, 'shopify.fulfillment.tracking_numbers', asStringArray(fulfillment.tracking_numbers));
  addStringListProperty(properties, 'shopify.fulfillment.tracking_urls', asStringArray(fulfillment.tracking_urls));
  addFirstStringProperty(properties, 'shopify.created_at', fulfillment.created_at, fulfillment.createdAt);
  addFirstStringProperty(properties, 'shopify.updated_at', fulfillment.updated_at, fulfillment.updatedAt);
  addStringProperty(properties, 'shopify.delivered_at', fulfillment.delivered_at);
  addStringProperty(properties, 'shopify.estimated_delivery_at', fulfillment.estimated_delivery_at);
  addStringProperty(properties, 'shopify.location_id', stringifyId(fulfillment.location_id));

  const orderId = stringifyId(fulfillment.order_id) ?? asString(payload.orderId);
  if (orderId) {
    relations.add(shopifyOrderPath(orderId));
    addStringProperty(properties, 'shopify.order_id', orderId);
  }

  const lineItems = Array.isArray(fulfillment.line_items) ? fulfillment.line_items : [];
  if (lineItems.length > 0) {
    properties['shopify.fulfillment.line_item_count'] = String(lineItems.length);
  }
}

type ShopifyFulfillmentWithAliases = ShopifyFulfillment & {
  createdAt?: string;
  updatedAt?: string;
};

function getPrimaryPayload(event: ShopifyWebhookPayload): ShopifyRecord {
  const data = getRecord(event.data);
  if (data) return data;
  const payload = getRecord(event.payload);
  if (payload) return payload;
  return event as ShopifyRecord;
}

function mergeShopifyPayload(
  event: ShopifyWebhookPayload,
  payload: ShopifyRecord,
  objectType: string,
  objectId: string,
  action: string,
): ShopifyRecord {
  const metadata = getRecord(event.metadata);
  const connection = getRecord(event._connection);
  const webhook = getRecord(event._webhook);
  const merged: ShopifyRecord = { ...payload };
  const shopDomain = asString(event.shopDomain) ?? asString(event.shop_domain) ?? asString(metadata?.shopDomain);
  if (shopDomain) {
    merged.shop_domain = shopDomain;
  }
  merged._connection = compactRecord({
    ...connection,
    connectionId: asString(connection?.connectionId),
    provider: SHOPIFY_PROVIDER_NAME,
    providerConfigKey: asString(connection?.providerConfigKey),
    shopDomain,
  });
  merged._webhook = compactRecord({
    ...webhook,
    action,
    eventType: `${objectType}.${action}`,
    objectId,
    objectType,
    shopDomain,
    topic: asString(event.topic),
    webhookId: asString(event.webhookId) ?? asString(event.webhook_id),
  });
  return merged;
}

function readDisplayName(objectType: string, payload: Record<string, unknown>): string | undefined {
  const normalizedType = normalizeShopifyObjectType(objectType);
  switch (normalizedType) {
    case 'order':
      return asString(payload.name) ?? asString(payload.order_number);
    case 'product':
      return asString(payload.title) ?? asString(payload.handle);
    case 'customer':
      return customerDisplayName(payload as Partial<ShopifyCustomerReference>);
    case 'fulfillment':
      return asString(payload.name) ?? asString(payload.tracking_number);
  }
}

function inferFallbackPath(event: NormalizedWebhook | ShopifyWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeShopifyPath(event.objectType, event.objectId, readDisplayName(event.objectType, event.payload));
    }
    const payload = getPrimaryPayload(event);
    const objectType = asString(event.objectType) ?? asString(event.type) ?? objectTypeFromTopic(asString(event.topic)) ?? inferObjectType(payload);
    const objectId = asString(event.objectId) ?? readObjectId(payload) ?? 'unknown';
    return computeShopifyPath(objectType, objectId, readDisplayName(objectType, payload));
  } catch {
    return '/shopify/unknown.json';
  }
}

function inferWriteCounts(result: WriteFileResult | void, deleted: boolean): Pick<IngestResult, 'filesDeleted' | 'filesUpdated' | 'filesWritten'> {
  if (deleted) {
    return {
      filesDeleted: 1,
      filesUpdated: 0,
      filesWritten: 0,
    };
  }
  if (result?.updated || result?.status === 'updated') {
    return {
      filesDeleted: 0,
      filesUpdated: 1,
      filesWritten: 0,
    };
  }
  return {
    filesDeleted: 0,
    filesUpdated: 0,
    filesWritten: 1,
  };
}

function addAddressProperties(
  properties: Record<string, string>,
  prefix: string,
  address: ShopifyAddress,
): void {
  addStringProperty(properties, `${prefix}.name`, address.name);
  addStringProperty(properties, `${prefix}.company`, address.company);
  addStringProperty(properties, `${prefix}.city`, address.city);
  addStringProperty(properties, `${prefix}.province`, address.province);
  addStringProperty(properties, `${prefix}.province_code`, address.province_code);
  addStringProperty(properties, `${prefix}.country`, address.country);
  addStringProperty(properties, `${prefix}.country_code`, address.country_code);
  addStringProperty(properties, `${prefix}.zip`, address.zip);
  addStringProperty(properties, `${prefix}.phone`, address.phone);
}

function addStringProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  const normalized = asString(value);
  if (normalized) {
    properties[key] = normalized;
  }
}

function addFirstStringProperty(
  properties: Record<string, string>,
  key: string,
  ...values: unknown[]
): void {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      properties[key] = normalized;
      return;
    }
  }
}

function addBooleanProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  if (typeof value === 'boolean') {
    properties[key] = String(value);
  }
}

function addNumberProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    properties[key] = String(value);
  }
}

function addStringListProperty(
  properties: Record<string, string>,
  key: string,
  values: string[],
): void {
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
  if (normalized.length > 0) {
    properties[key] = normalized.join(', ');
  }
}

function asLineItems(value: unknown): ShopifyLineItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => getRecord(entry))
    .filter((entry): entry is ShopifyRecord => entry !== undefined)
    .map((entry) => {
      const item: ShopifyLineItem = {};
      copyId(entry, item, 'id');
      copyId(entry, item, 'product_id');
      copyId(entry, item, 'variant_id');
      copyStringField(entry, item, 'admin_graphql_api_id');
      copyStringField(entry, item, 'fulfillment_status');
      copyStringField(entry, item, 'name');
      copyStringField(entry, item, 'price');
      copyStringField(entry, item, 'sku');
      copyStringField(entry, item, 'title');
      copyStringField(entry, item, 'total_discount');
      copyStringField(entry, item, 'vendor');
      copyNumberField(entry, item, 'quantity');
      copyBooleanField(entry, item, 'requires_shipping');
      return item;
    });
}

function asVariants(value: unknown): ShopifyVariant[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => getRecord(entry))
    .filter((entry): entry is ShopifyRecord => entry !== undefined)
    .map((entry) => {
      const variant: ShopifyVariant = {};
      copyId(entry, variant, 'id');
      copyId(entry, variant, 'inventory_item_id');
      copyStringField(entry, variant, 'admin_graphql_api_id');
      copyStringField(entry, variant, 'barcode');
      copyStringField(entry, variant, 'compare_at_price');
      copyStringField(entry, variant, 'price');
      copyStringField(entry, variant, 'sku');
      copyStringField(entry, variant, 'title');
      copyNumberField(entry, variant, 'inventory_quantity');
      copyBooleanField(entry, variant, 'taxable');
      return variant;
    });
}

function copyId(source: ShopifyRecord, target: object, key: string): void {
  const value = stringifyId(source[key]);
  if (value) {
    (target as Record<string, unknown>)[key] = value;
  }
}

function copyStringField(source: ShopifyRecord, target: object, key: string): void {
  const value = asString(source[key]);
  if (value) {
    (target as Record<string, unknown>)[key] = value;
  }
}

function copyNumberField(source: ShopifyRecord, target: object, key: string): void {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    (target as Record<string, unknown>)[key] = value;
  }
}

function copyBooleanField(source: ShopifyRecord, target: object, key: string): void {
  const value = source[key];
  if (typeof value === 'boolean') {
    (target as Record<string, unknown>)[key] = value;
  }
}

function customerDisplayName(customer: Partial<ShopifyCustomerReference> | undefined | null): string | undefined {
  if (!customer) {
    return undefined;
  }
  const first = asString(customer.first_name);
  const last = asString(customer.last_name);
  const fullName = [first, last].filter(Boolean).join(' ').trim();
  return fullName || asString(customer.email) || asString(customer.phone);
}

function readObjectId(payload: ShopifyRecord): string | undefined {
  return stringifyId(payload.id) ?? asString(payload.admin_graphql_api_id) ?? asString(payload.adminGraphqlApiId);
}

function inferObjectType(payload: ShopifyRecord): string {
  if ('line_items' in payload && ('total_price' in payload || 'order_number' in payload || 'financial_status' in payload)) {
    return 'order';
  }
  if ('variants' in payload || 'product_type' in payload || 'vendor' in payload) {
    return 'product';
  }
  if ('orders_count' in payload || 'total_spent' in payload || 'default_address' in payload) {
    return 'customer';
  }
  if ('tracking_number' in payload || 'shipment_status' in payload || 'order_id' in payload) {
    return 'fulfillment';
  }
  throw new Error('Unable to infer Shopify object type from webhook payload');
}

function objectTypeFromTopic(topic: string | undefined): string | undefined {
  if (!topic) {
    return undefined;
  }
  const [resource] = topic.toLowerCase().split('/');
  if (!resource) {
    return undefined;
  }
  switch (resource) {
    case 'orders':
      return 'order';
    case 'products':
      return 'product';
    case 'customers':
      return 'customer';
    case 'fulfillments':
      return 'fulfillment';
    default:
      return undefined;
  }
}

function actionFromTopic(topic: string | undefined): string | undefined {
  if (!topic) {
    return undefined;
  }
  const [, action] = topic.toLowerCase().split('/');
  return action ? normalizeAction(action) : undefined;
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  switch (normalized) {
    case 'created':
    case 'create':
      return 'create';
    case 'delete':
    case 'deleted':
    case 'redact':
      return 'delete';
    case 'fulfilled':
    case 'fulfill':
      return 'fulfill';
    case 'cancel':
    case 'cancelled':
    case 'canceled':
      return 'cancel';
    case 'paid':
      return 'paid';
    case 'edited':
    case 'partially_fulfilled':
    case 'updated':
    case 'update':
      return 'update';
    default:
      return normalized || 'update';
  }
}

function getWebhookAction(payload: Record<string, unknown>): string | undefined {
  const webhook = getRecord(payload._webhook);
  return normalizeOptionalAction(webhook?.action);
}

function getEventAction(eventType: string): string | undefined {
  const [, action] = eventType.split('.');
  return normalizeOptionalAction(action);
}

function normalizeOptionalAction(action: unknown): string | undefined {
  const value = asString(action);
  return value ? normalizeAction(value) : undefined;
}

function stringifyId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return asString(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== undefined);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNormalizedWebhook(event: unknown): event is NormalizedWebhook {
  const record = getRecord(event);
  return Boolean(
    record &&
      typeof record.provider === 'string' &&
      typeof record.eventType === 'string' &&
      typeof record.objectType === 'string' &&
      typeof record.objectId === 'string' &&
      isRecord(record.payload),
  );
}

function isRecord(value: unknown): value is ShopifyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getRecord(value: unknown): ShopifyRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function sortStrings(values: Set<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function compactSemantics(semantics: FileSemantics): FileSemantics {
  const compacted: FileSemantics = {};
  if (semantics.properties && Object.keys(semantics.properties).length > 0) {
    compacted.properties = semantics.properties;
  }
  if (semantics.relations && semantics.relations.length > 0) {
    compacted.relations = semantics.relations;
  }
  if (semantics.permissions && semantics.permissions.length > 0) {
    compacted.permissions = semantics.permissions;
  }
  if (semantics.comments && semantics.comments.length > 0) {
    compacted.comments = semantics.comments;
  }
  return compacted;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== null && value !== '') {
      output[key] = value;
    }
  }
  return output;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
