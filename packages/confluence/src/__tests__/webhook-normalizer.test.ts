import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  CONFLUENCE_DELIVERY_HEADER,
  CONFLUENCE_SIGNATURE_HEADER,
  assertValidConfluenceWebhookSignature,
  computeConfluenceWebhookSignature,
  normalizeConfluenceWebhook,
  validateConfluenceWebhookSignature,
  validateConfluenceWebhookTimestamp,
} from '../index.js';

const pagePayload = {
  webhookEvent: 'page_updated',
  timestamp: 1_743_155_200_000,
  webhookId: 'webhook_123',
  page: {
    id: '98765',
    title: 'Release Plan',
    spaceId: '12345',
    status: 'current',
  },
};

test('normalizeConfluenceWebhook canonicalizes Atlassian webhookEvent and extracts subject', () => {
  const normalized = normalizeConfluenceWebhook(pagePayload, {
    [CONFLUENCE_DELIVERY_HEADER]: 'delivery_123',
    'X-Relay-Connection-Id': 'conn_confluence_123',
    'X-Relay-Provider-Config-Key': 'confluence',
  });

  assert.equal(normalized.provider, 'confluence');
  assert.equal(normalized.connectionId, 'conn_confluence_123');
  assert.equal(normalized.providerConfigKey, 'confluence');
  assert.equal(normalized.eventType, 'page.update');
  assert.equal(normalized.objectType, 'page');
  assert.equal(normalized.objectId, '98765');
  assert.equal((normalized.payload as { id: string }).id, '98765');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_confluence_123',
    deliveryId: 'delivery_123',
    provider: 'confluence',
    providerConfigKey: 'confluence',
  });
});

test('normalizeConfluenceWebhook handles trashed events as remove and accepts dot-notation eventType', () => {
  const removed = normalizeConfluenceWebhook(
    {
      webhookEvent: 'page_trashed',
      page: { id: '98765', title: 'Release Plan' },
    },
    {},
  );
  assert.equal(removed.eventType, 'page.remove');

  const explicit = normalizeConfluenceWebhook(
    {
      eventType: 'space.update',
      space: { id: '12345', name: 'Engineering' },
    },
    {},
  );
  assert.equal(explicit.eventType, 'space.update');
  assert.equal(explicit.objectType, 'space');
  assert.equal(explicit.objectId, '12345');
});

test('validateConfluenceWebhookSignature accepts the expected HMAC and rejects invalid signatures', () => {
  const rawPayload = JSON.stringify(pagePayload);
  const secret = 'confluence-secret';
  const signature = createHmac('sha256', secret).update(rawPayload).digest('hex');

  const valid = validateConfluenceWebhookSignature(
    rawPayload,
    { [CONFLUENCE_SIGNATURE_HEADER]: signature },
    secret,
  );
  assert.equal(valid.ok, true);

  const invalid = validateConfluenceWebhookSignature(
    rawPayload,
    { [CONFLUENCE_SIGNATURE_HEADER]: 'deadbeef' },
    secret,
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-signature');

  assert.doesNotThrow(() =>
    assertValidConfluenceWebhookSignature(
      rawPayload,
      { [CONFLUENCE_SIGNATURE_HEADER]: signature },
      secret,
    ),
  );
});

test('validateConfluenceWebhookTimestamp enforces freshness', () => {
  const fresh = validateConfluenceWebhookTimestamp(pagePayload, 60_000, 1_743_155_230_000);
  assert.equal(fresh.ok, true);

  const stale = validateConfluenceWebhookTimestamp(pagePayload, 60_000, 1_743_155_400_001);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');
});

// Atlassian Connect sends events with a `confluence:` prefix. Make sure
// restored and archived land on the same canonical eventType as the
// un-prefixed variants — without these aliases the fallback splits the
// underscore name into `confluence:page.restored` and downstream filters
// on `page.update` miss the event entirely.
test('normalizeConfluenceWebhook resolves prefixed page_restored / page_archived to page.update', () => {
  for (const event of ['confluence:page_restored', 'confluence:page_archived']) {
    const normalized = normalizeConfluenceWebhook(
      { ...pagePayload, webhookEvent: event },
      { [CONFLUENCE_DELIVERY_HEADER]: `delivery_${event}` },
    );
    assert.equal(normalized.eventType, 'page.update', `${event} should map to page.update`);
    assert.equal(normalized.objectType, 'page');
  }
});

// Unsupported object types must fail fast. The pre-fix code silently
// coerced anything that wasn't 'space' to 'page', which masked broken
// upstream payloads and produced bogus tree writes. Provide an
// objectId via the top-level `id` so we reach the objectType check
// rather than the missing-id guard.
test('normalizeConfluenceWebhook fails fast on unsupported object types', () => {
  assert.throws(
    () =>
      normalizeConfluenceWebhook(
        {
          webhookEvent: 'comment_created',
          id: '111',
          comment: { id: '111', text: 'hi' },
        },
        { [CONFLUENCE_DELIVERY_HEADER]: 'delivery_comment' },
      ),
    /Unsupported Confluence webhook object type/,
  );
});

// HMAC must compute over the provider's raw request body. Accepting a
// parsed object and JSON.stringify-ing it produced digests that drifted
// from the provider's signature whenever key ordering or whitespace
// differed. Require raw bytes (string / Buffer / Uint8Array / ArrayBuffer).
test('computeConfluenceWebhookSignature rejects parsed object payloads', () => {
  assert.throws(
    () => computeConfluenceWebhookSignature({ webhookEvent: 'page_created' }, 'secret'),
    /raw request body/,
  );
});

test('computeConfluenceWebhookSignature accepts string and Buffer raw bodies', () => {
  const secret = 'shh';
  const body = '{"webhookEvent":"page_created"}';
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(computeConfluenceWebhookSignature(body, secret), expected);
  assert.equal(computeConfluenceWebhookSignature(Buffer.from(body, 'utf8'), secret), expected);
});
