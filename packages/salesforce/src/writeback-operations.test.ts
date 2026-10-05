import assert from 'node:assert/strict';
import test from 'node:test';

import { resources } from './resources.js';
import { resolveDeleteRequest, resolveWritebackRequest } from './writeback.js';

const COLLECTIONS = ['accounts', 'contacts', 'opportunities', 'leads', 'cases'] as const;
const RECORD_ID = '001000000000001AAA';

test('salesforce resources declare create, update, and delete', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.path, resource.operations])),
    Object.fromEntries(COLLECTIONS.map((collection) => [`/salesforce/${collection}`, ['create', 'update', 'delete']])),
  );
});

test('salesforce resources route create, update, and delete', () => {
  for (const collection of COLLECTIONS) {
    const body = '{"Name":"Example"}';
    assert.equal(resolveWritebackRequest(`/salesforce/${collection}/new.json`, body).method, 'POST', collection);
    assert.equal(resolveWritebackRequest(`/salesforce/${collection}/${RECORD_ID}.json`, body).method, 'PATCH', collection);
    assert.equal(resolveWritebackRequest(`/salesforce/${collection}/${RECORD_ID}.json`, body, 'PUT').method, 'PUT', collection);
    assert.equal(resolveDeleteRequest(`/salesforce/${collection}/${RECORD_ID}.json`).method, 'DELETE', collection);
  }
});
