import assert from 'node:assert/strict';
import test from 'node:test';

import { resources } from './resources.js';
import { resolveDeleteRequest, resolveWritebackRequest } from './writeback.js';

const COLLECTIONS = ['conversations', 'contacts', 'companies'] as const;

test('intercom resources declare create, update, and delete', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.path, resource.operations])),
    Object.fromEntries(COLLECTIONS.map((collection) => [`/intercom/${collection}`, ['create', 'update', 'delete']])),
  );
});

test('intercom resources route create, update, and delete', () => {
  const expectedUpdateMethod = { conversations: 'PUT', contacts: 'PUT', companies: 'POST' } as const;
  for (const collection of COLLECTIONS) {
    const body = '{"name":"Example"}';
    assert.equal(resolveWritebackRequest(`/intercom/${collection}/draft.new.json`, body).method, 'POST', collection);
    assert.equal(resolveWritebackRequest(`/intercom/${collection}/123.json`, body).method, expectedUpdateMethod[collection], collection);
    assert.equal(resolveDeleteRequest(`/intercom/${collection}/123.json`).method, 'DELETE', collection);
  }
});

test('intercom conversation replies keep their ad hoc route', () => {
  const request = resolveWritebackRequest('/intercom/conversations/123/reply.json', '{"body":"Thanks"}');
  assert.equal(request.action, 'reply_conversation');
  assert.equal(request.endpoint, '/conversations/123/reply');
});
