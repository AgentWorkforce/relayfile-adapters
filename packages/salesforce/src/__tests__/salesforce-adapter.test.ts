import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SalesforceAdapter,
  computeSalesforcePath,
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
  type RelayFileClientLike,
  type SalesforceAdapterConfig,
  type WriteFileInput,
} from '../index.js';

interface CapturingClient extends RelayFileClientLike {
  deleted: string[];
  writes: WriteFileInput[];
}

function createClient(): CapturingClient {
  return {
    deleted: [],
    writes: [],
    async writeFile(input: WriteFileInput) {
      this.writes.push(input);
      return { created: true };
    },
    async deleteFile(input) {
      this.deleted.push(input.path);
    },
  };
}

function createAdapter(config: SalesforceAdapterConfig = {}, client = createClient()): SalesforceAdapter {
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
    'Case.created',
    'Case.updated',
    'Case.deleted',
    'Case.upserted',
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
    endpoint: '/services/data/v59.0/sobjects/Account/001A',
  });
  assert.deepEqual(resolveReadRequest('/salesforce/contacts'), {
    action: 'list_contacts',
    method: 'GET',
    endpoint: '/services/data/v59.0/sobjects/Contact',
  });

  assert.deepEqual(resolveWritebackRequest('/salesforce/accounts/new.json', '{"Name":"Acme"}'), {
    action: 'create_account',
    method: 'POST',
    endpoint: '/services/data/v59.0/sobjects/Account',
    body: { Name: 'Acme' },
  });
  assert.deepEqual(resolveWritebackRequest('/salesforce/contacts/003A.json', '{"Title":"CEO"}'), {
    action: 'update_contact',
    method: 'PATCH',
    endpoint: '/services/data/v59.0/sobjects/Contact/003A',
    body: { Title: 'CEO' },
  });
});
