import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MailgunAdapter,
  computeMailgunPath,
  mailgunEventPath,
  mailgunListPath,
  mailgunMessagePath,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

function createAdapter(writes: WriteFileInput[] = []): MailgunAdapter {
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push(input);
      return { created: true };
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

  return new MailgunAdapter(client, provider, {
    connectionId: 'conn_mailgun_123',
    defaultDomain: 'mg.example.com',
  });
}

test('MailgunAdapter exposes provider name and supported events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'mailgun');
  assert.equal(adapter.supportedEvents().includes('message.delivered'), true);
  assert.equal(adapter.supportedEvents().includes('event.failed'), true);
  assert.equal(adapter.supportedEvents().includes('list.updated'), true);
});

test('ingestWebhook writes message payloads to the message VFS path', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter(writes);

  const result = await adapter.ingestWebhook('workspace_123', {
    event: 'stored',
    domain: 'mg.example.com',
    data: {
      id: '<20260507120000.abc@mg.example.com>',
      subject: 'Adapter launched',
      from: 'ops@example.com',
      to: ['customer@example.net'],
      tags: ['launch', 'adapter'],
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(writes[0]?.path, '/mailgun/domains/mg.example.com/messages/%3C20260507120000.abc%40mg.example.com%3E.json');
  assert.equal(writes[0]?.semantics?.properties?.['mailgun.subject'], 'Adapter launched');
  assert.equal(writes[0]?.semantics?.relations?.includes('mailto:customer@example.net'), true);
});

test('ingestWebhook writes event-data payloads as Mailgun events', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter(writes);

  const result = await adapter.ingestWebhook('workspace_123', {
    signature: {
      timestamp: '1778140800',
      token: 'token_123',
      signature: '0'.repeat(64),
    },
    'event-data': {
      id: 'event_123',
      event: 'failed',
      domain: 'mg.example.com',
      recipient: 'user@example.net',
      severity: 'permanent',
      message: {
        id: 'message_123',
        subject: 'Delivery notice',
      },
      'delivery-status': {
        code: 550,
        message: 'Mailbox unavailable',
      },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(writes[0]?.path, '/mailgun/domains/mg.example.com/events/event_123.json');
  assert.equal(writes[0]?.semantics?.properties?.['mailgun.event'], 'failed');
  assert.equal(writes[0]?.semantics?.properties?.['mailgun.event_category'], 'risk');
  assert.equal(writes[0]?.semantics?.relations?.includes('/mailgun/domains/mg.example.com/messages/message_123.json'), true);
});

test('ingestWebhook writes mailing list payloads to list paths', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter(writes);

  const result = await adapter.ingestWebhook('workspace_123', {
    data: {
      address: 'news@mg.example.com',
      name: 'News',
      description: 'Customer announcements',
      members_count: 42,
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(writes[0]?.path, '/mailgun/lists/news%40mg.example.com.json');
  assert.equal(writes[0]?.semantics?.properties?.['mailgun.list.members_count'], '42');
});

test('computeSemantics extracts deterministic event metadata and relations', () => {
  const adapter = createAdapter();

  const semantics = adapter.computeSemantics('event', 'event_456', {
    id: 'event_456',
    event: 'opened',
    domain: 'mg.example.com',
    recipient: 'reader@example.net',
    tags: ['newsletter', 'q2'],
    message: {
      id: 'message_456',
      subject: 'Quarterly report',
    },
  });

  assert.equal(semantics.properties?.['mailgun.event_category'], 'engagement');
  assert.equal(semantics.properties?.['mailgun.tags'], 'newsletter, q2');
  assert.deepEqual(semantics.relations, [
    '/mailgun/domains/mg.example.com/messages/message_456.json',
    'mailto:reader@example.net',
  ]);
});

test('path mapping stays deterministic for Mailgun VFS objects', () => {
  const adapter = createAdapter();

  assert.equal(mailgunMessagePath('msg/1', 'mg.example.com'), '/mailgun/domains/mg.example.com/messages/msg%2F1.json');
  assert.equal(mailgunEventPath('event:1', 'mg.example.com'), '/mailgun/domains/mg.example.com/events/event%3A1.json');
  assert.equal(mailgunListPath('news@mg.example.com'), '/mailgun/lists/news%40mg.example.com.json');
  assert.equal(computeMailgunPath('messages', 'msg 2', 'mg.example.com'), '/mailgun/domains/mg.example.com/messages/msg%202.json');
  assert.equal(computeMailgunPath('events', 'event 2', 'mg.example.com'), '/mailgun/domains/mg.example.com/events/event%202.json');
  assert.equal(adapter.computePath('mailing-lists', 'news@mg.example.com'), '/mailgun/lists/news%40mg.example.com.json');
});
