import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWritebackRequest } from './writeback.js';

test('Mailgun writeback sends messages from non-canonical draft filenames', () => {
  const request = resolveWritebackRequest(
    '/mailgun/domains/example.com/messages/send%20welcome.json',
    JSON.stringify({ from: 'ops@example.com', to: 'ada@example.com', subject: 'Welcome', text: 'Hello' }),
  );

  assert.equal(request.action, 'send_message');
  assert.equal(request.endpoint, '/v3/example.com/messages');
  assert.deepEqual(request.body, {
    from: 'ops@example.com',
    to: 'ada@example.com',
    subject: 'Welcome',
    text: 'Hello',
  });
});

test('Mailgun writeback creates lists from draft filenames and preserves canonical updates', () => {
  const create = resolveWritebackRequest(
    '/mailgun/lists/create-list.json',
    JSON.stringify({ address: 'team@example.com', name: 'Team' }),
  );
  assert.equal(create.action, 'create_list');
  assert.equal(create.endpoint, '/v3/lists');
  assert.deepEqual(create.body, { address: 'team@example.com', name: 'Team' });

  const update = resolveWritebackRequest(
    '/mailgun/lists/team%40example.com.json',
    JSON.stringify({ description: 'Support team' }),
  );
  assert.equal(update.action, 'update_list');
  assert.equal(update.endpoint, '/v3/lists/team%40example.com');
});
