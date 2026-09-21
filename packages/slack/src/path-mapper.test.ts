import assert from 'node:assert/strict';
import test from 'node:test';

import { slackChannelIdFromPathSegment } from './path-mapper.js';

test('slackChannelIdFromPathSegment recovers the id from every emitted form', () => {
  // v2 (current, since "v2 parity")
  assert.equal(slackChannelIdFromPathSegment('C0B9Z4CLG1J__watchdog-test'), 'C0B9Z4CLG1J');
  // legacy, adapter-slack <= 0.2.2
  assert.equal(slackChannelIdFromPathSegment('watchdog-test--C0B9Z4CLG1J'), 'C0B9Z4CLG1J');
  // bare
  assert.equal(slackChannelIdFromPathSegment('C0B9Z4CLG1J'), 'C0B9Z4CLG1J');
});

test('slackChannelIdFromPathSegment keys off the id, not the slug', () => {
  // Slugification lossily replaces `_`, so only the id token is reliable.
  assert.equal(slackChannelIdFromPathSegment('C0B9Z4CLG1J__ops_alerts_v2'), 'C0B9Z4CLG1J');
  assert.equal(slackChannelIdFromPathSegment('ops-alerts-v2--C0B9Z4CLG1J'), 'C0B9Z4CLG1J');
});

test('slackChannelIdFromPathSegment returns null when no id is recoverable', () => {
  // The caller decides whether a best-effort `#name` is acceptable; writeback
  // does, a watch matcher must not.
  assert.equal(slackChannelIdFromPathSegment('general'), null);
  assert.equal(slackChannelIdFromPathSegment(''), null);
  assert.equal(slackChannelIdFromPathSegment('X0B9Z4CLG1J'), null);
});

test('slackChannelIdFromPathSegment decodes escapes and survives malformed ones', () => {
  assert.equal(slackChannelIdFromPathSegment('C0B9Z4CLG1J__ops%20alerts'), 'C0B9Z4CLG1J');
  assert.equal(slackChannelIdFromPathSegment('C0B9Z4CLG1J__bad%ZZ'), 'C0B9Z4CLG1J');
});
