import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  AIRTABLE_CONTENT_MAC_HEADER,
  AIRTABLE_TIMESTAMP_HEADER,
  assertValidAirtableWebhookSignature,
  buildSummary,
  computeAirtableWebhookSignature,
  normalizeAirtableNotification,
  normalizeAirtableWebhook,
  validateAirtableWebhookSignature,
  validateAirtableWebhookTimestamp,
} from '../index.js';

const payload = {
  action: 'changed',
  baseId: 'app_base',
  data: {
    fields: {
      Name: 'Ship Airtable adapter',
      Status: 'In progress',
    },
    id: 'rec_1',
  },
  tableId: 'tbl_tasks',
  timestamp: 1_777_639_200_000,
  type: 'record',
};

test('accepts known-good HMAC content MAC and normalizes Airtable webhook payload', () => {
  const rawPayload = JSON.stringify(payload);
  const secret = 'airtable-secret';
  const signature = `hmac-sha256=${createHmac('sha256', secret).update(rawPayload).digest('hex')}`;

  assert.equal(computeAirtableWebhookSignature(rawPayload, secret), signature);

  const validation = validateAirtableWebhookSignature(rawPayload, {
    [AIRTABLE_CONTENT_MAC_HEADER]: signature,
    [AIRTABLE_TIMESTAMP_HEADER]: '1777639200000',
    'X-Relay-Connection-Id': 'conn_airtable_1',
  }, secret);
  assert.equal(validation.ok, true);

  const normalized = normalizeAirtableWebhook(rawPayload, {
    [AIRTABLE_CONTENT_MAC_HEADER]: signature,
    [AIRTABLE_TIMESTAMP_HEADER]: '1777639200000',
    'X-Relay-Connection-Id': 'conn_airtable_1',
    'X-Relay-Provider-Config-Key': 'airtable-primary',
  }, {
    nowMs: 1_777_639_200_000,
    webhookSecret: secret,
  });

  assert.equal(normalized.provider, 'airtable');
  assert.equal(normalized.connectionId, 'conn_airtable_1');
  assert.equal(normalized.eventType, 'record.update');
  assert.equal(normalized.objectType, 'record');
  assert.equal(normalized.objectId, 'rec_1');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_airtable_1',
    provider: 'airtable',
    providerConfigKey: 'airtable-primary',
  });
});

test('rejects tampered body with invalid-signature result and throwing helper', () => {
  const rawPayload = JSON.stringify(payload);
  const tamperedPayload = JSON.stringify({
    ...payload,
    data: {
      fields: {
        Name: 'Tampered',
      },
      id: 'rec_1',
    },
  });
  const secret = 'airtable-secret';
  const signature = computeAirtableWebhookSignature(rawPayload, secret);

  const invalid = validateAirtableWebhookSignature(tamperedPayload, {
    [AIRTABLE_CONTENT_MAC_HEADER]: signature,
  }, secret);

  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-signature');
  assert.throws(
    () => assertValidAirtableWebhookSignature(tamperedPayload, { [AIRTABLE_CONTENT_MAC_HEADER]: signature }, secret),
    /invalid-signature/,
  );
});

test('normalizeAirtableWebhook requires raw request bytes for signature validation', () => {
  const rawPayload = JSON.stringify(payload);
  const signature = computeAirtableWebhookSignature(rawPayload, 'airtable-secret');

  assert.throws(
    () =>
      normalizeAirtableWebhook(payload, {
        [AIRTABLE_CONTENT_MAC_HEADER]: signature,
      }, {
        webhookSecret: 'airtable-secret',
      }),
    /original raw request body/,
  );
});

test('rejects missing content MAC header', () => {
  const rawPayload = JSON.stringify(payload);
  const missing = validateAirtableWebhookSignature(rawPayload, {}, 'airtable-secret');

  assert.deepEqual(missing, {
    ok: false,
    reason: 'missing-signature',
  });
});

test('rejects malformed content MAC header', () => {
  const rawPayload = JSON.stringify(payload);
  const malformed = validateAirtableWebhookSignature(rawPayload, {
    [AIRTABLE_CONTENT_MAC_HEADER]: 'sha256=not-the-provider-scheme',
  }, 'airtable-secret');

  assert.equal(malformed.ok, false);
  assert.equal(malformed.reason, 'malformed-signature');
});

test('rejects expired timestamp when timestamp freshness is required', () => {
  const stale = validateAirtableWebhookTimestamp(payload, {
    [AIRTABLE_TIMESTAMP_HEADER]: '1777639200000',
  }, 60_000, 1_777_640_000_001, true);

  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');
});

test('normalizeAirtableNotification keeps the receive path shallow and derives a routing summary', () => {
  const notification = normalizeAirtableNotification({
    actionMetadata: {
      sourceMetadata: {
        user: {
          id: 'usr_1',
          name: 'Ada Lovelace',
        },
      },
    },
    baseId: 'app_base',
    changedTablesById: {
      tbl_tasks: {
        changedFieldIds: ['fld_status'],
        changedRecordsById: {
          rec_1: {
            current: {
              cellValuesByFieldId: {
                fld_name: 'Ship Airtable adapter',
                fld_status: 'Done',
              },
            },
          },
        },
      },
    },
    timestamp: '2026-05-12T01:00:00.000Z',
    webhookId: 'ach_1',
  }, {}, {
    nowMs: Date.parse('2026-05-12T01:00:00.000Z'),
  });

  assert.equal(notification.baseId, 'app_base');
  assert.equal(notification.kind, 'airtable.notification');
  assert.equal(notification.webhookId, 'ach_1');
  assert.equal(notification.path, '/airtable/bases/app_base/_notifications/ach_1.json');
  assert.deepEqual(notification.changedFieldIds, ['fld_status', 'fld_name']);
  assert.deepEqual(notification.changes, [
    { fieldId: 'fld_name', recordId: 'rec_1', tableId: 'tbl_tasks', type: 'update' },
    { fieldId: 'fld_status', recordId: 'rec_1', tableId: 'tbl_tasks', type: 'update' },
  ]);

  assert.deepEqual(buildSummary(notification), {
    actor: {
      displayName: 'Ada Lovelace',
      id: 'usr_1',
    },
    fieldsChanged: ['fld_status', 'fld_name'],
    tags: ['airtable', 'notification', 'webhook:ach_1', 'table:tbl_tasks'],
    title: 'Ship Airtable adapter',
  });
});
