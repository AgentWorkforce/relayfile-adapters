import assert from 'node:assert/strict';
import test from 'node:test';

import { slackReceiptTs } from './slack.js';

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
