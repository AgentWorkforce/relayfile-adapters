import assert from 'node:assert/strict';
import test from 'node:test';

import { S3Adapter, S3Bridge } from '../index.js';
import type { StorageBridgeEvent } from '../index.js';

test('s3 integration maps raw provider payload through the storage bridge', async () => {
  const config = { workspaceId: 'ws_storage', connectionId: 'conn_s3', accountId: 'aws' };
  const adapter = new S3Adapter(config);
  const published: StorageBridgeEvent[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const bridge = new S3Bridge(config, {
    publish: async (event) => {
      published.push(event);
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      deliveries.push(toRelayfileDelivery('s3', event, await adapter.fetchContent(event)));
    },
  });

  const body = { messageId: 'sqs-s3-1', receiptHandle: 'rh-1', Records: [{ eventName: 'ObjectCreated:Put', eventTime: '2026-05-09T08:37:00.000Z', s3: { bucket: { name: 'rf-bucket' }, object: { key: 'logs/app.log', size: 70, eTag: 'etag-s3', sequencer: '006' } } }] };

  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });
  await bridge.handleNotification({ body, receivedAt: '2026-05-09T08:45:05.000Z' });

  assert.equal(published.length, 2);
  assert.equal(deliveries.length, 1);
  const event = published[0];
  assert.ok(event);
  assert.equal(event.eventId, 's3:sqs-s3-1:rf-bucket:logs/app.log:006');
  assert.equal(event.source, 's3');
  assert.equal(event.changeType, 'created');
  assert.equal(event.relayfilePath, '/s3/rf-bucket/logs/app.log');
  assert.equal(event.resourceId, 'rf-bucket/logs/app.log');
  assert.equal(event.sizeBytes, 70);
  assert.equal(event.fingerprint, 'etag-s3');
  assert.equal((deliveries[0] as { delivery_id: string }).delivery_id, 's3:sqs-s3-1:rf-bucket:logs/app.log:006');
  assert.equal(adapter.resolveWriteback('/s3/rf-bucket/objects/draft-app.log', JSON.stringify({"key":"logs/app.log"})).operation, 'create');
  assert.throws(() => adapter.mapNangoSyncRecord({ id: 'unsupported' }), /does not declare/);
});

function toRelayfileDelivery(provider: string, event: StorageBridgeEvent, content: Uint8Array | null) {
  return { provider, event_type: `file.${event.changeType}`, path: event.relayfilePath, delivery_id: event.eventId, timestamp: event.occurredAt, data: { contentBase64: content ? Buffer.from(content).toString('base64') : null } };
}
