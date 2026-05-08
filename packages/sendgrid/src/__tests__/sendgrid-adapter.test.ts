import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SendGridAdapter,
  computeSendGridPath,
  sendGridContactPath,
  sendGridEventPath,
  sendGridMailPath,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

function createAdapter(writes: WriteFileInput[] = []): SendGridAdapter {
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push(input);
      return { created: true };
    },
    async deleteFile() {
      return undefined;
    },
  };

  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return {
        status: 200,
        headers: {},
        data: null as never,
      };
    },
    async healthCheck() {
      return true;
    },
  };

  return new SendGridAdapter(client, provider, {
    connectionId: 'conn_sendgrid_123',
  });
}

test('SendGridAdapter exposes the provider name and supported webhook events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'sendgrid');
  assert.ok(adapter.supportedEvents().includes('event.delivered'));
  assert.ok(adapter.supportedEvents().includes('mail.create'));
  assert.ok(adapter.supportedEvents().includes('contact.update'));
});

test('path mapping stays deterministic for primary SendGrid objects', () => {
  const adapter = createAdapter();

  assert.equal(sendGridMailPath('msg 1/2'), '/sendgrid/mail/msg%201%2F2.json');
  assert.equal(sendGridEventPath('event:42'), '/sendgrid/events/event%3A42.json');
  assert.equal(sendGridContactPath('user@example.com'), '/sendgrid/contacts/user%40example.com.json');
  assert.equal(computeSendGridPath('message', 'msg_123'), '/sendgrid/mail/msg_123.json');
  assert.equal(computeSendGridPath('webhook_event', 'evt_123'), '/sendgrid/events/evt_123.json');
  assert.equal(computeSendGridPath('marketing_contact', 'contact_123'), '/sendgrid/contacts/contact_123.json');
  assert.equal(adapter.computePath('contacts', 'user@example.com'), '/sendgrid/contacts/user%40example.com.json');
});

test('ingestWebhook writes SendGrid mail payloads with recipient semantics', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter(writes);

  const result = await adapter.ingestWebhook('workspace_123', {
    type: 'mail',
    action: 'create',
    id: 'mail_123',
    subject: 'Welcome',
    from: { email: 'sender@example.com', name: 'Sender' },
    personalizations: [
      {
        to: [{ email: 'customer@example.com', name: 'Customer' }],
      },
    ],
    categories: ['lifecycle', 'welcome'],
    content: [{ type: 'text/plain', value: 'Hello' }],
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(writes[0]?.path, '/sendgrid/mail/mail_123.json');
  assert.equal(writes[0]?.semantics?.properties?.['sendgrid.subject'], 'Welcome');
  assert.equal(writes[0]?.semantics?.properties?.['sendgrid.recipient_count'], '1');
  assert.deepEqual(writes[0]?.semantics?.relations, [
    '/sendgrid/contacts/customer%40example.com.json',
    '/sendgrid/contacts/sender%40example.com.json',
  ]);
});

test('ingestWebhook writes SendGrid event payloads with message and contact relations', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter(writes);

  const result = await adapter.ingestWebhook('workspace_123', [
    {
      sg_event_id: 'evt_123',
      sg_message_id: 'msg_123',
      email: 'customer@example.com',
      event: 'delivered',
      timestamp: 1_774_000_000,
      response: '250 OK',
      category: ['welcome'],
    },
  ]);

  assert.equal(result.filesWritten, 1);
  assert.equal(writes[0]?.path, '/sendgrid/events/evt_123.json');
  assert.equal(writes[0]?.semantics?.properties?.['sendgrid.event'], 'delivered');
  assert.equal(writes[0]?.semantics?.properties?.['sendgrid.timestamp_iso'], '2026-03-20T09:46:40.000Z');
  assert.deepEqual(writes[0]?.semantics?.relations, [
    '/sendgrid/contacts/customer%40example.com.json',
    '/sendgrid/mail/msg_123.json',
  ]);
});

test('ingestWebhook writes every SendGrid event in a batched event payload', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter(writes);

  const result = await adapter.ingestWebhook('workspace_123', [
    {
      sg_event_id: 'evt_delivered',
      sg_message_id: 'msg_123',
      email: 'customer@example.com',
      event: 'delivered',
      timestamp: 1_774_000_000,
    },
    {
      sg_event_id: 'evt_opened',
      sg_message_id: 'msg_123',
      email: 'customer@example.com',
      event: 'open',
      timestamp: 1_774_000_001,
    },
  ]);

  assert.equal(result.filesWritten, 2);
  assert.deepEqual(result.paths, [
    '/sendgrid/events/evt_delivered.json',
    '/sendgrid/events/evt_opened.json',
  ]);
  assert.deepEqual(writes.map((write) => write.path), [
    '/sendgrid/events/evt_delivered.json',
    '/sendgrid/events/evt_opened.json',
  ]);
});

test('ingestWebhook preserves successful SendGrid batch writes when one event fails', async () => {
  const writes: WriteFileInput[] = [];
  const attempts: string[] = [];
  const client: RelayFileClientLike = {
    async writeFile(input) {
      attempts.push(input.path);
      if (input.path === '/sendgrid/events/evt_opened.json') {
        throw new Error('simulated write failure');
      }
      writes.push(input);
      return { created: true };
    },
    async deleteFile() {
      return undefined;
    },
  };
  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return { status: 200, headers: {}, data: null as never };
    },
    async healthCheck() {
      return true;
    },
  };
  const adapter = new SendGridAdapter(client, provider);

  const result = await adapter.ingestWebhook('workspace_123', [
    {
      sg_event_id: 'evt_delivered',
      sg_message_id: 'msg_123',
      email: 'customer@example.com',
      event: 'delivered',
      timestamp: 1_774_000_000,
    },
    {
      sg_event_id: 'evt_opened',
      sg_message_id: 'msg_123',
      email: 'customer@example.com',
      event: 'open',
      timestamp: 1_774_000_001,
    },
  ]);

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, [
    '/sendgrid/events/evt_delivered.json',
    '/sendgrid/events/evt_opened.json',
  ]);
  assert.deepEqual(result.errors, [
    {
      path: '/sendgrid/events/evt_opened.json',
      error: 'simulated write failure',
    },
  ]);
  assert.deepEqual(attempts, [
    '/sendgrid/events/evt_delivered.json',
    '/sendgrid/events/evt_opened.json',
  ]);
  assert.deepEqual(writes.map((write) => write.path), ['/sendgrid/events/evt_delivered.json']);
});

test('ingestWebhook writes SendGrid contact payloads with marketing semantics', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter(writes);

  const result = await adapter.ingestWebhook('workspace_123', {
    type: 'contact',
    action: 'update',
    id: 'contact_123',
    email: 'customer@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    list_ids: ['list_b', 'list_a'],
    custom_fields: {
      plan: 'pro',
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(writes[0]?.path, '/sendgrid/contacts/contact_123.json');
  assert.equal(writes[0]?.semantics?.properties?.['sendgrid.email'], 'customer@example.com');
  assert.equal(writes[0]?.semantics?.properties?.['sendgrid.list_ids'], 'list_a, list_b');
  assert.equal(writes[0]?.semantics?.properties?.['sendgrid.custom_field_keys'], 'plan');
});

test('computeSemantics extracts event diagnostics into properties and comments', () => {
  const adapter = createAdapter();

  const semantics = adapter.computeSemantics('event', 'evt_bounce', {
    sg_event_id: 'evt_bounce',
    sg_message_id: 'msg_bounce',
    email: 'customer@example.com',
    event: 'bounce',
    reason: 'Mailbox unavailable',
    response: '550 mailbox unavailable',
    timestamp: 1_774_000_000,
  });

  assert.equal(semantics.properties?.['sendgrid.event'], 'bounce');
  assert.equal(semantics.properties?.['sendgrid.reason'], 'Mailbox unavailable');
  assert.deepEqual(semantics.comments, ['Mailbox unavailable', '550 mailbox unavailable']);
  assert.deepEqual(semantics.relations, [
    '/sendgrid/contacts/customer%40example.com.json',
    '/sendgrid/mail/msg_bounce.json',
  ]);
});

test('normalized delete events use deleteFile when available', async () => {
  const deleted: string[] = [];
  const client: RelayFileClientLike = {
    async writeFile() {
      throw new Error('writeFile should not be called for delete events');
    },
    async deleteFile(input) {
      deleted.push(input.path);
    },
  };
  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return { status: 200, headers: {}, data: null as never };
    },
    async healthCheck() {
      return true;
    },
  };
  const adapter = new SendGridAdapter(client, provider);

  const result = await adapter.ingestWebhook('workspace_123', {
    provider: 'sendgrid',
    eventType: 'contact.delete',
    objectType: 'contact',
    objectId: 'contact_123',
    payload: { email: 'customer@example.com', _webhook: { action: 'delete' } },
  });

  assert.equal(result.filesDeleted, 1);
  assert.deepEqual(deleted, ['/sendgrid/contacts/contact_123.json']);
});
