import type { StripeReadRequest } from './types.js';

export function resolveQueryRequest(path: string): StripeReadRequest {
  if (path === '/stripe/customers' || path === '/stripe/customers/') {
    return { method: 'GET', endpoint: '/v1/customers' };
  }

  if (path === '/stripe/invoices' || path === '/stripe/invoices/') {
    return { method: 'GET', endpoint: '/v1/invoices' };
  }

  if (path === '/stripe/subscriptions' || path === '/stripe/subscriptions/') {
    return { method: 'GET', endpoint: '/v1/subscriptions' };
  }

  if (path === '/stripe/charges' || path === '/stripe/charges/') {
    return { method: 'GET', endpoint: '/v1/charges' };
  }

  if (path === '/stripe/payment-intents' || path === '/stripe/payment-intents/') {
    return { method: 'GET', endpoint: '/v1/payment_intents' };
  }

  const customer = path.match(/^\/stripe\/customers\/([^/]+)\.json$/u);
  if (customer?.[1]) {
    return { method: 'GET', endpoint: `/v1/customers/${decodeURIComponent(customer[1])}` };
  }

  const invoice = path.match(/^\/stripe\/invoices\/([^/]+)\.json$/u);
  if (invoice?.[1]) {
    return { method: 'GET', endpoint: `/v1/invoices/${decodeURIComponent(invoice[1])}` };
  }

  const subscription = path.match(/^\/stripe\/subscriptions\/([^/]+)\.json$/u);
  if (subscription?.[1]) {
    return { method: 'GET', endpoint: `/v1/subscriptions/${decodeURIComponent(subscription[1])}` };
  }

  const charge = path.match(/^\/stripe\/charges\/([^/]+)\.json$/u);
  if (charge?.[1]) {
    return { method: 'GET', endpoint: `/v1/charges/${decodeURIComponent(charge[1])}` };
  }

  const paymentIntent = path.match(/^\/stripe\/payment-intents\/([^/]+)\.json$/u);
  if (paymentIntent?.[1]) {
    return { method: 'GET', endpoint: `/v1/payment_intents/${decodeURIComponent(paymentIntent[1])}` };
  }

  throw new Error(`No Stripe query rule matched ${path}`);
}
