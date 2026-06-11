import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWritebackRequest } from './writeback.js';

test('Stripe writeback resolves customer create from non-canonical draft filenames', () => {
  const request = resolveWritebackRequest(
    '/stripe/customers/create%20customer.json',
    JSON.stringify({
      email: 'billing@example.com',
      name: 'Example Inc.',
      metadata: { source: 'relayfile' },
      id: 'ignored',
    }),
  );

  assert.equal(request.action, 'create_customer');
  assert.equal(request.method, 'POST');
  assert.equal(request.endpoint, '/v1/customers');
  assert.deepEqual(request.body, {
    email: 'billing@example.com',
    name: 'Example Inc.',
    metadata: { source: 'relayfile' },
  });
});

test('Stripe writeback keeps legacy new.json customer create compatibility', () => {
  const request = resolveWritebackRequest(
    '/stripe/customers/new.json',
    JSON.stringify({ email: 'billing@example.com' }),
  );

  assert.equal(request.action, 'create_customer');
  assert.equal(request.endpoint, '/v1/customers');
});

test('Stripe writeback preserves canonical customer update routing', () => {
  const request = resolveWritebackRequest(
    '/stripe/customers/cus_123.json',
    JSON.stringify({ description: 'Updated from Relayfile' }),
  );

  assert.equal(request.action, 'update_customer');
  assert.equal(request.endpoint, '/v1/customers/cus_123');
  assert.deepEqual(request.body, { description: 'Updated from Relayfile' });
});

test('Stripe writeback resolves invoice create from non-canonical draft filenames', () => {
  const request = resolveWritebackRequest(
    '/stripe/invoices/create-invoice.json',
    JSON.stringify({
      customer: 'cus_123',
      collection_method: 'send_invoice',
      days_until_due: 30,
    }),
  );

  assert.equal(request.action, 'create_invoice');
  assert.equal(request.endpoint, '/v1/invoices');
  assert.deepEqual(request.body, {
    customer: 'cus_123',
    collection_method: 'send_invoice',
    days_until_due: 30,
  });
});

test('Stripe writeback preserves canonical invoice update routing', () => {
  const request = resolveWritebackRequest(
    '/stripe/invoices/in_123.json',
    JSON.stringify({ description: 'Updated invoice' }),
  );

  assert.equal(request.action, 'update_invoice');
  assert.equal(request.endpoint, '/v1/invoices/in_123');
  assert.deepEqual(request.body, { description: 'Updated invoice' });
});
