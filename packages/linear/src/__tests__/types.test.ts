import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LINEAR_AGENT_WEBHOOK_EVENTS,
  LINEAR_WEBHOOK_ACTIONS,
  LINEAR_WEBHOOK_OBJECT_TYPES,
  type LinearAdapterConfig,
} from '../index.js';

test('exports supported Linear webhook object types', () => {
  assert.deepEqual(LINEAR_WEBHOOK_OBJECT_TYPES, [
    'comment',
    'cycle',
    'issue',
    'milestone',
    'project',
    'roadmap',
  ]);
});

test('exports supported Linear webhook actions', () => {
  assert.deepEqual(LINEAR_WEBHOOK_ACTIONS, ['create', 'remove', 'update']);
});

test('exports supported Linear agent webhook events for trigger autocomplete', () => {
  assert.deepEqual(LINEAR_AGENT_WEBHOOK_EVENTS, [
    'AgentSessionEvent.created',
    'AgentSessionEvent.prompted',
    'AppUserNotification.issueMention',
    'AppUserNotification.issueEmojiReaction',
    'AppUserNotification.issueCommentMention',
    'AppUserNotification.issueCommentReaction',
    'AppUserNotification.issueAssignedToYou',
    'AppUserNotification.issueUnassignedFromYou',
    'AppUserNotification.issueNewComment',
    'AppUserNotification.issueStatusChanged',
    'PermissionChange.teamAccessChanged',
    'OAuthApp.revoked',
  ]);
});

test('LinearAdapterConfig remains usable as a typed contract', () => {
  const config = {
    apiUrl: 'https://api.linear.app/graphql',
    provider: 'nango',
    webhookSecret: 'linear-secret',
  } satisfies LinearAdapterConfig;

  assert.equal(config.provider, 'nango');
  assert.equal(config.webhookSecret, 'linear-secret');
});
