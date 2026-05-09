export const STRIPE_WEBHOOK_OBJECT_TYPES = [
  'customer',
  'invoice',
  'subscription',
  'charge',
  'payment_intent',
] as const;

export const STRIPE_EVENT_ACTIONS = [
  'created',
  'updated',
  'deleted',
  'succeeded',
  'failed',
  'finalized',
  'paid',
  'voided',
  'refunded',
  'canceled',
  'requires_action',
] as const;

export type StripeWebhookObjectType = (typeof STRIPE_WEBHOOK_OBJECT_TYPES)[number];
export type StripeEventAction = (typeof STRIPE_EVENT_ACTIONS)[number];

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface StripeAdapterConfig {
  apiUrl?: string;
  appName?: string;
  connectionId?: string;
  provider?: string;
  providerConfigKey?: string;
  webhookSecret?: string;
  webhookToleranceSeconds?: number;
}

export interface StripeWritebackRequest {
  action:
    | 'cancel_payment_intent'
    | 'cancel_subscription'
    | 'capture_payment_intent'
    | 'create_customer'
    | 'create_invoice'
    | 'finalize_invoice'
    | 'refund_charge'
    | 'update_customer'
    | 'update_invoice'
    | 'update_payment_intent'
    | 'update_subscription';
  method: 'POST';
  endpoint: string;
  body: Record<string, unknown>;
}

export interface StripeReadRequest {
  method: 'GET';
  endpoint: string;
  query?: Record<string, string>;
}

export interface StripeAddress {
  city?: string | null;
  country?: string | null;
  line1?: string | null;
  line2?: string | null;
  postal_code?: string | null;
  state?: string | null;
}

export interface StripeMetadata {
  [key: string]: string;
}

export interface StripeBillingDetails {
  address?: StripeAddress | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
}

export interface StripeCustomer {
  id: string;
  object: 'customer';
  address?: StripeAddress | null;
  balance?: number;
  created?: number;
  currency?: string | null;
  delinquent?: boolean | null;
  description?: string | null;
  email?: string | null;
  invoice_prefix?: string | null;
  livemode?: boolean;
  metadata?: StripeMetadata | null;
  name?: string | null;
  phone?: string | null;
  preferred_locales?: string[];
  shipping?: {
    address?: StripeAddress | null;
    name?: string | null;
    phone?: string | null;
  } | null;
  tax_exempt?: string | null;
}

export interface StripeInvoice {
  id: string;
  object: 'invoice';
  account_country?: string | null;
  account_name?: string | null;
  amount_due?: number;
  amount_paid?: number;
  amount_remaining?: number;
  billing_reason?: string | null;
  charge?: string | StripeCharge | null;
  collection_method?: string | null;
  created?: number;
  currency?: string;
  customer?: string | StripeCustomer | null;
  customer_email?: string | null;
  customer_name?: string | null;
  description?: string | null;
  due_date?: number | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  livemode?: boolean;
  metadata?: StripeMetadata | null;
  number?: string | null;
  paid?: boolean;
  payment_intent?: string | StripePaymentIntent | null;
  period_end?: number;
  period_start?: number;
  status?: string | null;
  subscription?: string | StripeSubscription | null;
  total?: number;
}

export interface StripeSubscription {
  id: string;
  object: 'subscription';
  cancel_at?: number | null;
  cancel_at_period_end?: boolean;
  canceled_at?: number | null;
  collection_method?: string;
  created?: number;
  currency?: string;
  current_period_end?: number;
  current_period_start?: number;
  customer?: string | StripeCustomer | null;
  description?: string | null;
  ended_at?: number | null;
  items?: {
    data?: Array<{
      id: string;
      price?: {
        id?: string;
        product?: string | null;
        unit_amount?: number | null;
      } | null;
      quantity?: number | null;
    }>;
  };
  livemode?: boolean;
  metadata?: StripeMetadata | null;
  status?: string;
  trial_end?: number | null;
  trial_start?: number | null;
}

export interface StripeCharge {
  id: string;
  object: 'charge';
  amount?: number;
  amount_captured?: number;
  amount_refunded?: number;
  balance_transaction?: string | null;
  billing_details?: StripeBillingDetails | null;
  captured?: boolean;
  created?: number;
  currency?: string;
  customer?: string | StripeCustomer | null;
  description?: string | null;
  disputed?: boolean;
  failure_code?: string | null;
  failure_message?: string | null;
  livemode?: boolean;
  metadata?: StripeMetadata | null;
  paid?: boolean;
  payment_intent?: string | StripePaymentIntent | null;
  receipt_url?: string | null;
  refunded?: boolean;
  status?: string;
}

export interface StripePaymentIntent {
  id: string;
  object: 'payment_intent';
  amount?: number;
  amount_capturable?: number;
  amount_received?: number;
  cancellation_reason?: string | null;
  canceled_at?: number | null;
  capture_method?: string;
  charges?: {
    data?: StripeCharge[];
  };
  client_secret?: string;
  confirmation_method?: string;
  created?: number;
  currency?: string;
  customer?: string | StripeCustomer | null;
  description?: string | null;
  invoice?: string | StripeInvoice | null;
  latest_charge?: string | StripeCharge | null;
  livemode?: boolean;
  metadata?: StripeMetadata | null;
  receipt_email?: string | null;
  status?: string;
}

export type StripePrimaryObject =
  | StripeCharge
  | StripeCustomer
  | StripeInvoice
  | StripePaymentIntent
  | StripeSubscription;

export interface StripeWebhookPayload<TObject extends StripePrimaryObject = StripePrimaryObject> {
  id: string;
  object: 'event';
  account?: string;
  api_version?: string;
  created: number;
  data: {
    object: TObject;
    previous_attributes?: Record<string, unknown>;
  };
  livemode: boolean;
  pending_webhooks?: number;
  request?: {
    id?: string | null;
    idempotency_key?: string | null;
  } | null;
  type: string;
}
