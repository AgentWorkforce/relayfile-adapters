import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SLACK_CHANNEL_EVENT_TYPES,
  SLACK_ENVELOPE_EVENT_TYPES,
  SLACK_MESSAGE_SUBTYPES,
  type SlackAdapterConfig,
  type SlackEnvelope,
} from '../index.js';

test('barrel exports Slack event constants', () => {
  assert.ok(SLACK_ENVELOPE_EVENT_TYPES.includes('event_callback'));
  assert.ok(SLACK_CHANNEL_EVENT_TYPES.includes('channel_created'));
  assert.ok(SLACK_MESSAGE_SUBTYPES.includes('thread_broadcast'));
});

test('Slack config and envelope types allow common webhook payloads', () => {
  const config: SlackAdapterConfig = {
    signingSecret: 'signing-secret',
    includeBotMessages: false,
    normalizeThreads: true,
  };

  const envelope: SlackEnvelope = {
    type: 'event_callback',
    event_id: 'Ev123',
    event_time: 1_711_111_111,
    event: {
      type: 'message',
      channel: 'C123',
      text: 'hello relayfile',
      ts: '1711111111.000100',
    },
  };

  assert.equal(config.signingSecret, 'signing-secret');
  assert.equal(envelope.type, 'event_callback');
  assert.equal(envelope.event.type, 'message');
});
