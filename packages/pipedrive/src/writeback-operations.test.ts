import assert from 'node:assert/strict';
import test from 'node:test';

import { resources } from './resources.js';
import { resolvePipedriveDeleteRequest, resolvePipedriveWritebackRequest } from './writeback.js';

const BODIES = {
  deals: '{"title":"Example deal"}',
  persons: '{"name":"Example person"}',
  organizations: '{"name":"Example organization"}',
  activities: '{"subject":"Example activity"}',
} as const;
const COLLECTIONS = Object.keys(BODIES) as (keyof typeof BODIES)[];

test('pipedrive resources declare create, update, and delete', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.path, resource.operations])),
    Object.fromEntries(COLLECTIONS.map((collection) => [`/pipedrive/${collection}`, ['create', 'update', 'delete']])),
  );
});

test('pipedrive resources route create, update, and delete', () => {
  for (const collection of COLLECTIONS) {
    const body = BODIES[collection];
    assert.equal(resolvePipedriveWritebackRequest(`/pipedrive/${collection}/new.json`, body).method, 'POST', collection);
    assert.equal(resolvePipedriveWritebackRequest(`/pipedrive/${collection}/101.json`, body).method, 'PUT', collection);
    assert.equal(resolvePipedriveDeleteRequest(`/pipedrive/${collection}/101.json`).method, 'DELETE', collection);
  }
});
