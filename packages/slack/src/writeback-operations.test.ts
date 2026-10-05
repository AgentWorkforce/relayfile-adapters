import assert from 'node:assert/strict';
import test from 'node:test';

import { resources } from './resources.js';
import { resolveDeleteRequest, resolveWritebackRequest } from './writeback.js';

const MESSAGE = '/slack/channels/C01ABC1234/messages/1762445678_001234';
const BODY = '{"text":"Example","name":"eyes"}';

test('slack resources declare the operations the resolver implements', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.path, resource.operations])),
    {
      '/slack/channels/{channelId}/messages': ['create', 'update', 'delete'],
      '/slack/users/{userId}/messages': ['create'],
      '/slack/channels/{channelId}/messages/{messageTs}/replies': ['create', 'update', 'delete'],
      '/slack/channels/{channelId}/messages/{messageTs}/reactions': ['create', 'delete'],
    },
  );
});

test('slack channel messages and replies route create, update, and delete', () => {
  assert.equal(resolveWritebackRequest('/slack/channels/C01ABC1234/messages/new.json', BODY).action, 'post_message');
  assert.equal(resolveWritebackRequest(`${MESSAGE}.json`, BODY).action, 'update_message');
  assert.equal(resolveDeleteRequest(`${MESSAGE}.json`).action, 'delete_message');

  assert.equal(resolveWritebackRequest(`${MESSAGE}/replies/new.json`, BODY).action, 'reply_in_thread');
  assert.equal(resolveWritebackRequest(`${MESSAGE}/replies/1762445679_000001.json`, BODY).action, 'update_message');
  assert.equal(resolveDeleteRequest(`${MESSAGE}/replies/1762445679_000001.json`).action, 'delete_message');
});

test('slack direct messages only create', () => {
  assert.equal(resolveWritebackRequest('/slack/users/U01ABC1234/messages/new.json', BODY).action, 'post_dm');
  assert.throws(() => resolveDeleteRequest('/slack/users/U01ABC1234/messages/1762445678_001234.json'));
});

test('slack reactions add and remove but never update', () => {
  assert.equal(resolveWritebackRequest(`${MESSAGE}/reactions/draft@reaction.json`, BODY).action, 'add_reaction');
  assert.equal(resolveDeleteRequest(`${MESSAGE}/reactions/eyes.json`).action, 'remove_reaction');
  // A canonical reaction filename is an update, which the resolver has never handled (see #310).
  assert.throws(() => resolveWritebackRequest(`${MESSAGE}/reactions/eyes.json`, BODY), /No Slack writeback rule matched/);
});
