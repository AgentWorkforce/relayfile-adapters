import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeFathomWebhook } from './webhook-normalizer.js';

test('normalizeFathomWebhook maps new-meeting-content-ready payload and headers', () => {
  const normalized = normalizeFathomWebhook(
    {
      event: 'new-meeting-content-ready',
      recording_id: 123456789,
      title: 'QBR',
      meeting_title: 'QBR 2025 Q1',
      url: 'https://fathom.video/xyz123',
      share_url: 'https://fathom.video/share/xyz123',
      transcript_language: 'en',
      default_summary: {
        template_name: 'general',
        markdown_formatted: '## Summary\nDemo\n',
      },
      action_items: [],
      crm_matches: {
        contacts: [],
        companies: [],
        deals: [],
      },
    },
    {
      'webhook-id': 'msg_123',
      'webhook-signature': 'v1,abc',
      'x-connection-id': 'conn_abc',
    },
  );

  assert.equal(normalized.provider, 'fathom');
  assert.equal(normalized.eventType, 'new-meeting-content-ready');
  assert.equal(normalized.objectType, 'meeting');
  assert.equal(normalized.objectId, '123456789');
  assert.equal(normalized.deliveryId, 'msg_123');
  assert.equal(normalized.signature, 'v1,abc');
  assert.equal(normalized.connectionId, 'conn_abc');
});
