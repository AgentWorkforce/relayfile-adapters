import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HubSpotAdapter,
  computeHubSpotPath,
  hubSpotCompanyPath,
  hubSpotContactPath,
  hubSpotDealPath,
  hubSpotTicketPath,
  resolveHubSpotDeleteRequest,
  resolveHubSpotWritebackRequest,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';
import { ReadOnlyFieldError } from '../writeback.js';

interface CapturedClient extends RelayFileClientLike {
  deleted: string[];
  writes: WriteFileInput[];
}

function createClient(): CapturedClient {
  return {
    deleted: [],
    writes: [],
    async deleteFile(input) {
      this.deleted.push(input.path);
    },
    async writeFile(input) {
      this.writes.push(input);
      return { created: true };
    },
  };
}

function createProvider(): ConnectionProvider {
  return {
    name: 'hubspot-test-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return {
        data: null as never,
        headers: {},
        status: 200,
      };
    },
    async healthCheck() {
      return true;
    },
  };
}

function createAdapter(client = createClient()): HubSpotAdapter {
  return new HubSpotAdapter(client, createProvider(), {
    connectionId: 'conn_hubspot_123',
    providerConfigKey: 'hubspot-primary',
  });
}

test('HubSpotAdapter exposes provider name and supported webhook events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'hubspot');
  assert.deepEqual(adapter.supportedEvents(), [
    'contact.created',
    'contact.propertyChange',
    'contact.deleted',
    'contact.merged',
    'contact.associationChange',
    'company.created',
    'company.propertyChange',
    'company.deleted',
    'company.merged',
    'company.associationChange',
    'deal.created',
    'deal.propertyChange',
    'deal.deleted',
    'deal.merged',
    'deal.associationChange',
    'ticket.created',
    'ticket.propertyChange',
    'ticket.deleted',
    'ticket.merged',
    'ticket.associationChange',
  ]);
});

test('ingestWebhook writes contact webhook payloads to deterministic contact paths', async () => {
  const client = createClient();
  const adapter = createAdapter(client);

  const result = await adapter.ingestWebhook('workspace_123', {
    eventType: 'contact.created',
    objectId: '101',
    objectType: 'contact',
    payload: {
      id: '101',
      properties: {
        email: 'ada@example.com',
        firstname: 'Ada',
        lastname: 'Lovelace',
      },
    },
    provider: 'hubspot',
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(client.writes[0]?.path, '/hubspot/contacts/101.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['hubspot.contact.email'], 'ada@example.com');
});

test('ingestWebhook writes company webhook payloads and extracts company semantics', async () => {
  const client = createClient();
  const adapter = createAdapter(client);

  const result = await adapter.ingestWebhook('workspace_123', {
    eventType: 'company.propertyChange',
    objectId: '201',
    objectType: 'company',
    payload: {
      id: '201',
      properties: {
        domain: 'example.com',
        industry: 'Software',
        name: 'Example Inc',
      },
    },
    provider: 'hubspot',
  });

  assert.equal(result.paths[0], '/hubspot/companies/201.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['hubspot.company.name'], 'Example Inc');
  assert.deepEqual(client.writes[0]?.semantics?.relations, ['domain:example.com']);
});

test('ingestWebhook writes deal webhook payloads and association relations', async () => {
  const client = createClient();
  const adapter = createAdapter(client);

  await adapter.ingestWebhook('workspace_123', {
    eventType: 'deal.propertyChange',
    objectId: '301',
    objectType: 'deal',
    payload: {
      associations: {
        companies: [{ id: '201' }],
        contacts: [{ id: '101' }],
      },
      id: '301',
      properties: {
        amount: '4200',
        dealname: 'Annual renewal',
        dealstage: 'contractsent',
      },
    },
    provider: 'hubspot',
  });

  assert.equal(client.writes[0]?.path, '/hubspot/deals/301.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['hubspot.deal.amount'], '4200');
  assert.deepEqual(client.writes[0]?.semantics?.relations, [
    '/hubspot/companies/201.json',
    '/hubspot/contacts/101.json',
  ]);
});

test('ingestWebhook writes ticket webhook payloads and captures ticket comments', async () => {
  const client = createClient();
  const adapter = createAdapter(client);

  await adapter.ingestWebhook('workspace_123', {
    eventType: 'ticket.created',
    objectId: '401',
    objectType: 'ticket',
    payload: {
      id: '401',
      properties: {
        content: 'Customer cannot access billing settings.',
        hs_ticket_priority: 'HIGH',
        subject: 'Billing access',
      },
    },
    provider: 'hubspot',
  });

  assert.equal(client.writes[0]?.path, '/hubspot/tickets/401.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['hubspot.ticket.subject'], 'Billing access');
  assert.deepEqual(client.writes[0]?.semantics?.comments, [
    'Customer cannot access billing settings.',
    'ticket_priority:HIGH',
  ]);
});

test('ingestWebhook normalizes HubSpot webhook batches and writes each primary object', async () => {
  const client = createClient();
  const adapter = createAdapter(client);

  const result = await adapter.ingestWebhook('workspace_123', [
    { objectId: 101, subscriptionType: 'contact.creation' },
    { objectId: 201, subscriptionType: 'company.creation' },
    { objectId: 301, subscriptionType: 'deal.creation' },
    { objectId: 401, subscriptionType: 'ticket.creation' },
  ]);

  assert.equal(result.filesWritten, 4);
  assert.deepEqual(client.writes.map((write) => write.path), [
    '/hubspot/contacts/101.json',
    '/hubspot/companies/201.json',
    '/hubspot/deals/301.json',
    '/hubspot/tickets/401.json',
  ]);
});

test('computeSemantics extracts deal fields, ticket fields, and sorted associations', () => {
  const adapter = createAdapter();

  const dealSemantics = adapter.computeSemantics('deal', '301', {
    associations: {
      companies: [{ id: '201' }],
      contacts: [{ id: '101' }],
    },
    properties: {
      amount: '9000',
      dealname: 'Expansion',
      dealstage: 'closedwon',
      pipeline: 'default',
    },
  });

  assert.equal(dealSemantics.properties?.['hubspot.deal.name'], 'Expansion');
  assert.equal(dealSemantics.properties?.['hubspot.deal.stage'], 'closedwon');
  assert.deepEqual(dealSemantics.relations, [
    '/hubspot/companies/201.json',
    '/hubspot/contacts/101.json',
  ]);

  const ticketSemantics = adapter.computeSemantics('ticket', '401', {
    properties: {
      hs_pipeline_stage: 'waiting_on_contact',
      hs_ticket_priority: 'LOW',
      subject: 'Question',
    },
  });
  assert.equal(ticketSemantics.properties?.['hubspot.ticket.stage'], 'waiting_on_contact');
  assert.equal(ticketSemantics.properties?.['hubspot.ticket.priority'], 'LOW');
});

test('path mapping stays deterministic for supported HubSpot VFS objects', () => {
  const adapter = createAdapter();

  assert.equal(hubSpotContactPath('contact 1/2'), '/hubspot/contacts/contact%201%2F2.json');
  assert.equal(hubSpotCompanyPath('company#7'), '/hubspot/companies/company%237.json');
  assert.equal(hubSpotDealPath('deal:42'), '/hubspot/deals/deal%3A42.json');
  assert.equal(hubSpotTicketPath('ticket@example.com'), '/hubspot/tickets/ticket%40example.com.json');
  assert.equal(computeHubSpotPath('contacts', '101'), '/hubspot/contacts/101.json');
  assert.equal(computeHubSpotPath('Companies', '201'), '/hubspot/companies/201.json');
  assert.equal(computeHubSpotPath('deal', '301'), '/hubspot/deals/301.json');
  assert.equal(computeHubSpotPath('tickets', '401'), '/hubspot/tickets/401.json');
  assert.equal(adapter.computePath('HubSpotContact', '101'), '/hubspot/contacts/101.json');
  assert.equal(adapter.computePath('HubSpotCompany', '201'), '/hubspot/companies/201.json');

  assert.deepEqual(resolveHubSpotWritebackRequest('/hubspot/contacts/draft-contact.json', '{"email":"ada@example.com"}'), {
    action: 'create_contact',
    body: { properties: { email: 'ada@example.com' } },
    endpoint: '/crm/v3/objects/contacts',
    method: 'POST',
  });
  assert.deepEqual(resolveHubSpotWritebackRequest('/hubspot/contacts/101.json', '{"email":"new@example.com"}'), {
    action: 'update_contact',
    body: { properties: { email: 'new@example.com' } },
    endpoint: '/crm/v3/objects/contacts/101',
    method: 'PATCH',
  });
  assert.throws(
    () => resolveHubSpotWritebackRequest('/hubspot/contacts/101.json', '{"id":"101","email":"new@example.com"}'),
    (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'id',
  );
  assert.throws(
    () => resolveHubSpotWritebackRequest('/hubspot/contacts/draft-contact.json', '{}'),
    /requires at least one writable property/,
  );
  assert.deepEqual(resolveHubSpotDeleteRequest('/hubspot/contacts/101.json'), {
    action: 'delete_contact',
    endpoint: '/crm/v3/objects/contacts/101',
    method: 'DELETE',
  });
  assert.throws(
    () => resolveHubSpotDeleteRequest('/hubspot/contacts/draft-contact.json'),
    /No HubSpot delete writeback rule matched/,
  );
});
