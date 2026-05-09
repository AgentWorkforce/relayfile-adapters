import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ZendeskAdapter,
  computeZendeskPath,
  normalizeZendeskWebhook,
  resolveDeleteRequest,
  resolveWritebackRequest,
  zendeskOrganizationPath,
  zendeskTicketPath,
  zendeskUserPath,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';
import { ReadOnlyFieldError } from '../writeback.js';

function createProvider(): ConnectionProvider {
  return {
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
}

function createAdapter(captures: WriteFileInput[] = []): ZendeskAdapter {
  const client: RelayFileClientLike = {
    async writeFile(input) {
      captures.push(input);
      return undefined;
    },
    async deleteFile() {
      return undefined;
    },
  };
  return new ZendeskAdapter(client, createProvider(), { connectionId: 'conn_zendesk_123' });
}

test('ZendeskAdapter exposes the provider name and supported Zendesk webhook events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'zendesk');
  assert.deepEqual(adapter.supportedEvents(), [
    'ticket.created',
    'ticket.updated',
    'ticket.deleted',
    'user.created',
    'user.updated',
    'user.deleted',
    'organization.created',
    'organization.updated',
    'organization.deleted',
  ]);
});

test('ingestWebhook writes normalized ticket callbacks to deterministic paths', async () => {
  const captures: WriteFileInput[] = [];
  const adapter = createAdapter(captures);
  const normalized = normalizeZendeskWebhook({
    event_type: 'ticket.created',
    ticket: {
      id: 123,
      subject: 'Cannot log in',
      status: 'open',
      priority: 'high',
      requester_id: 456,
      organization_id: 789,
      tags: ['auth', 'urgent'],
    },
  });

  const result = await adapter.ingestWebhook('workspace_123', normalized);

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/zendesk/tickets/123.json']);
  assert.equal(captures.length, 1);
  assert.equal(captures[0]?.path, '/zendesk/tickets/123.json');
  assert.equal(captures[0]?.semantics?.properties?.['zendesk.status'], 'open');
  assert.deepEqual(captures[0]?.semantics?.relations, [
    '/zendesk/organizations/789.json',
    '/zendesk/users/456.json',
  ]);
});

test('ingestWebhook writes user callbacks and extracts organization relation', async () => {
  const captures: WriteFileInput[] = [];
  const adapter = createAdapter(captures);

  const result = await adapter.ingestWebhook('workspace_123', {
    action: 'updated',
    type: 'user',
    user: {
      id: 456,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'agent',
      active: true,
      organization_id: 789,
      tags: ['vip', 'beta'],
    },
  });

  assert.equal(result.filesWritten, 0);
  assert.equal(result.filesUpdated, 1);
  assert.deepEqual(result.paths, ['/zendesk/users/456.json']);
  assert.equal(captures[0]?.semantics?.properties?.['zendesk.email'], 'ada@example.com');
  assert.deepEqual(captures[0]?.semantics?.relations, ['/zendesk/organizations/789.json']);
});

test('ingestWebhook writes organization callbacks with domain metadata', async () => {
  const captures: WriteFileInput[] = [];
  const adapter = createAdapter(captures);

  const result = await adapter.ingestWebhook('workspace_123', {
    action: 'created',
    type: 'organization',
    organization: {
      id: 789,
      name: 'Acme',
      domain_names: ['acme.com', 'support.acme.com'],
      shared_tickets: true,
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/zendesk/organizations/789.json']);
  assert.equal(captures[0]?.semantics?.properties?.['zendesk.name'], 'Acme');
  assert.equal(captures[0]?.semantics?.properties?.['zendesk.domain_count'], '2');
});

test('computeSemantics extracts ticket fields, comments, tags, and relations deterministically', () => {
  const adapter = createAdapter();

  const semantics = adapter.computeSemantics('ticket', '123', {
    id: 123,
    subject: 'Cannot log in',
    description: 'Customer cannot access account.',
    priority: 'high',
    status: 'pending',
    requester: {
      id: 456,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    },
    assignee_id: 111,
    organization: {
      id: 789,
      name: 'Acme',
    },
    tags: ['urgent', 'auth', 'urgent'],
    custom_fields: [
      { id: 10, value: 'enterprise' },
      { id: 11, value: true },
    ],
    comments: [
      { author_id: 456, body: 'Initial request', public: true },
      { author_id: 111, body: 'Investigating', public: false },
    ],
  });

  assert.equal(semantics.properties?.['zendesk.subject'], 'Cannot log in');
  assert.equal(semantics.properties?.['zendesk.tags'], 'auth, urgent');
  assert.equal(semantics.properties?.['zendesk.custom_fields'], '10:enterprise, 11:true');
  assert.deepEqual(semantics.relations, [
    '/zendesk/organizations/789.json',
    '/zendesk/users/111.json',
    '/zendesk/users/456.json',
  ]);
  assert.deepEqual(semantics.comments, ['Initial request', 'Investigating']);
});

test('path mapping stays deterministic for supported Zendesk VFS objects', () => {
  const adapter = createAdapter();

  assert.equal(zendeskTicketPath('123', 'Cannot log in'), '/zendesk/tickets/123.json');
  assert.equal(zendeskTicketPath('ticket 1/2'), '/zendesk/tickets/ticket%201%2F2.json');
  assert.equal(zendeskUserPath('user@example.com'), '/zendesk/users/user%40example.com.json');
  assert.equal(zendeskOrganizationPath('org#7'), '/zendesk/organizations/org%237.json');

  assert.equal(computeZendeskPath('Ticket', '123', 'Cannot log in'), '/zendesk/tickets/123.json');
  assert.equal(computeZendeskPath('users', '456'), '/zendesk/users/456.json');
  assert.equal(computeZendeskPath('organizations', '789'), '/zendesk/organizations/789.json');

  assert.equal(adapter.computePath('ticket', '123', 'Cannot log in'), '/zendesk/tickets/123.json');
  assert.equal(adapter.computePath('user', '456'), '/zendesk/users/456.json');
  assert.equal(adapter.computePath('organization', '789'), '/zendesk/organizations/789.json');

  assert.deepEqual(resolveWritebackRequest('/zendesk/tickets/draft-ticket.json', '{"subject":"New ticket"}'), {
    action: 'create_ticket',
    method: 'POST',
    endpoint: '/api/v2/tickets.json',
    body: { ticket: { subject: 'New ticket' } },
  });
  assert.deepEqual(resolveWritebackRequest('/zendesk/tickets/123.json', '{"subject":"Renamed"}'), {
    action: 'update_ticket',
    method: 'PUT',
    endpoint: '/api/v2/tickets/123.json',
    body: { ticket: { subject: 'Renamed' } },
  });
  assert.throws(
    () => resolveWritebackRequest('/zendesk/tickets/123.json', '{"id":"123","subject":"Renamed"}'),
    (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'id',
  );
  assert.throws(
    () => resolveWritebackRequest('/zendesk/tickets/draft-ticket.json', '{"description":"Missing subject"}'),
    /requires a `subject`/,
  );
  assert.deepEqual(resolveDeleteRequest('/zendesk/tickets/123.json'), {
    action: 'delete_ticket',
    method: 'DELETE',
    endpoint: '/api/v2/tickets/123.json',
  });
  assert.throws(
    () => resolveDeleteRequest('/zendesk/tickets/draft-ticket.json'),
    /No Zendesk delete writeback rule matched/,
  );

  // Pins a CodeRabbit Review finding: ticket/user create previously called
  // rejectReadOnlyFields BEFORE unwrapping the {ticket: ...} envelope, so a
  // payload like {ticket: {id: "...", ...}} would smuggle a read-only id
  // through. Order is now unwrap → reject.
  assert.throws(
    () =>
      resolveWritebackRequest(
        '/zendesk/tickets/draft-ticket.json',
        JSON.stringify({ ticket: { id: '999', subject: 'Smuggled' } }),
      ),
    (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'id',
  );
  assert.throws(
    () =>
      resolveWritebackRequest(
        '/zendesk/users/draft-user.json',
        JSON.stringify({ user: { id: '999', name: 'Smuggled' } }),
      ),
    (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'id',
  );
  // Pins a CodeRabbit Review finding: organization update was the only mutable
  // zendesk path that didn't call rejectReadOnlyFields, silently letting `id`
  // through as a generic error instead of a precise ReadOnlyFieldError.
  assert.throws(
    () =>
      resolveWritebackRequest(
        '/zendesk/organizations/123.json',
        JSON.stringify({ organization: { id: '999', name: 'Renamed' } }),
      ),
    (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'id',
  );

  // Pins a CodeRabbit Review finding: organizations aren't a declared resource,
  // so classifyWrite never gates them. Without an inline canonical-id check,
  // /zendesk/organizations/draft-org.json would silently PUT to a draft id.
  assert.throws(
    () => resolveWritebackRequest('/zendesk/organizations/draft-org.json', '{}'),
    /No Zendesk writeback rule matched/,
  );
  assert.throws(
    () => resolveDeleteRequest('/zendesk/organizations/draft-org.json'),
    /No Zendesk delete writeback rule matched/,
  );
});

test('barrel exports import cleanly for runtime and type-checked usage', async () => {
  const barrel = await import('../index.js');

  assert.equal(barrel.ZendeskAdapter, ZendeskAdapter);
  assert.equal(barrel.computeZendeskPath, computeZendeskPath);
  assert.equal(typeof barrel.normalizeZendeskWebhook, 'function');
  assert.equal(typeof barrel.validateZendeskWebhookSignature, 'function');
});
