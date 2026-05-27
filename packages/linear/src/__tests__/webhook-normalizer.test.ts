import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  LINEAR_DELIVERY_HEADER,
  LINEAR_SIGNATURE_HEADER,
  assertValidLinearWebhookSignature,
  normalizeLinearWebhook,
  validateLinearWebhookSignature,
  validateLinearWebhookTimestamp,
} from '../index.js';

const issuePayload = {
  action: 'create',
  type: 'Issue',
  createdAt: '2026-03-28T10:00:00.000Z',
  organizationId: 'org_123',
  webhookTimestamp: 1_743_155_200_000,
  webhookId: 'webhook_123',
  data: {
    id: 'issue_123',
    identifier: 'ENG-123',
    title: 'Ship webhook normalizer',
  },
};

test('normalizeLinearWebhook extracts normalized event metadata and connection metadata', () => {
  const normalized = normalizeLinearWebhook(issuePayload, {
    [LINEAR_DELIVERY_HEADER]: 'delivery_123',
    'Linear-Event': 'Issue',
    'X-Relay-Connection-Id': 'conn_linear_123',
    'X-Relay-Provider-Config-Key': 'linear',
  });

  assert.equal(normalized.provider, 'linear');
  assert.equal(normalized.connectionId, 'conn_linear_123');
  assert.equal(normalized.eventType, 'issue.create');
  assert.equal(normalized.objectType, 'issue');
  assert.equal(normalized.objectId, 'issue_123');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_linear_123',
    deliveryId: 'delivery_123',
    provider: 'linear',
    providerConfigKey: 'linear',
  });
});

test('normalizeLinearWebhook recognizes AgentSessionEvent payloads from Linear agent webhooks', () => {
  const normalized = normalizeLinearWebhook({
    type: 'AgentSessionEvent',
    action: 'created',
    createdAt: '2026-05-27T10:00:00.000Z',
    organizationId: 'org_linear_123',
    appUserId: 'user_linear_123',
    agentSession: {
      id: 'session_linear_123',
      issue: {
        id: 'issue_linear_123',
        identifier: 'ENG-123',
        title: 'Fix agent session routing',
      },
    },
    promptContext: '<issue identifier="ENG-123">Fix agent session routing</issue>',
  }, {
    [LINEAR_DELIVERY_HEADER]: 'delivery_agent_session_123',
    'Linear-Event': 'AgentSessionEvent',
    'X-Relay-Connection-Id': 'conn_linear_123',
  });

  assert.equal(normalized.provider, 'linear');
  assert.equal(normalized.connectionId, 'conn_linear_123');
  assert.equal(normalized.eventType, 'AgentSessionEvent.created');
  assert.equal(normalized.objectType, 'agent_session');
  assert.equal(normalized.objectId, 'session_linear_123');
  assert.deepEqual(normalized.payload._webhook, {
    action: 'created',
    appUserId: 'user_linear_123',
    createdAt: '2026-05-27T10:00:00.000Z',
    deliveryId: 'delivery_agent_session_123',
    eventHeader: 'AgentSessionEvent',
    eventType: 'AgentSessionEvent.created',
    objectId: 'session_linear_123',
    objectType: 'agent_session',
    organizationId: 'org_linear_123',
  });
});

test('normalizeLinearWebhook recognizes prompted AgentSessionEvent payloads by agent session id', () => {
  const normalized = normalizeLinearWebhook({
    type: 'AgentSessionEvent',
    action: 'prompted',
    agentSession: {
      id: 'session_linear_456',
      issue: { identifier: 'ENG-456' },
    },
    agentActivity: {
      id: 'activity_linear_456',
      body: 'Please continue with the webhook fix.',
    },
  });

  assert.equal(normalized.eventType, 'AgentSessionEvent.prompted');
  assert.equal(normalized.objectType, 'agent_session');
  assert.equal(normalized.objectId, 'session_linear_456');
});

test('normalizeLinearWebhook recognizes additional Linear agent best-practice webhook categories', () => {
  const notification = normalizeLinearWebhook({
    type: 'AppUserNotification',
    action: 'issueAssignedToYou',
    createdAt: '2026-05-27T11:00:00.000Z',
    organizationId: 'org_linear_123',
    oauthClientId: 'oauth_client_123',
    appUserId: 'app_user_123',
    notification: { id: 'notification_123' },
  });

  assert.equal(notification.eventType, 'AppUserNotification.issueAssignedToYou');
  assert.equal(notification.objectType, 'app_user_notification');
  assert.equal(notification.objectId, 'notification_123');

  const permission = normalizeLinearWebhook({
    type: 'PermissionChange',
    action: 'teamAccessChanged',
    createdAt: '2026-05-27T11:01:00.000Z',
    organizationId: 'org_linear_123',
    oauthClientId: 'oauth_client_123',
    appUserId: 'app_user_123',
    canAccessAllPublicTeams: false,
    addedTeamIds: ['team_123'],
    removedTeamIds: [],
    webhookTimestamp: 1_748_348_460_000,
    webhookId: 'webhook_permission_123',
  });

  assert.equal(permission.eventType, 'PermissionChange.teamAccessChanged');
  assert.equal(permission.objectType, 'permission_change');
  assert.equal(permission.objectId, 'webhook_permission_123');

  const revoked = normalizeLinearWebhook({
    type: 'OAuthApp',
    action: 'revoked',
    createdAt: '2026-05-27T11:02:00.000Z',
    organizationId: 'org_linear_123',
    oauthClientId: 'oauth_client_123',
    webhookTimestamp: 1_748_348_520_000,
    webhookId: 'webhook_oauth_123',
  });

  assert.equal(revoked.eventType, 'OAuthApp.revoked');
  assert.equal(revoked.objectType, 'oauth_app');
  assert.equal(revoked.objectId, 'oauth_client_123');
});

test('validateLinearWebhookSignature accepts the expected HMAC and rejects invalid signatures', () => {
  const rawPayload = JSON.stringify(issuePayload);
  const secret = 'linear-secret';
  const signature = createHmac('sha256', secret).update(rawPayload).digest('hex');

  const valid = validateLinearWebhookSignature(rawPayload, {
    [LINEAR_SIGNATURE_HEADER]: signature,
  }, secret);
  assert.equal(valid.ok, true);

  const invalid = validateLinearWebhookSignature(rawPayload, {
    [LINEAR_SIGNATURE_HEADER]: 'deadbeef',
  }, secret);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-signature');

  assert.doesNotThrow(() =>
    assertValidLinearWebhookSignature(rawPayload, { [LINEAR_SIGNATURE_HEADER]: signature }, secret),
  );
});

test('validateLinearWebhookTimestamp enforces freshness', () => {
  const fresh = validateLinearWebhookTimestamp(issuePayload, 60_000, 1_743_155_230_000);
  assert.equal(fresh.ok, true);

  const stale = validateLinearWebhookTimestamp(issuePayload, 60_000, 1_743_155_400_001);
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-timestamp');
});
