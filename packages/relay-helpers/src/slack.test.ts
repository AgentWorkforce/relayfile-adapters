import assert from 'node:assert/strict';
import test from 'node:test';

import { createWritebackIdempotency, slackReceiptTs } from './slack.js';

test('slackReceiptTs prefers the Slack message ts (externalId) so replies thread', () => {
  // A chat.postMessage receipt: the worker records the message ts as externalId.
  // Older behaviour returned `created` (a non-ts value) and broke threading.
  assert.equal(
    slackReceiptTs({ externalId: '1733512345.001900', created: '2026-06-16T20:35:00.000Z', id: 'op-1' }),
    '1733512345.001900'
  );
});

test('slackReceiptTs uses the replay `ts` mirror when externalId is absent', () => {
  assert.equal(slackReceiptTs({ ts: '1733512345.001900' }), '1733512345.001900');
});

test('slackReceiptTs falls back to created/id for non-message receipts', () => {
  assert.equal(slackReceiptTs({ id: 'ISS-1' }), 'ISS-1');
  assert.equal(slackReceiptTs({ created: '2026-06-16T20:35:00.000Z' }), '2026-06-16T20:35:00.000Z');
});

test('slackReceiptTs returns empty when there is no usable receipt', () => {
  assert.equal(slackReceiptTs(undefined), '');
  assert.equal(slackReceiptTs({}), '');
});

test('slackReceiptTs ignores a non-string ts', () => {
  assert.equal(slackReceiptTs({ ts: 12345, created: 'c' }), 'c');
});

test('writeback idempotency stamps tick:<deliveryId>:<ordinal> in call order', () => {
  const next = createWritebackIdempotency(() => 'delivery-7');
  assert.equal(next(), 'tick:delivery-7:1');
  assert.equal(next(), 'tick:delivery-7:2');
  assert.equal(next(), 'tick:delivery-7:3');
});

test('writeback idempotency aligns ordinals across a re-run (fresh stamper restarts at 1)', () => {
  const run1 = createWritebackIdempotency(() => 'delivery-7');
  const run2 = createWritebackIdempotency(() => 'delivery-7');
  assert.equal(run1(), 'tick:delivery-7:1');
  assert.equal(run1(), 'tick:delivery-7:2');
  // A duplicate delivery reuses the same delivery id and restarts the counter,
  // so its keys match run1's — the cloud worker dedups the second post.
  assert.equal(run2(), 'tick:delivery-7:1');
  assert.equal(run2(), 'tick:delivery-7:2');
});

test('writeback idempotency yields no key and does not advance without a delivery id', () => {
  let deliveryId: string | undefined;
  const next = createWritebackIdempotency(() => deliveryId);
  assert.equal(next(), undefined);
  assert.equal(next(), undefined);
  // Once a delivery id appears, the ordinal starts at 1 (the no-id calls didn't advance it).
  deliveryId = 'delivery-9';
  assert.equal(next(), 'tick:delivery-9:1');
});
