import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import {
  computeStripePath,
  normalizeStripeObjectType,
  stripeChargePath,
  stripeCustomerPath,
  stripeInvoicePath,
  stripePaymentIntentPath,
  stripeSubscriptionPath,
} from './path-mapper.js';
import { STRIPE_WEBHOOK_OBJECT_TYPES } from './types.js';
import type {
  StripeAdapterConfig,
  StripeCharge,
  StripeCustomer,
  StripeInvoice,
  StripePaymentIntent,
  StripePrimaryObject,
  StripeSubscription,
  StripeWebhookPayload,
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

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook | StripeWebhookPayload): Promise<IngestResult>;

  abstract computePath(objectType: string, objectId: string): string;

  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>
  ): FileSemantics;

  supportedEvents?(): string[];
}

type StripeRecord = Record<string, unknown>;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const STRIPE_PROVIDER_NAME = 'stripe';

const SUPPORTED_EVENTS = [
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'invoice.created',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.updated',
  'invoice.voided',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',
  'charge.updated',
  'payment_intent.created',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'payment_intent.requires_action',
] as const;

export class StripeAdapter extends IntegrationAdapter {
  override readonly name = STRIPE_PROVIDER_NAME;
  override readonly version = '0.1.0';

  readonly config: StripeAdapterConfig;

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    config: StripeAdapterConfig = {},
  ) {
    super(client, provider);
    this.config = config;
  }

  override supportedEvents(): string[] {
    return [...SUPPORTED_EVENTS];
  }

  override async ingestWebhook(
    workspaceId: string,
    event: NormalizedWebhook | StripeWebhookPayload,
  ): Promise<IngestResult> {
    try {
      const normalized = this.normalizeEvent(event);
      const path = computeStripePath(normalized.objectType, normalized.objectId);

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

        const deleteWriteResult = await this.client.writeFile({
          workspaceId,
          path,
          content: this.renderContent(workspaceId, normalized, true),
          contentType: JSON_CONTENT_TYPE,
          semantics: this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload),
        });

        const counts = inferWriteCounts(deleteWriteResult, true);
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
        semantics: this.computeSemantics(normalized.objectType, normalized.objectId, normalized.payload),
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

  override computePath(objectType: string, objectId: string): string {
    return computeStripePath(objectType, objectId);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const normalizedType = normalizeStripeObjectType(objectType);
    const properties: Record<string, string> = {
      provider: STRIPE_PROVIDER_NAME,
      'provider.object_id': objectId,
      'provider.object_type': normalizedType,
      'stripe.id': objectId,
      'stripe.object_type': normalizedType,
    };
    const relations = new Set<string>();
    const comments: string[] = [];

    addEventSemantics(properties, payload);
    addMetadataProperties(properties, payload.metadata, `stripe.${normalizedType}.metadata`);

    switch (normalizedType) {
      case 'customer':
        applyCustomerSemantics(properties, comments, payload as Partial<StripeCustomer> & StripeRecord);
        break;
      case 'invoice':
        applyInvoiceSemantics(properties, relations, comments, payload as Partial<StripeInvoice> & StripeRecord);
        break;
      case 'subscription':
        applySubscriptionSemantics(properties, relations, payload as Partial<StripeSubscription> & StripeRecord);
        break;
      case 'charge':
        applyChargeSemantics(properties, relations, comments, payload as Partial<StripeCharge> & StripeRecord);
        break;
      case 'payment_intent':
        applyPaymentIntentSemantics(properties, relations, comments, payload as Partial<StripePaymentIntent> & StripeRecord);
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

  private normalizeEvent(event: NormalizedWebhook | StripeWebhookPayload): NormalizedWebhook {
    if (isNormalizedWebhook(event)) {
      const normalized: NormalizedWebhook = {
        provider: event.provider || this.config.provider || STRIPE_PROVIDER_NAME,
        eventType: event.eventType,
        objectType: normalizeStripeObjectType(event.objectType),
        objectId: event.objectId.trim(),
        payload: event.payload,
      };
      const connectionId = event.connectionId || this.config.connectionId;
      if (connectionId) {
        normalized.connectionId = connectionId;
      }
      return normalized;
    }

    const object = event.data.object;
    const objectType = normalizeStripeObjectType(object.object);
    const payload = mergeStripePayload(event, object);
    const normalized: NormalizedWebhook = {
      provider: this.config.provider || STRIPE_PROVIDER_NAME,
      eventType: event.type,
      objectType,
      objectId: object.id,
      payload,
    };
    if (this.config.connectionId) {
      normalized.connectionId = this.config.connectionId;
    }
    return normalized;
  }

  private isDeleteEvent(event: NormalizedWebhook): boolean {
    const action = getEventAction(event.eventType);
    const deleted = asBoolean(event.payload.deleted);
    return action === 'deleted' || deleted === true;
  }

  private renderContent(workspaceId: string, event: NormalizedWebhook, deleted: boolean): string {
    return stableJson({
      provider: event.provider,
      connectionId: event.connectionId ?? null,
      workspaceId,
      eventType: event.eventType,
      objectType: normalizeStripeObjectType(event.objectType),
      objectId: event.objectId,
      deleted,
      payload: event.payload,
    });
  }
}

function mergeStripePayload(
  event: StripeWebhookPayload,
  object: StripePrimaryObject,
): StripeRecord {
  return compactObject({
    ...object,
    _stripe_event: compactObject({
      account: event.account,
      apiVersion: event.api_version,
      created: event.created,
      eventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      pendingWebhooks: event.pending_webhooks,
      previousAttributes: event.data.previous_attributes,
      requestId: event.request?.id,
      requestIdempotencyKey: event.request?.idempotency_key,
    }),
  });
}

function addEventSemantics(properties: Record<string, string>, payload: StripeRecord): void {
  const event = getRecord(payload._stripe_event);
  if (!event) {
    return;
  }
  addStringProperty(properties, 'stripe.event.id', event.eventId);
  addStringProperty(properties, 'stripe.event.type', event.eventType);
  addNumberProperty(properties, 'stripe.event.created', event.created);
  addBooleanProperty(properties, 'stripe.event.livemode', event.livemode);
  addStringProperty(properties, 'stripe.event.api_version', event.apiVersion);
  addStringProperty(properties, 'stripe.event.account', event.account);
  addStringProperty(properties, 'stripe.event.request_id', event.requestId);
  addStringProperty(properties, 'stripe.event.request_idempotency_key', event.requestIdempotencyKey);
  addNumberProperty(properties, 'stripe.event.pending_webhooks', event.pendingWebhooks);
}

function applyCustomerSemantics(
  properties: Record<string, string>,
  comments: string[],
  customer: Partial<StripeCustomer> & StripeRecord,
): void {
  addStringProperty(properties, 'stripe.customer.email', customer.email);
  addStringProperty(properties, 'stripe.customer.name', customer.name);
  addStringProperty(properties, 'stripe.customer.phone', customer.phone);
  addStringProperty(properties, 'stripe.customer.description', customer.description);
  addStringProperty(properties, 'stripe.customer.currency', customer.currency);
  addStringProperty(properties, 'stripe.customer.invoice_prefix', customer.invoice_prefix);
  addStringProperty(properties, 'stripe.customer.tax_exempt', customer.tax_exempt);
  addNumberProperty(properties, 'stripe.customer.created', customer.created);
  addNumberProperty(properties, 'stripe.customer.balance', customer.balance);
  addBooleanProperty(properties, 'stripe.customer.delinquent', customer.delinquent);
  addBooleanProperty(properties, 'stripe.customer.livemode', customer.livemode);

  if (Array.isArray(customer.preferred_locales) && customer.preferred_locales.length > 0) {
    properties['stripe.customer.preferred_locales'] = customer.preferred_locales.join(', ');
  }

  applyAddressSemantics(properties, 'stripe.customer.address', getRecord(customer.address));
  const shipping = getRecord(customer.shipping);
  if (shipping) {
    addStringProperty(properties, 'stripe.customer.shipping_name', shipping.name);
    addStringProperty(properties, 'stripe.customer.shipping_phone', shipping.phone);
    applyAddressSemantics(properties, 'stripe.customer.shipping_address', getRecord(shipping.address));
  }

  const description = asString(customer.description);
  if (description) {
    comments.push(description);
  }
}

function applyInvoiceSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  invoice: Partial<StripeInvoice> & StripeRecord,
): void {
  addStringProperty(properties, 'stripe.invoice.number', invoice.number);
  addStringProperty(properties, 'stripe.invoice.status', invoice.status);
  addStringProperty(properties, 'stripe.invoice.currency', invoice.currency);
  addStringProperty(properties, 'stripe.invoice.billing_reason', invoice.billing_reason);
  addStringProperty(properties, 'stripe.invoice.collection_method', invoice.collection_method);
  addStringProperty(properties, 'stripe.invoice.customer_email', invoice.customer_email);
  addStringProperty(properties, 'stripe.invoice.customer_name', invoice.customer_name);
  addStringProperty(properties, 'stripe.invoice.description', invoice.description);
  addStringProperty(properties, 'stripe.invoice.hosted_invoice_url', invoice.hosted_invoice_url);
  addStringProperty(properties, 'stripe.invoice.invoice_pdf', invoice.invoice_pdf);
  addNumberProperty(properties, 'stripe.invoice.amount_due', invoice.amount_due);
  addNumberProperty(properties, 'stripe.invoice.amount_paid', invoice.amount_paid);
  addNumberProperty(properties, 'stripe.invoice.amount_remaining', invoice.amount_remaining);
  addNumberProperty(properties, 'stripe.invoice.created', invoice.created);
  addNumberProperty(properties, 'stripe.invoice.due_date', invoice.due_date);
  addNumberProperty(properties, 'stripe.invoice.period_start', invoice.period_start);
  addNumberProperty(properties, 'stripe.invoice.period_end', invoice.period_end);
  addNumberProperty(properties, 'stripe.invoice.total', invoice.total);
  addBooleanProperty(properties, 'stripe.invoice.paid', invoice.paid);
  addBooleanProperty(properties, 'stripe.invoice.livemode', invoice.livemode);

  const customerId = readStripeReferenceId(invoice.customer);
  if (customerId) {
    relations.add(stripeCustomerPath(customerId));
    properties['stripe.invoice.customer_id'] = customerId;
  }

  const subscriptionId = readStripeReferenceId(invoice.subscription);
  if (subscriptionId) {
    relations.add(stripeSubscriptionPath(subscriptionId));
    properties['stripe.invoice.subscription_id'] = subscriptionId;
  }

  const chargeId = readStripeReferenceId(invoice.charge);
  if (chargeId) {
    relations.add(stripeChargePath(chargeId));
    properties['stripe.invoice.charge_id'] = chargeId;
  }

  const paymentIntentId = readStripeReferenceId(invoice.payment_intent);
  if (paymentIntentId) {
    relations.add(stripePaymentIntentPath(paymentIntentId));
    properties['stripe.invoice.payment_intent_id'] = paymentIntentId;
  }

  const description = asString(invoice.description);
  if (description) {
    comments.push(description);
  }
}

function applySubscriptionSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  subscription: Partial<StripeSubscription> & StripeRecord,
): void {
  addStringProperty(properties, 'stripe.subscription.status', subscription.status);
  addStringProperty(properties, 'stripe.subscription.currency', subscription.currency);
  addStringProperty(properties, 'stripe.subscription.collection_method', subscription.collection_method);
  addStringProperty(properties, 'stripe.subscription.description', subscription.description);
  addNumberProperty(properties, 'stripe.subscription.created', subscription.created);
  addNumberProperty(properties, 'stripe.subscription.current_period_start', subscription.current_period_start);
  addNumberProperty(properties, 'stripe.subscription.current_period_end', subscription.current_period_end);
  addNumberProperty(properties, 'stripe.subscription.cancel_at', subscription.cancel_at);
  addNumberProperty(properties, 'stripe.subscription.canceled_at', subscription.canceled_at);
  addNumberProperty(properties, 'stripe.subscription.ended_at', subscription.ended_at);
  addNumberProperty(properties, 'stripe.subscription.trial_start', subscription.trial_start);
  addNumberProperty(properties, 'stripe.subscription.trial_end', subscription.trial_end);
  addBooleanProperty(properties, 'stripe.subscription.cancel_at_period_end', subscription.cancel_at_period_end);
  addBooleanProperty(properties, 'stripe.subscription.livemode', subscription.livemode);

  const customerId = readStripeReferenceId(subscription.customer);
  if (customerId) {
    relations.add(stripeCustomerPath(customerId));
    properties['stripe.subscription.customer_id'] = customerId;
  }

  const items = getRecord(subscription.items);
  const itemData = Array.isArray(items?.data) ? items.data : [];
  if (itemData.length > 0) {
    properties['stripe.subscription.item_count'] = String(itemData.length);
    const productIds = itemData
      .map((item) => getRecord(item))
      .map((item) => getRecord(item?.price))
      .map((price) => asString(price?.product))
      .filter(isNonEmptyString)
      .sort((left, right) => left.localeCompare(right));
    if (productIds.length > 0) {
      properties['stripe.subscription.product_ids'] = productIds.join(', ');
    }
  }
}

function applyChargeSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  charge: Partial<StripeCharge> & StripeRecord,
): void {
  addStringProperty(properties, 'stripe.charge.status', charge.status);
  addStringProperty(properties, 'stripe.charge.currency', charge.currency);
  addStringProperty(properties, 'stripe.charge.description', charge.description);
  addStringProperty(properties, 'stripe.charge.failure_code', charge.failure_code);
  addStringProperty(properties, 'stripe.charge.failure_message', charge.failure_message);
  addStringProperty(properties, 'stripe.charge.receipt_url', charge.receipt_url);
  addStringProperty(properties, 'stripe.charge.balance_transaction', charge.balance_transaction);
  addNumberProperty(properties, 'stripe.charge.amount', charge.amount);
  addNumberProperty(properties, 'stripe.charge.amount_captured', charge.amount_captured);
  addNumberProperty(properties, 'stripe.charge.amount_refunded', charge.amount_refunded);
  addNumberProperty(properties, 'stripe.charge.created', charge.created);
  addBooleanProperty(properties, 'stripe.charge.captured', charge.captured);
  addBooleanProperty(properties, 'stripe.charge.disputed', charge.disputed);
  addBooleanProperty(properties, 'stripe.charge.livemode', charge.livemode);
  addBooleanProperty(properties, 'stripe.charge.paid', charge.paid);
  addBooleanProperty(properties, 'stripe.charge.refunded', charge.refunded);

  const customerId = readStripeReferenceId(charge.customer);
  if (customerId) {
    relations.add(stripeCustomerPath(customerId));
    properties['stripe.charge.customer_id'] = customerId;
  }

  const paymentIntentId = readStripeReferenceId(charge.payment_intent);
  if (paymentIntentId) {
    relations.add(stripePaymentIntentPath(paymentIntentId));
    properties['stripe.charge.payment_intent_id'] = paymentIntentId;
  }

  const billing = getRecord(charge.billing_details);
  if (billing) {
    addStringProperty(properties, 'stripe.charge.billing_name', billing.name);
    addStringProperty(properties, 'stripe.charge.billing_email', billing.email);
    addStringProperty(properties, 'stripe.charge.billing_phone', billing.phone);
    applyAddressSemantics(properties, 'stripe.charge.billing_address', getRecord(billing.address));
  }

  const failureMessage = asString(charge.failure_message);
  if (failureMessage) {
    comments.push(failureMessage);
  }
}

function applyPaymentIntentSemantics(
  properties: Record<string, string>,
  relations: Set<string>,
  comments: string[],
  paymentIntent: Partial<StripePaymentIntent> & StripeRecord,
): void {
  addStringProperty(properties, 'stripe.payment_intent.status', paymentIntent.status);
  addStringProperty(properties, 'stripe.payment_intent.currency', paymentIntent.currency);
  addStringProperty(properties, 'stripe.payment_intent.description', paymentIntent.description);
  addStringProperty(properties, 'stripe.payment_intent.receipt_email', paymentIntent.receipt_email);
  addStringProperty(properties, 'stripe.payment_intent.capture_method', paymentIntent.capture_method);
  addStringProperty(properties, 'stripe.payment_intent.confirmation_method', paymentIntent.confirmation_method);
  addStringProperty(properties, 'stripe.payment_intent.cancellation_reason', paymentIntent.cancellation_reason);
  addNumberProperty(properties, 'stripe.payment_intent.amount', paymentIntent.amount);
  addNumberProperty(properties, 'stripe.payment_intent.amount_capturable', paymentIntent.amount_capturable);
  addNumberProperty(properties, 'stripe.payment_intent.amount_received', paymentIntent.amount_received);
  addNumberProperty(properties, 'stripe.payment_intent.canceled_at', paymentIntent.canceled_at);
  addNumberProperty(properties, 'stripe.payment_intent.created', paymentIntent.created);
  addBooleanProperty(properties, 'stripe.payment_intent.livemode', paymentIntent.livemode);

  const customerId = readStripeReferenceId(paymentIntent.customer);
  if (customerId) {
    relations.add(stripeCustomerPath(customerId));
    properties['stripe.payment_intent.customer_id'] = customerId;
  }

  const invoiceId = readStripeReferenceId(paymentIntent.invoice);
  if (invoiceId) {
    relations.add(stripeInvoicePath(invoiceId));
    properties['stripe.payment_intent.invoice_id'] = invoiceId;
  }

  const latestChargeId = readStripeReferenceId(paymentIntent.latest_charge);
  if (latestChargeId) {
    relations.add(stripeChargePath(latestChargeId));
    properties['stripe.payment_intent.latest_charge_id'] = latestChargeId;
  }

  const charges = getRecord(paymentIntent.charges);
  const chargeData = Array.isArray(charges?.data) ? charges.data : [];
  for (const charge of chargeData) {
    const record = getRecord(charge);
    const chargeId = asString(record?.id);
    if (chargeId) {
      relations.add(stripeChargePath(chargeId));
    }
  }

  const description = asString(paymentIntent.description);
  if (description) {
    comments.push(description);
  }
}

function applyAddressSemantics(
  properties: Record<string, string>,
  prefix: string,
  address: StripeRecord | undefined,
): void {
  if (!address) {
    return;
  }
  addStringProperty(properties, `${prefix}.line1`, address.line1);
  addStringProperty(properties, `${prefix}.line2`, address.line2);
  addStringProperty(properties, `${prefix}.city`, address.city);
  addStringProperty(properties, `${prefix}.state`, address.state);
  addStringProperty(properties, `${prefix}.postal_code`, address.postal_code);
  addStringProperty(properties, `${prefix}.country`, address.country);
}

function addMetadataProperties(
  properties: Record<string, string>,
  metadata: unknown,
  prefix: string,
): void {
  const record = getRecord(metadata);
  if (!record) {
    return;
  }
  const entries = Object.entries(record)
    .map(([key, value]) => [key, asString(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  if (entries.length === 0) {
    return;
  }
  properties[`${prefix}.keys`] = entries.map(([key]) => key).sort().join(', ');
  for (const [key, value] of entries) {
    const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
    properties[`${prefix}.${safeKey}`] = value;
  }
}

function readStripeReferenceId(value: unknown): string | undefined {
  const direct = asString(value);
  if (direct) {
    return direct;
  }
  const record = getRecord(value);
  return asString(record?.id);
}

function inferFallbackPath(event: NormalizedWebhook | StripeWebhookPayload): string {
  try {
    if (isNormalizedWebhook(event)) {
      return computeStripePath(event.objectType, event.objectId);
    }
    return computeStripePath(event.data.object.object, event.data.object.id);
  } catch {
    return '/stripe/webhook-error.json';
  }
}

function inferWriteCounts(
  result: WriteFileResult | void,
  deleted: boolean,
): { filesDeleted: number; filesUpdated: number; filesWritten: number } {
  if (deleted) {
    return { filesDeleted: 1, filesUpdated: 0, filesWritten: 0 };
  }
  if (result?.created || result?.status === 'created') {
    return { filesDeleted: 0, filesUpdated: 0, filesWritten: 1 };
  }
  if (result?.updated || result?.status === 'updated') {
    return { filesDeleted: 0, filesUpdated: 1, filesWritten: 0 };
  }
  return { filesDeleted: 0, filesUpdated: 1, filesWritten: 0 };
}

function getEventAction(eventType: string): string {
  const parts = eventType.trim().toLowerCase().split('.');
  return parts[parts.length - 1] ?? eventType;
}

function isNormalizedWebhook(event: unknown): event is NormalizedWebhook {
  const record = getRecord(event);
  return Boolean(
    record &&
      typeof record.eventType === 'string' &&
      typeof record.objectType === 'string' &&
      typeof record.objectId === 'string' &&
      getRecord(record.payload),
  );
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

function compactObject(input: Record<string, unknown>): StripeRecord {
  const output: StripeRecord = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
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
    return value.map(sortJson);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const output: StripeRecord = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = sortJson(value[key]);
  }
  return output;
}

function addStringProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  const stringValue = asString(value);
  if (stringValue) {
    properties[key] = stringValue;
  }
}

function addNumberProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  const numberValue = asNumber(value);
  if (numberValue !== undefined) {
    properties[key] = String(numberValue);
  }
}

function addBooleanProperty(
  properties: Record<string, string>,
  key: string,
  value: unknown,
): void {
  const booleanValue = asBoolean(value);
  if (booleanValue !== undefined) {
    properties[key] = String(booleanValue);
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function getRecord(value: unknown): StripeRecord | undefined {
  if (isPlainObject(value)) {
    return value;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is StripeRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sortStrings(values: Set<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { STRIPE_WEBHOOK_OBJECT_TYPES };
