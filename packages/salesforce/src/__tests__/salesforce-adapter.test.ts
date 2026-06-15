import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SalesforceAdapter,
  computeSalesforcePath,
  resolveDeleteRequest,
  resolveReadRequest,
  resolveWritebackRequest,
  salesforceAccountPath,
  salesforceCasePath,
  salesforceContactPath,
  salesforceLeadPath,
  salesforceOpportunityPath,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type ReadFileResult,
  type RelayFileClientLike,
  type SalesforceAdapterConfig,
  type WriteFileInput,
} from '../index.js';
import { ReadOnlyFieldError } from '../writeback.js';

interface CapturingClient extends RelayFileClientLike {
  deleted: string[];
  files: Map<string, string>;
  writes: WriteFileInput[];
}

function createClient(): CapturingClient {
  return {
    deleted: [],
    files: new Map(),
    writes: [],
    async writeFile(input: WriteFileInput) {
      this.writes.push(input);
      this.files.set(input.path, input.content);
      return { created: true };
    },
    async readFile(input): Promise<ReadFileResult | undefined> {
      const content = this.files.get(input.path);
      return content ? { content } : undefined;
    },
    async deleteFile(input) {
      this.deleted.push(input.path);
    },
  };
}

function createProvider(
  proxy: (request: ProxyRequest) => Promise<ProxyResponse> = async () => ({
    status: 200,
    headers: {},
    data: null,
  }),
): ConnectionProvider & { requests: ProxyRequest[] } {
  const requests: ProxyRequest[] = [];
  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
      requests.push(request);
      return proxy(request) as Promise<ProxyResponse<T>>;
    },
    async healthCheck() {
      return true;
    },
  };
  return Object.assign(provider, { requests });
}

function createAdapter(config: SalesforceAdapterConfig = {}, client = createClient()): SalesforceAdapter {
  const provider = createProvider();
  return new SalesforceAdapter(client, provider, config);
}

test('SalesforceAdapter exposes provider metadata and supported events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'salesforce');
  assert.deepEqual(adapter.supportedEvents(), [
    'Account.created',
    'Account.updated',
    'Account.deleted',
    'Account.upserted',
    'Contact.created',
    'Contact.updated',
    'Contact.deleted',
    'Contact.upserted',
    'Opportunity.created',
    'Opportunity.updated',
    'Opportunity.deleted',
    'Opportunity.upserted',
    'Lead.created',
    'Lead.updated',
    'Lead.deleted',
    'Lead.upserted',
    'Lead.converted',
    'Case.created',
    'Case.updated',
    'Case.deleted',
    'Case.upserted',
    'Case.closed',
  ]);
});

test('path mapping stays deterministic for every Salesforce object type', () => {
  const adapter = createAdapter();

  assert.equal(salesforceAccountPath('001 xx/42'), '/salesforce/accounts/001%20xx%2F42.json');
  assert.equal(salesforceContactPath('003:42'), '/salesforce/contacts/003%3A42.json');
  assert.equal(salesforceOpportunityPath('006#7'), '/salesforce/opportunities/006%237.json');
  assert.equal(salesforceLeadPath('00Q lead'), '/salesforce/leads/00Q%20lead.json');
  assert.equal(salesforceCasePath('500/case'), '/salesforce/cases/500%2Fcase.json');

  assert.equal(computeSalesforcePath('accounts', '001A'), '/salesforce/accounts/001A.json');
  assert.equal(computeSalesforcePath('Contact', '003A'), '/salesforce/contacts/003A.json');
  assert.equal(computeSalesforcePath('opportunities', '006A'), '/salesforce/opportunities/006A.json');
  assert.equal(computeSalesforcePath('SalesforceLead', '00QA'), '/salesforce/leads/00QA.json');
  assert.equal(computeSalesforcePath('case', '500A'), '/salesforce/cases/500A.json');
  assert.equal(adapter.computePath('Account', '001A'), '/salesforce/accounts/001A.json');
});

test('ingestWebhook writes Account payloads with account semantics', async () => {
  const client = createClient();
  const adapter = createAdapter({}, client);

  const result = await adapter.ingestWebhook('workspace_1', {
    provider: 'salesforce',
    eventType: 'Account.created',
    objectType: 'Account',
    objectId: '001A',
    payload: {
      Id: '001A',
      Name: 'Acme',
      Industry: 'Manufacturing',
      AnnualRevenue: 1000000,
      ParentId: '001P',
      Description: 'Strategic account',
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(client.writes[0]?.path, '/salesforce/accounts/001A.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.account.industry'], 'Manufacturing');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.account.annual_revenue'], '1000000');
  assert.deepEqual(client.writes[0]?.semantics?.relations, ['/salesforce/accounts/001P.json']);
  assert.deepEqual(client.writes[0]?.semantics?.comments, ['Strategic account']);
});

test('ingestWebhook writes Contact payloads and links the parent Account', async () => {
  const client = createClient();
  const adapter = createAdapter({}, client);

  const result = await adapter.ingestWebhook('workspace_1', {
    action: 'updated',
    type: 'Contact',
    data: {
      Id: '003A',
      Name: 'Ada Lovelace',
      Email: 'ada@example.com',
      AccountId: '001A',
      Title: 'CTO',
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(client.writes[0]?.path, '/salesforce/contacts/003A.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.contact.email'], 'ada@example.com');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.contact.title'], 'CTO');
  assert.deepEqual(client.writes[0]?.semantics?.relations, ['/salesforce/accounts/001A.json']);
});

test('ingestWebhook writes Opportunity payloads with revenue and stage semantics', async () => {
  const client = createClient();
  const adapter = createAdapter({}, client);

  await adapter.ingestWebhook('workspace_1', {
    action: 'updated',
    type: 'Opportunity',
    data: {
      Id: '006A',
      Name: 'Expansion',
      StageName: 'Negotiation/Review',
      Amount: 50000,
      Probability: 60,
      Account: { Id: '001A', Name: 'Acme' },
    },
  });

  assert.equal(client.writes[0]?.path, '/salesforce/opportunities/006A.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.opportunity.stage'], 'Negotiation/Review');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.opportunity.amount'], '50000');
  assert.deepEqual(client.writes[0]?.semantics?.relations, ['/salesforce/accounts/001A.json']);
});

test('ingestWebhook re-fetches a full Salesforce SObject before writing update records', async () => {
  const client = createClient();
  const provider = createProvider(async (request) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.baseUrl, 'https://acme.my.salesforce.com');
    assert.equal(request.connectionId, 'conn-salesforce');
    assert.deepEqual(request.headers, { 'Provider-Config-Key': 'salesforce-prod' });
    assert.equal(request.endpoint, '/services/data/v61.0/sobjects/Opportunity/006A');
    return {
      status: 200,
      headers: {},
      data: {
        Id: '006A',
        Name: 'Expansion',
        StageName: 'Closed Won',
        Amount: 125000,
        OwnerId: '005OWNER',
        Custom_Field__c: 'authoritative',
        LastModifiedDate: '2026-06-15T20:00:00.000+0000',
      },
    };
  });
  const adapter = new SalesforceAdapter(client, provider, {
    apiVersion: 'v61.0',
    connectionId: 'conn-salesforce',
    instanceUrl: 'https://acme.my.salesforce.com',
  });

  const result = await adapter.ingestWebhook('workspace_1', {
    provider: 'salesforce',
    eventType: 'Opportunity.updated',
    objectType: 'Opportunity',
    objectId: '006A',
    payload: {
      Id: '006A',
      StageName: 'Closed Won',
      _connection: { providerConfigKey: 'salesforce-prod' },
      _webhook: { action: 'updated', eventType: 'Opportunity.updated' },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0]?.endpoint, '/services/data/v61.0/sobjects/Opportunity/006A');
  const written = JSON.parse(client.writes[0]?.content ?? '{}') as Record<string, unknown>;
  const payload = written.payload as Record<string, unknown>;
  assert.equal(payload.Name, 'Expansion');
  assert.equal(payload.Amount, 125000);
  assert.equal(payload.OwnerId, '005OWNER');
  assert.equal(payload.Custom_Field__c, 'authoritative');
  assert.deepEqual(payload._webhook, { action: 'updated', eventType: 'Opportunity.updated' });
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.opportunity.stage'], 'Closed Won');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.owner_id'], '005OWNER');
});

test('ingestWebhook falls back to merging CDC deltas onto the existing record when re-fetch fails', async () => {
  const client = createClient();
  const path = '/salesforce/opportunities/006A.json';
  client.files.set(
    path,
    JSON.stringify({
      provider: 'salesforce',
      payload: {
        Id: '006A',
        Name: 'Expansion',
        StageName: 'Prospecting',
        Amount: 50000,
        OwnerId: '005OLD',
      },
    }),
  );
  const provider = createProvider(async () => ({
    status: 503,
    headers: {},
    data: { message: 'Service unavailable' },
  }));
  const adapter = new SalesforceAdapter(client, provider, {
    connectionId: 'conn-salesforce',
    instanceUrl: 'https://acme.my.salesforce.com',
  });

  await adapter.ingestWebhook('workspace_1', {
    provider: 'salesforce',
    eventType: 'Opportunity.updated',
    objectType: 'Opportunity',
    objectId: '006A',
    payload: {
      Id: '006A',
      StageName: 'Negotiation/Review',
      _webhook: { action: 'updated', eventType: 'Opportunity.updated' },
    },
  });

  assert.ok(provider.requests.length >= 1);
  assert.equal(provider.requests[0]?.endpoint, '/services/data/v62.0/sobjects/Opportunity/006A');
  const written = JSON.parse(client.writes[0]?.content ?? '{}') as Record<string, unknown>;
  const payload = written.payload as Record<string, unknown>;
  assert.equal(payload.Name, 'Expansion');
  assert.equal(payload.StageName, 'Negotiation/Review');
  assert.equal(payload.Amount, 50000);
  assert.equal(payload.OwnerId, '005OLD');
  assert.deepEqual(payload._webhook, { action: 'updated', eventType: 'Opportunity.updated' });
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.opportunity.stage'], 'Negotiation/Review');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.opportunity.amount'], '50000');
});

test('ingestWebhook strips stale _webhook from existing record during fallback merge', async () => {
  const client = createClient();
  const path = '/salesforce/opportunities/006A.json';
  client.files.set(
    path,
    JSON.stringify({
      provider: 'salesforce',
      payload: {
        Id: '006A',
        Name: 'Expansion',
        StageName: 'Prospecting',
        Amount: 50000,
        // stale _webhook from a previous create event
        _webhook: { action: 'created', eventType: 'Opportunity.created' },
      },
    }),
  );
  const provider = createProvider(async () => ({
    status: 503,
    headers: {},
    data: { message: 'Service unavailable' },
  }));
  const adapter = new SalesforceAdapter(client, provider, {
    connectionId: 'conn-salesforce',
    instanceUrl: 'https://acme.my.salesforce.com',
  });

  // incoming update webhook — no _webhook key in the payload
  await adapter.ingestWebhook('workspace_1', {
    provider: 'salesforce',
    eventType: 'Opportunity.updated',
    objectType: 'Opportunity',
    objectId: '006A',
    payload: {
      Id: '006A',
      StageName: 'Negotiation/Review',
    },
  });

  const written = JSON.parse(client.writes[0]?.content ?? '{}') as Record<string, unknown>;
  const payload = written.payload as Record<string, unknown>;
  assert.equal(payload.Name, 'Expansion');
  assert.equal(payload.StageName, 'Negotiation/Review');
  // stale _webhook must NOT survive into the merged payload
  assert.equal(payload._webhook, undefined);
});

test('ingestWebhook writes Lead payloads and records conversion relations', async () => {
  const client = createClient();
  const adapter = createAdapter({}, client);

  await adapter.ingestWebhook('workspace_1', {
    action: 'updated',
    type: 'Lead',
    data: {
      Id: '00QA',
      Name: 'Grace Hopper',
      Company: 'Compiler Co',
      Status: 'Qualified',
      IsConverted: true,
      ConvertedAccountId: '001A',
      ConvertedContactId: '003A',
      ConvertedOpportunityId: '006A',
    },
  });

  assert.equal(client.writes[0]?.path, '/salesforce/leads/00QA.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.lead.status'], 'Qualified');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.lead.is_converted'], 'true');
  assert.deepEqual(client.writes[0]?.semantics?.relations, [
    '/salesforce/accounts/001A.json',
    '/salesforce/contacts/003A.json',
    '/salesforce/opportunities/006A.json',
  ]);
});

test('ingestWebhook writes Case payloads and links account and contact records', async () => {
  const client = createClient();
  const adapter = createAdapter({}, client);

  await adapter.ingestWebhook('workspace_1', {
    action: 'updated',
    type: 'Case',
    data: {
      Id: '500A',
      CaseNumber: '00001001',
      Subject: 'Cannot log in',
      Status: 'Working',
      Priority: 'High',
      AccountId: '001A',
      ContactId: '003A',
      Description: 'Customer cannot access the portal.',
    },
  });

  assert.equal(client.writes[0]?.path, '/salesforce/cases/500A.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.case.status'], 'Working');
  assert.equal(client.writes[0]?.semantics?.properties?.['salesforce.case.priority'], 'High');
  assert.deepEqual(client.writes[0]?.semantics?.relations, [
    '/salesforce/accounts/001A.json',
    '/salesforce/contacts/003A.json',
  ]);
});

test('delete webhooks use deleteFile when available', async () => {
  const client = createClient();
  const adapter = createAdapter({}, client);

  const result = await adapter.ingestWebhook('workspace_1', {
    action: 'deleted',
    type: 'Account',
    data: { Id: '001A', Name: 'Acme' },
  });

  assert.equal(result.filesDeleted, 1);
  assert.deepEqual(client.deleted, ['/salesforce/accounts/001A.json']);
  assert.equal(client.writes.length, 0);
});

test('read and writeback route resolution maps VFS paths to Salesforce REST requests', () => {
  assert.deepEqual(resolveReadRequest('/salesforce/accounts/001A.json'), {
    action: 'get_account',
    method: 'GET',
    endpoint: '/services/data/v62.0/sobjects/Account/001A',
  });
  // Collection reads must route through SOQL; the sObject metadata route
  // (e.g. /sobjects/Contact) describes the schema and returns no records.
  assert.deepEqual(resolveReadRequest('/salesforce/contacts'), {
    action: 'list_contacts',
    method: 'GET',
    endpoint: '/services/data/v62.0/query',
    query: { q: 'SELECT Id, FirstName, LastName, Email FROM Contact' },
  });

  assert.deepEqual(resolveWritebackRequest('/salesforce/accounts/draft-account.json', '{"Name":"Acme"}'), {
    action: 'create_account',
    method: 'POST',
    endpoint: '/services/data/v62.0/sobjects/Account',
    body: { Name: 'Acme' },
  });
  assert.deepEqual(resolveWritebackRequest('/salesforce/contacts/003000000000000AAA.json', '{"Title":"CEO"}'), {
    action: 'update_contact',
    method: 'PATCH',
    endpoint: '/services/data/v62.0/sobjects/Contact/003000000000000AAA',
    body: { Title: 'CEO' },
  });
  assert.throws(
    () => resolveWritebackRequest('/salesforce/contacts/003000000000000AAA.json', '{"Id":"003000000000000AAA","Title":"CEO"}'),
    (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'Id',
  );
  assert.throws(
    () => resolveWritebackRequest('/salesforce/accounts/draft-account.json', '{"Id":"001000000000000AAA","Name":"Acme"}'),
    (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'Id',
  );
  assert.deepEqual(resolveDeleteRequest('/salesforce/accounts/001000000000000AAA.json'), {
    action: 'delete_account',
    method: 'DELETE',
    endpoint: '/services/data/v62.0/sobjects/Account/001000000000000AAA',
  });
  assert.throws(
    () => resolveDeleteRequest('/salesforce/accounts/draft-account.json'),
    /No Salesforce delete writeback rule matched/,
  );
});
