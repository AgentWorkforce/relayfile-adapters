import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWrite } from '@relayfile/adapter-core';

import { resources } from '../resources.js';
import { resolveDeleteRequest, resolveWritebackRequest } from '../writeback.js';

test('zendesk resources declare the operations the writeback resolver implements', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.name, resource.operations])),
    {
      comments: ['create'],
      tickets: ['create', 'update', 'delete'],
      users: ['create', 'update', 'delete'],
    },
  );
});

test('zendesk ticket comments only route creates', () => {
  assert.equal(
    resolveWritebackRequest('/zendesk/tickets/123/comments/reply.json', '{"body":"Thanks!"}').action,
    'add_ticket_comment',
  );
  assert.equal(classifyWrite('/zendesk/tickets/123/comments/456.json', resources), null);
  assert.equal(classifyWrite('/zendesk/tickets/123/comments/456.json', resources, { fsEvent: 'delete' }), null);
  assert.throws(
    () => resolveWritebackRequest('/zendesk/tickets/123/comments/456.json', '{"body":"Edited"}'),
    /No Zendesk writeback rule matched/,
  );
  assert.throws(
    () => resolveDeleteRequest('/zendesk/tickets/123/comments/456.json'),
    /No Zendesk delete writeback rule matched/,
  );
});

test('zendesk tickets and users still route create, update, and delete', () => {
  assert.equal(resolveWritebackRequest('/zendesk/tickets/draft.json', '{"subject":"New"}').action, 'create_ticket');
  assert.equal(resolveWritebackRequest('/zendesk/tickets/123.json', '{"subject":"Renamed"}').action, 'update_ticket');
  assert.equal(resolveDeleteRequest('/zendesk/tickets/123.json').action, 'delete_ticket');
  assert.equal(resolveWritebackRequest('/zendesk/users/draft.json', '{"name":"Ada"}').action, 'create_user');
  assert.equal(resolveWritebackRequest('/zendesk/users/42.json', '{"name":"Ada L."}').action, 'update_user');
  assert.equal(resolveDeleteRequest('/zendesk/users/42.json').action, 'delete_user');
});
