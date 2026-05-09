import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IntercomAdapter,
  computeIntercomPath,
  intercomCompanyPath,
  intercomContactPath,
  intercomConversationPath,
  resolveDeleteRequest,
  resolveReadRequest,
  resolveWritebackRequest,
  type ConnectionProvider,
  type IntercomAdapterConfig,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

interface RecordedClient extends RelayFileClientLike {
  deleted: Array<{ path: string; workspaceId: string }>;
  writes: WriteFileInput[];
}

function createClient(): RecordedClient {
  return {
    writes: [],
    deleted: [],
    async writeFile(input) {
      this.writes.push(input);
      return { created: true };
    },
    async deleteFile(input) {
      this.deleted.push(input);
    },
  };
}

function createAdapter(config: IntercomAdapterConfig = {}, client = createClient()): IntercomAdapter {
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
  return new IntercomAdapter(client, provider, config);
}

test('IntercomAdapter exposes provider name and supported webhook events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'intercom');
  assert.deepEqual(adapter.supportedEvents(), [
    'conversation.created',
    'conversation.updated',
    'conversation.deleted',
    'contact.created',
    'contact.updated',
    'contact.deleted',
    'company.created',
    'company.updated',
    'company.deleted',
  ]);
});

test('ingestWebhook writes normalized conversation payloads', async () => {
  const client = createClient();
  const adapter = createAdapter({}, client);

  const result = await adapter.ingestWebhook('workspace_1', {
    provider: 'intercom',
    connectionId: 'conn_intercom',
    eventType: 'conversation.created',
    objectType: 'conversation',
    objectId: 'conv_123',
    payload: {
      id: 'conv_123',
      type: 'conversation',
      state: 'open',
      open: true,
      read: false,
      source: {
        body: 'I need help',
        author: {
          id: 'contact_123',
          type: 'contact',
          email: 'buyer@example.com',
        },
      },
      contacts: {
        data: [
          {
            id: 'contact_123',
            type: 'contact',
            email: 'buyer@example.com',
          },
        ],
      },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(result.filesUpdated, 0);
  assert.equal(result.filesDeleted, 0);
  assert.deepEqual(result.paths, ['/intercom/conversations/conv_123.json']);
  assert.equal(client.writes.length, 1);
  assert.equal(client.writes[0]?.path, '/intercom/conversations/conv_123.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['intercom.state'], 'open');
  assert.deepEqual(client.writes[0]?.semantics?.comments, ['I need help']);
  assert.deepEqual(client.writes[0]?.semantics?.relations, ['/intercom/contacts/contact_123.json']);
});

test('ingestWebhook writes contact payloads from raw Intercom notifications', async () => {
  const client = createClient();
  const adapter = createAdapter({ connectionId: 'conn_configured' }, client);

  const result = await adapter.ingestWebhook('workspace_1', {
    type: 'notification_event',
    topic: 'contact.created',
    app_id: 'app_123',
    created_at: 1_746_600_000,
    data: {
      type: 'notification_event_data',
      item: {
        id: 'contact_123',
        type: 'contact',
        email: 'buyer@example.com',
        name: 'Buyer Example',
        companies: {
          data: [
            {
              id: 'company_123',
              type: 'company',
              name: 'Acme',
            },
          ],
        },
      },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/intercom/contacts/contact_123.json']);
  assert.equal(client.writes[0]?.semantics?.properties?.['intercom.email'], 'buyer@example.com');
  assert.equal(client.writes[0]?.semantics?.properties?.['intercom.company_ids'], 'company_123');
  assert.deepEqual(client.writes[0]?.semantics?.relations, ['/intercom/companies/company_123.json']);
  const content = JSON.parse(client.writes[0]?.content ?? '{}') as Record<string, unknown>;
  assert.equal(content.connectionId, 'conn_configured');
});

test('ingestWebhook writes company payloads and extracts company semantics', async () => {
  const client = createClient();
  const adapter = createAdapter({}, client);

  const result = await adapter.ingestWebhook('workspace_1', {
    provider: 'intercom',
    eventType: 'company.updated',
    objectType: 'company',
    objectId: 'company_123',
    payload: {
      id: 'company_123',
      type: 'company',
      name: 'Acme',
      company_id: 'acme-ext',
      plan: 'enterprise',
      monthly_spend: 5000,
      website: 'https://example.com',
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(result.filesUpdated, 0);
  assert.deepEqual(result.paths, ['/intercom/companies/company_123.json']);
  assert.equal(client.writes[0]?.semantics?.properties?.['intercom.name'], 'Acme');
  assert.equal(client.writes[0]?.semantics?.properties?.['intercom.plan'], 'enterprise');
  assert.equal(client.writes[0]?.semantics?.properties?.['intercom.monthly_spend'], '5000');
});

test('ingestWebhook deletes files for deleted object events', async () => {
  const client = createClient();
  const adapter = createAdapter({}, client);

  const result = await adapter.ingestWebhook('workspace_1', {
    provider: 'intercom',
    eventType: 'contact.deleted',
    objectType: 'contact',
    objectId: 'contact_123',
    payload: {
      id: 'contact_123',
      type: 'contact',
      _webhook: {
        action: 'deleted',
      },
    },
  });

  assert.equal(result.filesDeleted, 1);
  assert.deepEqual(result.paths, ['/intercom/contacts/contact_123.json']);
  assert.equal(client.deleted.length, 1);
  assert.equal(client.deleted[0]?.path, '/intercom/contacts/contact_123.json');
});

test('computeSemantics extracts conversation state, tags, contacts, and comments deterministically', () => {
  const adapter = createAdapter();

  const semantics = adapter.computeSemantics('Conversation', 'conv_123', {
    id: 'conv_123',
    type: 'conversation',
    state: 'open',
    open: true,
    tags: {
      data: [
        { id: 'tag_2', name: 'vip' },
        { id: 'tag_1', name: 'billing' },
      ],
    },
    source: {
      body: 'Initial request',
      author: {
        id: 'contact_123',
        type: 'contact',
      },
    },
    conversation_parts: {
      data: [
        {
          id: 'part_1',
          part_type: 'comment',
          body: 'Follow up',
          author: {
            id: 'contact_123',
            type: 'contact',
          },
        },
      ],
    },
  });

  assert.equal(semantics.properties?.['intercom.state'], 'open');
  assert.equal(semantics.properties?.['intercom.open'], 'true');
  assert.equal(semantics.properties?.['intercom.tags'], 'billing, vip');
  assert.equal(semantics.properties?.['intercom.conversation_part_count'], '1');
  assert.deepEqual(semantics.comments, ['Initial request', 'Follow up']);
  assert.deepEqual(semantics.relations, ['/intercom/contacts/contact_123.json']);
});

test('path mapping stays deterministic for supported Intercom VFS objects', () => {
  const adapter = createAdapter();

  assert.equal(intercomConversationPath('conv 1/2'), '/intercom/conversations/conv%201%2F2.json');
  assert.equal(intercomContactPath('contact:42'), '/intercom/contacts/contact%3A42.json');
  assert.equal(intercomCompanyPath('company#7'), '/intercom/companies/company%237.json');
  assert.equal(computeIntercomPath('Conversation', 'conv 1/2'), '/intercom/conversations/conv%201%2F2.json');
  assert.equal(computeIntercomPath('users', 'contact:42'), '/intercom/contacts/contact%3A42.json');
  assert.equal(computeIntercomPath('companies', 'company#7'), '/intercom/companies/company%237.json');
  assert.equal(adapter.computePath('conversation', 'conv 1/2'), '/intercom/conversations/conv%201%2F2.json');
  assert.equal(adapter.computePath('contact', 'contact:42'), '/intercom/contacts/contact%3A42.json');
  assert.equal(adapter.computePath('company', 'company#7'), '/intercom/companies/company%237.json');
});

test('read request resolver maps Intercom paths to GET API routes', () => {
  assert.deepEqual(resolveReadRequest('/intercom/conversations.json'), {
    action: 'list_conversations',
    method: 'GET',
    endpoint: '/conversations',
  });
  assert.deepEqual(resolveReadRequest('/intercom/contacts/contact_123.json'), {
    action: 'get_contact',
    method: 'GET',
    endpoint: '/contacts/contact_123',
  });
  assert.deepEqual(resolveReadRequest('/intercom/conversations/conv%201%2F2.json'), {
    action: 'get_conversation',
    method: 'GET',
    endpoint: '/conversations/conv%201%2F2',
  });
  assert.deepEqual(resolveReadRequest('/intercom/companies/company_123.json'), {
    action: 'get_company',
    method: 'GET',
    endpoint: '/companies/company_123',
  });
});

test('writeback resolver maps Intercom edit paths to REST mutations', () => {
  assert.deepEqual(resolveWritebackRequest('/intercom/conversations/conv_123/reply.json', '{"message_type":"comment","body":"Thanks"}'), {
    action: 'reply_conversation',
    method: 'POST',
    endpoint: '/conversations/conv_123/reply',
    body: {
      message_type: 'comment',
      body: 'Thanks',
    },
  });
  assert.deepEqual(resolveWritebackRequest('/intercom/conversations/conv%201%2F2/reply.json', '{"body":"Thanks"}'), {
    action: 'reply_conversation',
    method: 'POST',
    endpoint: '/conversations/conv%201%2F2/reply',
    body: {
      body: 'Thanks',
    },
  });
  assert.deepEqual(resolveWritebackRequest('/intercom/contacts/contact_123.json', '{"email":"new@example.com"}'), {
    action: 'update_contact',
    method: 'PUT',
    endpoint: '/contacts/contact_123',
    body: {
      email: 'new@example.com',
    },
  });
  assert.deepEqual(resolveWritebackRequest('/intercom/contacts/draft.contact.json', '{"email":"ada@example.com"}'), {
    action: 'create_contact',
    method: 'POST',
    endpoint: '/contacts',
    body: {
      email: 'ada@example.com',
    },
  });
  assert.throws(
    () => resolveWritebackRequest('/intercom/contacts/contact_123.json', '{"id":"contact_123","email":"new@example.com"}'),
    /read-only/,
  );
  assert.throws(
    () => resolveWritebackRequest('/intercom/contacts/draft.contact.json', '[]'),
    /Expected JSON object payload/,
  );
  assert.deepEqual(resolveDeleteRequest('/intercom/contacts/contact_123.json'), {
    action: 'delete_contact',
    method: 'DELETE',
    endpoint: '/contacts/contact_123',
  });
  assert.throws(
    () => resolveDeleteRequest('/intercom/contacts/draft.contact.json'),
    /No Intercom delete writeback rule matched/,
  );
});
