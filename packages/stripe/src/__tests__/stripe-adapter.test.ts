import assert from 'node:assert/strict';
import test from 'node:test';

import {
  StripeAdapter,
  computeStripePath,
  stripeChargePath,
  stripeCustomerPath,
  stripeInvoicePath,
  stripePaymentIntentPath,
  stripeSubscriptionPath,
  type ConnectionProvider,
  type FileSemantics,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';
import type { StripeWebhookPayload } from '../types.js';

interface CapturedWrite {
  input: WriteFileInput;
}

function createAdapter(captured: CapturedWrite[] = []): StripeAdapter {
  const client: RelayFileClientLike = {
    async writeFile(input) {
      captured.push({ input });
      return { created: true };
    },
    async deleteFile() {
      return undefined;
    },
  };

  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return {
        status: 200,
        headers: {},
        data: null as never,
      };
    },
    async healthCheck() {
      return true;
    },
  };

  return new StripeAdapter(client, provider, { connectionId: 'conn_stripe_123' });
}

function eventFor(object: StripeWebhookPayload['data']['object'], type: string): StripeWebhookPayload {
  return {
    id: `evt_${object.id}`,
    object: 'event',
    api_version: '2025-02-24.acacia',
    created: 1_778_134_400,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: 'req_123', idempotency_key: 'idem_123' },
    type,
  };
}

test('StripeAdapter exposes provider name and supported Stripe webhook events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'stripe');
  assert.ok(adapter.supportedEvents().includes('customer.created'));
  assert.ok(adapter.supportedEvents().includes('customer.subscription.updated'));
  assert.ok(adapter.supportedEvents().includes('payment_intent.succeeded'));
});

test('ingestWebhook writes customer webhooks to deterministic customer paths', async () => {
  const captured: CapturedWrite[] = [];
  const adapter = createAdapter(captured);

  const result = await adapter.ingestWebhook('ws_123', eventFor({
    id: 'cus_123',
    object: 'customer',
    created: 1_778_134_400,
    email: 'billing@example.com',
    metadata: { plan: 'enterprise' },
    name: 'Example Inc.',
  }, 'customer.created'));

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, [stripeCustomerPath('cus_123')]);
  assert.equal(captured[0]?.input.path, '/stripe/customers/cus_123.json');
  assert.equal(captured[0]?.input.semantics?.properties?.['stripe.customer.email'], 'billing@example.com');
  assert.equal(captured[0]?.input.semantics?.properties?.['stripe.customer.metadata.plan'], 'enterprise');
});

test('ingestWebhook writes invoice webhooks and extracts customer/subscription relations', async () => {
  const captured: CapturedWrite[] = [];
  const adapter = createAdapter(captured);

  const result = await adapter.ingestWebhook('ws_123', eventFor({
    id: 'in_123',
    object: 'invoice',
    amount_due: 12000,
    amount_paid: 12000,
    currency: 'usd',
    customer: 'cus_123',
    hosted_invoice_url: 'https://pay.stripe.com/invoice/in_123',
    number: 'ABC-0001',
    paid: true,
    status: 'paid',
    subscription: 'sub_123',
    total: 12000,
  }, 'invoice.paid'));

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, [stripeInvoicePath('in_123')]);
  assert.deepEqual(captured[0]?.input.semantics?.relations, [
    stripeCustomerPath('cus_123'),
    stripeSubscriptionPath('sub_123'),
  ]);
  assert.equal(captured[0]?.input.semantics?.properties?.['stripe.invoice.status'], 'paid');
});

test('ingestWebhook writes subscription webhooks and preserves lifecycle fields', async () => {
  const captured: CapturedWrite[] = [];
  const adapter = createAdapter(captured);

  const result = await adapter.ingestWebhook('ws_123', eventFor({
    id: 'sub_123',
    object: 'subscription',
    cancel_at_period_end: false,
    created: 1_778_134_400,
    currency: 'usd',
    current_period_end: 1_780_726_400,
    current_period_start: 1_778_134_400,
    customer: 'cus_123',
    items: { data: [{ id: 'si_123', price: { id: 'price_123', product: 'prod_123' }, quantity: 1 }] },
    status: 'active',
  }, 'customer.subscription.updated'));

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, [stripeSubscriptionPath('sub_123')]);
  assert.equal(captured[0]?.input.semantics?.properties?.['stripe.subscription.status'], 'active');
  assert.equal(captured[0]?.input.semantics?.properties?.['stripe.subscription.product_ids'], 'prod_123');
  assert.deepEqual(captured[0]?.input.semantics?.relations, [stripeCustomerPath('cus_123')]);
});

test('ingestWebhook writes charge webhooks and relates charges to payment intents', async () => {
  const captured: CapturedWrite[] = [];
  const adapter = createAdapter(captured);

  const result = await adapter.ingestWebhook('ws_123', eventFor({
    id: 'ch_123',
    object: 'charge',
    amount: 12000,
    captured: true,
    currency: 'usd',
    customer: 'cus_123',
    paid: true,
    payment_intent: 'pi_123',
    receipt_url: 'https://pay.stripe.com/receipts/ch_123',
    status: 'succeeded',
  }, 'charge.succeeded'));

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, [stripeChargePath('ch_123')]);
  assert.deepEqual(captured[0]?.input.semantics?.relations, [
    stripeCustomerPath('cus_123'),
    stripePaymentIntentPath('pi_123'),
  ]);
  assert.equal(captured[0]?.input.semantics?.properties?.['stripe.charge.status'], 'succeeded');
});

test('ingestWebhook writes payment_intent webhooks and extracts invoice/charge relations', async () => {
  const captured: CapturedWrite[] = [];
  const adapter = createAdapter(captured);

  const result = await adapter.ingestWebhook('ws_123', eventFor({
    id: 'pi_123',
    object: 'payment_intent',
    amount: 12000,
    amount_received: 12000,
    charges: { data: [{ id: 'ch_123', object: 'charge', amount: 12000 }] },
    currency: 'usd',
    customer: 'cus_123',
    invoice: 'in_123',
    latest_charge: 'ch_123',
    status: 'succeeded',
  }, 'payment_intent.succeeded'));

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, [stripePaymentIntentPath('pi_123')]);
  assert.deepEqual(captured[0]?.input.semantics?.relations, [
    stripeChargePath('ch_123'),
    stripeCustomerPath('cus_123'),
    stripeInvoicePath('in_123'),
  ]);
  assert.equal(captured[0]?.input.semantics?.properties?.['stripe.payment_intent.status'], 'succeeded');
});

test('computePath and computeSemantics are deterministic for supported object aliases', () => {
  const adapter = createAdapter();

  assert.equal(computeStripePath('payment_intent', 'pi_123'), '/stripe/payment-intents/pi_123.json');
  assert.equal(adapter.computePath('Payment Intent', 'pi_123'), '/stripe/payment-intents/pi_123.json');
  assert.equal(adapter.computePath('customer', 'cus_123'), '/stripe/customers/cus_123.json');

  const semantics: FileSemantics = adapter.computeSemantics('invoice', 'in_123', {
    id: 'in_123',
    object: 'invoice',
    customer: { id: 'cus_123', object: 'customer', email: 'billing@example.com' },
    payment_intent: 'pi_123',
    status: 'open',
  });

  assert.equal(semantics.properties?.['stripe.invoice.status'], 'open');
  assert.deepEqual(semantics.relations, [
    stripeCustomerPath('cus_123'),
    stripePaymentIntentPath('pi_123'),
  ]);
});
