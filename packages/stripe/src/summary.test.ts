import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

const MAX_SUMMARY_JSON_LENGTH = 1024;

function assertSummaryWithinBudget(summary: unknown): void {
  const serialized = JSON.stringify(summary);
  assert.ok(
    serialized.length < MAX_SUMMARY_JSON_LENGTH,
    `expected summary JSON under ${MAX_SUMMARY_JSON_LENGTH} bytes, got ${serialized.length}`,
  );
}

test('buildSummary derives Stripe summary fields from event payloads', () => {
  const summary = buildSummary({
    type: 'payment_intent.succeeded',
    request: {
      id: 'req_1',
    },
    data: {
      object: {
        object: 'payment_intent',
        description: 'Priority customer renewal',
        status: 'succeeded',
      },
      previous_attributes: {
        status: 'processing',
      },
    },
  });

  assert.deepEqual(summary, {
    title: 'Priority customer renewal',
    status: 'succeeded',
    actor: { id: 'req_1' },
    fieldsChanged: ['status'],
    tags: ['object:payment_intent', 'event:payment_intent.succeeded'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary redacts Stripe card numbers and customer email addresses from free text', () => {
  const summary = buildSummary({
    object: 'charge',
    description: 'Card 4242 4242 4242 4242 for jane@example.com',
    status: 'succeeded',
    _stripe_event: {
      eventType: 'charge.updated',
      previousAttributes: {
        receipt_email: 'old@example.com',
        status: 'pending',
      },
    },
  });

  assert.deepEqual(summary, {
    title: 'Card [redacted-card] for [redacted-email]',
    status: 'succeeded',
    fieldsChanged: ['receipt_email', 'status'],
    tags: ['object:charge', 'event:charge.updated'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary does not fall back to unsafe Stripe object names when description is missing', () => {
  const summary = buildSummary({
    object: 'customer',
    name: 'Jane Example',
    status: 'active',
    _stripe_event: {
      eventType: 'customer.updated',
      previousAttributes: {
        email: 'old@example.com',
      },
    },
  });

  assert.deepEqual(summary, {
    status: 'active',
    fieldsChanged: ['email'],
    tags: ['object:customer', 'event:customer.updated'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary caps oversized Stripe summaries under the 1 KB envelope budget', () => {
  const summary = buildSummary({
    type: 'payment_intent.processing',
    data: {
      object: {
        object: 'payment_intent',
        description: `Charge 4242 4242 4242 4242 ${'retry '.repeat(40)}for jane@example.com`,
        status: 'processing',
      },
      previous_attributes: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [`field_${index}`, `value-${index}`]),
      ),
    },
  });

  assert.equal(summary.title?.length, 120);
  assert.equal(summary.title?.endsWith('...'), true);
  assert.equal(summary.fieldsChanged?.length, 12);
  assert.match(summary.title ?? '', /\[redacted-email\]|\[redacted-card\]/);
  assertSummaryWithinBudget(summary);
});
