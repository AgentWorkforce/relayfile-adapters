export const STRIPE_PATH_ROOT = '/stripe';

export const STRIPE_OBJECT_TYPES = [
  'customer',
  'invoice',
  'subscription',
  'charge',
  'payment_intent',
] as const;

export type StripePathObjectType = (typeof STRIPE_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, StripePathObjectType>> = {
  charge: 'charge',
  charges: 'charge',
  stripecharge: 'charge',
  customer: 'customer',
  customers: 'customer',
  stripecustomer: 'customer',
  invoice: 'invoice',
  invoices: 'invoice',
  stripeinvoice: 'invoice',
  paymentintent: 'payment_intent',
  paymentintents: 'payment_intent',
  payment_intent: 'payment_intent',
  payment_intents: 'payment_intent',
  paymentintentcreated: 'payment_intent',
  paymentintentupdated: 'payment_intent',
  stripepaymentintent: 'payment_intent',
  subscription: 'subscription',
  subscriptions: 'subscription',
  stripesubscription: 'subscription',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Stripe ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeStripePathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function normalizeStripeObjectType(objectType: string): StripePathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[-.\s]/g, '_');
  const compact = normalized.replace(/_/g, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized] ?? OBJECT_TYPE_ALIASES[compact];
  if (!mapped) {
    throw new Error(`Unsupported Stripe object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeStripeObjectType(objectType: string): StripePathObjectType | undefined {
  try {
    return normalizeStripeObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function stripeCustomerPath(customerId: string): string {
  return `${STRIPE_PATH_ROOT}/customers/${encodeStripePathSegment(customerId)}.json`;
}

export function stripeInvoicePath(invoiceId: string): string {
  return `${STRIPE_PATH_ROOT}/invoices/${encodeStripePathSegment(invoiceId)}.json`;
}

export function stripeSubscriptionPath(subscriptionId: string): string {
  return `${STRIPE_PATH_ROOT}/subscriptions/${encodeStripePathSegment(subscriptionId)}.json`;
}

export function stripeChargePath(chargeId: string): string {
  return `${STRIPE_PATH_ROOT}/charges/${encodeStripePathSegment(chargeId)}.json`;
}

export function stripePaymentIntentPath(paymentIntentId: string): string {
  return `${STRIPE_PATH_ROOT}/payment-intents/${encodeStripePathSegment(paymentIntentId)}.json`;
}

export function computeStripePath(objectType: string, objectId: string): string {
  const normalizedType = normalizeStripeObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'customer':
      return stripeCustomerPath(normalizedId);
    case 'invoice':
      return stripeInvoicePath(normalizedId);
    case 'subscription':
      return stripeSubscriptionPath(normalizedId);
    case 'charge':
      return stripeChargePath(normalizedId);
    case 'payment_intent':
      return stripePaymentIntentPath(normalizedId);
  }
}

export function extractStripeObjectIdFromPath(path: string): string {
  const match = /^\/stripe\/(?:customers|invoices|subscriptions|charges|payment-intents)\/([^/]+)\.json$/u.exec(path);
  if (!match?.[1]) {
    throw new Error(`Stripe path does not include an object id: ${path}`);
  }
  return decodeURIComponent(match[1]);
}
