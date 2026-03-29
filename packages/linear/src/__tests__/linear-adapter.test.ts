import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  LINEAR_SIGNATURE_HEADER,
  LinearAdapter,
  assertValidLinearWebhookSignature,
  computeLinearPath,
  linearCommentPath,
  linearCyclePath,
  linearIssuePath,
  linearProjectPath,
  normalizeLinearWebhook,
  validateLinearWebhookSignature,
  type ConnectionProvider,
  type LinearAdapterConfig,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
} from '../index.ts';

function createAdapter(config: LinearAdapterConfig = {}): LinearAdapter {
  const client: RelayFileClientLike = {
    async writeFile() {
      return { created: true };
    },
    async deleteFile() {
      return undefined;
    },
  };

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
  return new LinearAdapter(client, provider, config);
}

test('LinearAdapter exposes the provider name and supported Linear webhook events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'linear');
  assert.deepEqual(adapter.supportedEvents(), [
    'comment.create',
    'comment.update',
    'comment.remove',
    'cycle.create',
    'cycle.update',
    'cycle.remove',
    'issue.create',
    'issue.update',
    'issue.remove',
    'project.create',
    'project.update',
    'project.remove',
  ]);
});

test('normalizeLinearWebhook normalizes issue callbacks and preserves connection metadata', () => {
  const normalized = normalizeLinearWebhook(
    JSON.stringify({
      action: 'create',
      type: 'Issue',
      createdAt: '2026-03-28T10:00:00.000Z',
      organizationId: 'org_123',
      url: 'https://linear.app/acme/issue/ENG-123',
      data: {
        id: 'issue_123',
        identifier: 'ENG-123',
        title: 'Ship adapter tests',
      },
    }),
    {
      'Linear-Delivery': 'delivery_123',
      'X-Relay-Connection-Id': 'conn_linear_123',
      'X-Relay-Provider-Config-Key': 'linear-primary',
      'X-Request-Id': 'req_123',
    },
  );

  assert.equal(normalized.provider, 'linear');
  assert.equal(normalized.connectionId, 'conn_linear_123');
  assert.equal(normalized.eventType, 'issue.create');
  assert.equal(normalized.objectType, 'issue');
  assert.equal(normalized.objectId, 'issue_123');
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_linear_123',
    deliveryId: 'delivery_123',
    provider: 'linear',
    providerConfigKey: 'linear-primary',
    requestId: 'req_123',
  });
  assert.deepEqual(normalized.payload._webhook, {
    action: 'create',
    createdAt: '2026-03-28T10:00:00.000Z',
    deliveryId: 'delivery_123',
    eventType: 'issue.create',
    objectId: 'issue_123',
    objectType: 'issue',
    organizationId: 'org_123',
    url: 'https://linear.app/acme/issue/ENG-123',
  });
});

test('normalizeLinearWebhook normalizes comment callbacks from payload metadata', () => {
  const normalized = normalizeLinearWebhook({
    action: 'update',
    type: 'Comments',
    createdAt: '2026-03-28T11:00:00.000Z',
    metadata: {
      provider: 'linear',
      providerConfigKey: 'linear-secondary',
      connectionId: 'conn_linear_456',
    },
    connection: {
      id: 'conn_linear_ignored',
    },
    data: {
      id: 'comment_123',
      body: 'Looks good to me.',
      issue: {
        id: 'issue_456',
        identifier: 'ENG-456',
      },
    },
  });

  assert.equal(normalized.provider, 'linear');
  assert.equal(normalized.connectionId, 'conn_linear_456');
  assert.equal(normalized.eventType, 'comment.update');
  assert.equal(normalized.objectType, 'comment');
  assert.equal(normalized.objectId, 'comment_123');
  assert.deepEqual(normalized.payload.data, {
    id: 'comment_123',
    body: 'Looks good to me.',
    issue: {
      id: 'issue_456',
      identifier: 'ENG-456',
    },
  });
  assert.deepEqual(normalized.payload._connection, {
    connectionId: 'conn_linear_456',
    provider: 'linear',
    providerConfigKey: 'linear-secondary',
  });
  assert.deepEqual(normalized.payload._webhook, {
    action: 'update',
    createdAt: '2026-03-28T11:00:00.000Z',
    eventType: 'comment.update',
    objectId: 'comment_123',
    objectType: 'comment',
  });
});

test('signature rejection handling is deterministic for result and throwing helpers', () => {
  const rawPayload = JSON.stringify({
    action: 'create',
    type: 'Issue',
    data: { id: 'issue_123' },
  });
  const secret = 'linear-secret';
  const validSignature = createHmac('sha256', secret).update(rawPayload).digest('hex');

  const missing = validateLinearWebhookSignature(rawPayload, {}, secret);
  assert.deepEqual(missing, { ok: false, reason: 'missing-signature' });
  assert.throws(
    () => assertValidLinearWebhookSignature(rawPayload, {}, secret),
    /missing-signature/,
  );

  const malformed = validateLinearWebhookSignature(rawPayload, {
    [LINEAR_SIGNATURE_HEADER]: 'not-hex',
  }, secret);
  assert.deepEqual(malformed, {
    ok: false,
    reason: 'malformed-signature',
    receivedSignature: 'not-hex',
  });

  const invalid = validateLinearWebhookSignature(rawPayload, {
    [LINEAR_SIGNATURE_HEADER]: `${validSignature.slice(0, -2)}00`,
  }, secret);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-signature');
  assert.equal(invalid.expectedSignature, validSignature);
  assert.throws(
    () =>
      assertValidLinearWebhookSignature(rawPayload, {
        [LINEAR_SIGNATURE_HEADER]: `${validSignature.slice(0, -2)}00`,
      }, secret),
    /invalid-signature/,
  );

  const missingSecret = validateLinearWebhookSignature(rawPayload, {
    [LINEAR_SIGNATURE_HEADER]: validSignature,
  }, '   ');
  assert.deepEqual(missingSecret, { ok: false, reason: 'missing-secret' });
});

test('path mapping stays deterministic for issue, comment, project, and cycle objects', () => {
  const adapter = createAdapter();

  assert.equal(linearIssuePath('issue 1/2'), '/linear/issues/issue%201%2F2.json');
  assert.equal(linearCommentPath('comment:42'), '/linear/comments/comment%3A42.json');
  assert.equal(linearProjectPath('project#7'), '/linear/projects/project%237.json');
  assert.equal(linearCyclePath('cycle Q2'), '/linear/cycles/cycle%20Q2.json');

  assert.equal(computeLinearPath('Issue', 'issue 1/2'), '/linear/issues/issue%201%2F2.json');
  assert.equal(computeLinearPath('comments', 'comment:42'), '/linear/comments/comment%3A42.json');
  assert.equal(computeLinearPath('project', 'project#7'), '/linear/projects/project%237.json');
  assert.equal(computeLinearPath('Cycles', 'cycle Q2'), '/linear/cycles/cycle%20Q2.json');

  assert.equal(adapter.computePath('issues', 'issue 1/2'), '/linear/issues/issue%201%2F2.json');
  assert.equal(adapter.computePath('comment', 'comment:42'), '/linear/comments/comment%3A42.json');
  assert.equal(adapter.computePath('projects', 'project#7'), '/linear/projects/project%237.json');
  assert.equal(adapter.computePath('cycle', 'cycle Q2'), '/linear/cycles/cycle%20Q2.json');
});

test('computeSemantics extracts issue priority, state, labels, and relations deterministically', () => {
  const adapter = createAdapter();

  const semantics = adapter.computeSemantics('Issue', 'issue_123', {
    id: 'issue_123',
    identifier: 'ENG-123',
    title: 'Stabilize Linear adapter coverage',
    priority: 2,
    state: {
      id: 'state_in_progress',
      name: 'In Progress',
      type: 'started',
      color: '#f97316',
    },
    labels: [
      { id: 'label_bug', name: 'bug' },
      { id: 'label_ui', name: 'ui' },
      { id: 'label_backend', name: 'backend' },
      { id: 'label_blank', name: '   ' },
    ],
    project: {
      id: 'project_alpha',
      name: 'Alpha',
      state: 'started',
      url: 'https://linear.app/acme/project/alpha',
    },
    cycle: {
      id: 'cycle_2026_06',
      number: 6,
      name: 'Cycle 6',
    },
    parent: {
      id: 'issue_parent',
    },
    children: [
      { id: 'issue_child_b' },
      { id: 'issue_child_a' },
    ],
    relations: [
      { relatedIssueId: 'issue_related_z' },
      { relatedIssueId: 'issue_child_a' },
    ],
    team: {
      id: 'team_eng',
      key: 'ENG',
      name: 'Engineering',
    },
    url: 'https://linear.app/acme/issue/ENG-123',
    _webhook: {
      action: 'update',
      createdAt: '2026-03-28T12:00:00.000Z',
      organizationId: 'org_123',
      url: 'https://linear.app/webhooks/issue_123',
    },
  });

  assert.deepEqual(semantics.properties, {
    provider: 'linear',
    'provider.object_id': 'issue_123',
    'provider.object_type': 'issue',
    'linear.id': 'issue_123',
    'linear.object_type': 'issue',
    'linear.url': 'https://linear.app/acme/issue/ENG-123',
    'linear.webhook.action': 'update',
    'linear.webhook.created_at': '2026-03-28T12:00:00.000Z',
    'linear.webhook.organization_id': 'org_123',
    'linear.webhook.url': 'https://linear.app/webhooks/issue_123',
    'linear.identifier': 'ENG-123',
    'linear.title': 'Stabilize Linear adapter coverage',
    'linear.priority': '2',
    'linear.priority_label': 'high',
    'linear.state_id': 'state_in_progress',
    'linear.state_name': 'In Progress',
    'linear.state_type': 'started',
    'linear.state_color': '#f97316',
    'linear.labels': 'backend, bug, ui',
    'linear.label_count': '3',
    'linear.project_id': 'project_alpha',
    'linear.project_name': 'Alpha',
    'linear.project_state': 'started',
    'linear.project_url': 'https://linear.app/acme/project/alpha',
    'linear.cycle_id': 'cycle_2026_06',
    'linear.cycle_number': '6',
    'linear.cycle_name': 'Cycle 6',
    'linear.parent_id': 'issue_parent',
    'linear.team_id': 'team_eng',
    'linear.team_key': 'ENG',
    'linear.team_name': 'Engineering',
  });
  assert.deepEqual(semantics.relations, [
    '/linear/cycles/cycle_2026_06.json',
    '/linear/issues/issue_child_a.json',
    '/linear/issues/issue_child_b.json',
    '/linear/issues/issue_parent.json',
    '/linear/issues/issue_related_z.json',
    '/linear/projects/project_alpha.json',
  ]);
  assert.equal(semantics.comments, undefined);
});

test('barrel exports import cleanly for runtime and type-checked usage', async () => {
  const barrel = await import('../index.ts');

  assert.equal(barrel.LinearAdapter, LinearAdapter);
  assert.equal(barrel.computeLinearPath, computeLinearPath);
  assert.equal(typeof barrel.normalizeLinearWebhook, 'function');
  assert.equal(typeof barrel.validateLinearWebhookSignature, 'function');

  const config: LinearAdapterConfig = {
    connectionId: 'conn_linear_barrel',
    provider: 'linear',
  };
  const adapter = createAdapter(config);

  assert.equal(adapter.name, 'linear');
  assert.equal(adapter.config.connectionId, 'conn_linear_barrel');
});
