import type { StripeWritebackRequest } from './types.js';

export function resolveWritebackRequest(path: string, content: string): StripeWritebackRequest {
  const payload = parseJsonObject(content);

  if (path === '/stripe/customers/new.json') {
    return {
      action: 'create_customer',
      method: 'POST',
      endpoint: '/v1/customers',
      body: pickDefined(payload, CUSTOMER_WRITE_KEYS),
    };
  }

  if (path === '/stripe/invoices/new.json') {
    return {
      action: 'create_invoice',
      method: 'POST',
      endpoint: '/v1/invoices',
      body: pickDefined(payload, INVOICE_WRITE_KEYS),
    };
  }

  const finalizeInvoice = path.match(/^\/stripe\/invoices\/([^/]+)\/finalize\.json$/u);
  if (finalizeInvoice?.[1]) {
    return {
      action: 'finalize_invoice',
      method: 'POST',
      endpoint: `/v1/invoices/${decodeURIComponent(finalizeInvoice[1])}/finalize`,
      body: pickDefined(payload, ['auto_advance']),
    };
  }

  const updateCustomer = path.match(/^\/stripe\/customers\/([^/]+)\.json$/u);
  if (updateCustomer?.[1]) {
    return {
      action: 'update_customer',
      method: 'POST',
      endpoint: `/v1/customers/${decodeURIComponent(updateCustomer[1])}`,
      body: pickDefined(payload, CUSTOMER_WRITE_KEYS),
    };
  }

  const updateInvoice = path.match(/^\/stripe\/invoices\/([^/]+)\.json$/u);
  if (updateInvoice?.[1]) {
    return {
      action: 'update_invoice',
      method: 'POST',
      endpoint: `/v1/invoices/${decodeURIComponent(updateInvoice[1])}`,
      body: pickDefined(payload, INVOICE_WRITE_KEYS),
    };
  }

  const cancelSubscription = path.match(/^\/stripe\/subscriptions\/([^/]+)\/cancel\.json$/u);
  if (cancelSubscription?.[1]) {
    return {
      action: 'cancel_subscription',
      method: 'POST',
      endpoint: `/v1/subscriptions/${decodeURIComponent(cancelSubscription[1])}/cancel`,
      body: pickDefined(payload, ['cancellation_details', 'invoice_now', 'prorate']),
    };
  }

  const updateSubscription = path.match(/^\/stripe\/subscriptions\/([^/]+)\.json$/u);
  if (updateSubscription?.[1]) {
    return {
      action: 'update_subscription',
      method: 'POST',
      endpoint: `/v1/subscriptions/${decodeURIComponent(updateSubscription[1])}`,
      body: pickDefined(payload, SUBSCRIPTION_WRITE_KEYS),
    };
  }

  const refundCharge = path.match(/^\/stripe\/charges\/([^/]+)\/refund\.json$/u);
  if (refundCharge?.[1]) {
    return {
      action: 'refund_charge',
      method: 'POST',
      endpoint: '/v1/refunds',
      body: {
        ...pickDefined(payload, ['amount', 'metadata', 'reason']),
        charge: decodeURIComponent(refundCharge[1]),
      },
    };
  }

  const updatePaymentIntent = path.match(/^\/stripe\/payment-intents\/([^/]+)\.json$/u);
  if (updatePaymentIntent?.[1]) {
    return {
      action: 'update_payment_intent',
      method: 'POST',
      endpoint: `/v1/payment_intents/${decodeURIComponent(updatePaymentIntent[1])}`,
      body: pickDefined(payload, PAYMENT_INTENT_WRITE_KEYS),
    };
  }

  const capturePaymentIntent = path.match(/^\/stripe\/payment-intents\/([^/]+)\/capture\.json$/u);
  if (capturePaymentIntent?.[1]) {
    return {
      action: 'capture_payment_intent',
      method: 'POST',
      endpoint: `/v1/payment_intents/${decodeURIComponent(capturePaymentIntent[1])}/capture`,
      body: pickDefined(payload, ['amount_to_capture', 'application_fee_amount', 'final_capture', 'metadata', 'statement_descriptor']),
    };
  }

  const cancelPaymentIntent = path.match(/^\/stripe\/payment-intents\/([^/]+)\/cancel\.json$/u);
  if (cancelPaymentIntent?.[1]) {
    return {
      action: 'cancel_payment_intent',
      method: 'POST',
      endpoint: `/v1/payment_intents/${decodeURIComponent(cancelPaymentIntent[1])}/cancel`,
      body: pickDefined(payload, ['cancellation_reason']),
    };
  }

  throw new Error(`No Stripe writeback rule matched ${path}`);
}

const CUSTOMER_WRITE_KEYS = [
  'address',
  'balance',
  'coupon',
  'description',
  'email',
  'invoice_prefix',
  'metadata',
  'name',
  'phone',
  'preferred_locales',
  'shipping',
  'source',
  'tax',
  'tax_exempt',
] as const;

const INVOICE_WRITE_KEYS = [
  'auto_advance',
  'collection_method',
  'customer',
  'days_until_due',
  'default_payment_method',
  'description',
  'due_date',
  'footer',
  'metadata',
  'subscription',
] as const;

const SUBSCRIPTION_WRITE_KEYS = [
  'billing_cycle_anchor',
  'cancel_at',
  'cancel_at_period_end',
  'collection_method',
  'coupon',
  'days_until_due',
  'default_payment_method',
  'description',
  'items',
  'metadata',
  'pause_collection',
  'proration_behavior',
  'trial_end',
] as const;

const PAYMENT_INTENT_WRITE_KEYS = [
  'amount',
  'currency',
  'customer',
  'description',
  'metadata',
  'payment_method',
  'receipt_email',
  'setup_future_usage',
  'statement_descriptor',
  'statement_descriptor_suffix',
] as const;

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Stripe writeback content must be a JSON object');
  }
  return parsed;
}

function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Stripe writeback content is not valid JSON: ${toErrorMessage(error)}`);
  }
}

function pickDefined(
  payload: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (payload[key] !== undefined) {
      output[key] = payload[key];
    }
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
