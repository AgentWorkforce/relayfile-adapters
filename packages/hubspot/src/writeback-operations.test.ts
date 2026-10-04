import assert from 'node:assert/strict';
import test from 'node:test';

import { resources } from './resources.js';
import { resolveHubSpotDeleteRequest, resolveHubSpotWritebackRequest } from './writeback.js';

const COLLECTIONS = ['contacts', 'companies', 'deals', 'tickets'] as const;

test('hubspot CRM resources declare create, update, and delete', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.path, resource.operations])),
    Object.fromEntries(COLLECTIONS.map((collection) => [`/hubspot/${collection}`, ['create', 'update', 'delete']])),
  );
});

test('hubspot CRM objects route create, update, and delete', () => {
  for (const collection of COLLECTIONS) {
    const body = '{"properties":{"name":"Example"}}';
    assert.equal(resolveHubSpotWritebackRequest(`/hubspot/${collection}/new-record.json`, body).method, 'POST', collection);
    assert.equal(resolveHubSpotWritebackRequest(`/hubspot/${collection}/101.json`, body).method, 'PATCH', collection);
    assert.equal(resolveHubSpotDeleteRequest(`/hubspot/${collection}/101.json`).method, 'DELETE', collection);
  }
});
