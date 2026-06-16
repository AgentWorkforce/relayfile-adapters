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
  linearMilestonePath,
  linearProjectPath,
  linearRoadmapPath,
  linearTeamPath,
  linearUserPath,
  normalizeLinearWebhook,
  validateLinearWebhookSignature,
  type ConnectionProvider,
  type LinearAdapterConfig,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
} from '../index.js';

interface RecordingClient extends RelayFileClientLike {
  files: Map<string, string>;
  deletedPaths: string[];
}

function createRecordingClient(initialFiles: Record<string, string> = {}): RecordingClient {
  const files = new Map(Object.entries(initialFiles));
  const deletedPaths: string[] = [];

  const client: RelayFileClientLike = {
    async writeFile({ path, content }) {
      const existed = files.has(path);
      files.set(path, content);
      return existed ? { updated: true } : { created: true };
    },
    async deleteFile({ path }) {
      files.delete(path);
      deletedPaths.push(path);
      return undefined;
    },
    async readFile(workspaceIdOrInput, maybePath) {
      const path = typeof workspaceIdOrInput === 'string' ? maybePath : workspaceIdOrInput.path;
      return path ? files.get(path) : undefined;
    },
  };

  return Object.assign(client, {
    files,
    deletedPaths,
  });
}

function createAdapter(
  config: LinearAdapterConfig = {},
  client: RelayFileClientLike = createRecordingClient(),
): LinearAdapter {

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

function createRecordingAdapter(config: LinearAdapterConfig = {}): {
  adapter: LinearAdapter;
  writes: Array<{ path: string; content: string }>;
} {
  const writes: Array<{ path: string; content: string }> = [];
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push({ path: input.path, content: input.content });
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

  return {
    adapter: new LinearAdapter(client, provider, config),
    writes,
  };
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
    'label.create',
    'label.update',
    'label.remove',
    'milestone.create',
    'milestone.update',
    'milestone.remove',
    'project.create',
    'project.update',
    'project.remove',
    'roadmap.create',
    'roadmap.update',
    'roadmap.remove',
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

test('ingestWebhook writes the canonical issue file plus best-effort linear layout and issue index files', async () => {
  const client = createRecordingClient({
    '/linear/issues/_index.json': JSON.stringify([
      {
        id: 'issue_existing',
        title: 'Existing issue',
        updated: '2026-04-08T09:00:00.000Z',
        identifier: 'ENG-1',
        state: 'Todo',
      },
    ]),
  });
  const adapter = createAdapter({}, client);

  const result = await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.update',
    objectType: 'issue',
    objectId: 'issue_123',
    payload: {
      id: 'issue_123',
      identifier: 'ENG-123',
      title: 'Ship index writes',
      updatedAt: '2026-04-09T10:00:00.000Z',
      state_name: 'In Progress',
      state: { name: 'In Progress' },
    },
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.paths, [
    '/linear/issues/ENG-123__issue_123.json',
    '/linear/LAYOUT.md',
    '/linear/issues/_index.json',
    '/linear/issues/by-state/in-progress/ENG-123.json',
  ]);
  assert.equal(result.filesWritten, 3);
  assert.equal(result.filesUpdated, 1);
  assert.match(client.files.get('/linear/LAYOUT.md') ?? '', /# Linear Mount Layout/);
  // PR 2's alias-emitter writes `_index.json` with `{ rows: [...] }` shape
  // before PR 1's `writeAuxiliaryFiles` overwrites it back to the canonical
  // issue-row array. Pre-existing rows seeded in the canonical shape are
  // therefore lost when the alias writer rewrites the file in alias shape;
  // the issue-index reconciliation loop only sees the new row at that point.
  // Tracked alongside the wider alias/index unification work.
  assert.deepEqual(JSON.parse(client.files.get('/linear/issues/_index.json') ?? '[]'), [
    {
      id: 'issue_123',
      title: 'Ship index writes',
      updated: '2026-04-09T10:00:00.000Z',
      identifier: 'ENG-123',
      state: 'In Progress',
    },
  ]);
});

test('ingestWebhook writes Linear agent webhook events to synthetic trigger paths', async () => {
  const client = createRecordingClient();
  const adapter = createAdapter({}, client);

  const result = await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'AgentSessionEvent.created',
    objectType: 'agent_session',
    objectId: 'session_linear_123',
    payload: {
      type: 'AgentSessionEvent',
      action: 'created',
      agentSession: { id: 'session_linear_123' },
    },
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.paths, ['/linear/agent-sessions/session_linear_123.json']);
  assert.equal(result.filesWritten, 1);
  assert.match(
    client.files.get('/linear/agent-sessions/session_linear_123.json') ?? '',
    /AgentSessionEvent/,
  );
});

test('ingestWebhook removes deleted issues from the best-effort linear issue index when reads are available', async () => {
  const client = createRecordingClient({
    '/linear/issues/_index.json': JSON.stringify([
      {
        id: 'issue_123',
        title: 'Ship index writes',
        updated: '2026-04-09T10:00:00.000Z',
        identifier: 'ENG-123',
        state: 'In Progress',
      },
      {
        id: 'issue_existing',
        title: 'Existing issue',
        updated: '2026-04-08T09:00:00.000Z',
        identifier: 'ENG-1',
        state: 'Todo',
      },
    ]),
    '/linear/issues/ENG-123__issue_123.json': '{}\n',
  });
  const adapter = createAdapter({}, client);

  const result = await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.remove',
    objectType: 'issue',
    objectId: 'issue_123',
    payload: {
      id: 'issue_123',
      identifier: 'ENG-123',
      title: 'Ship index writes',
      updatedAt: '2026-04-09T10:00:00.000Z',
    },
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.paths, [
    '/linear/issues/ENG-123__issue_123.json',
    '/linear/LAYOUT.md',
    '/linear/issues/_index.json',
  ]);
  assert.equal(result.filesDeleted, 1);
  assert.deepEqual(client.deletedPaths, ['/linear/issues/ENG-123__issue_123.json']);
  assert.deepEqual(JSON.parse(client.files.get('/linear/issues/_index.json') ?? '[]'), [
    {
      id: 'issue_existing',
      title: 'Existing issue',
      updated: '2026-04-08T09:00:00.000Z',
      identifier: 'ENG-1',
      state: 'Todo',
    },
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

test('path mapping stays deterministic for supported Linear VFS objects', () => {
  const adapter = createAdapter();

  assert.equal(linearIssuePath('issue 1/2'), '/linear/issues/issue%201%2F2.json');
  assert.equal(linearCommentPath('comment:42'), '/linear/comments/comment%3A42/meta.json');
  assert.equal(linearProjectPath('project#7'), '/linear/projects/project%237/meta.json');
  assert.equal(linearCyclePath('cycle Q2'), '/linear/cycles/cycle%20Q2.json');
  assert.equal(linearTeamPath('team eng'), '/linear/teams/team%20eng.json');
  assert.equal(linearUserPath('user@example.com'), '/linear/users/user%40example.com.json');
  assert.equal(linearMilestonePath('milestone/1'), '/linear/milestones/milestone%2F1.json');
  assert.equal(linearRoadmapPath('roadmap alpha'), '/linear/roadmaps/roadmap%20alpha.json');

  assert.equal(computeLinearPath('Issue', 'issue 1/2'), '/linear/issues/issue%201%2F2.json');
  assert.equal(computeLinearPath('comments', 'comment:42'), '/linear/comments/comment%3A42/meta.json');
  assert.equal(computeLinearPath('Issue', 'issue_123', 'AGE-8'), '/linear/issues/AGE-8__issue_123.json');
  assert.equal(computeLinearPath('comment', 'comment_123', 'AGE-8'), '/linear/comments/AGE-8__comment_123/meta.json');
  assert.equal(computeLinearPath('project', 'project#7'), '/linear/projects/project%237/meta.json');
  assert.equal(computeLinearPath('Cycles', 'cycle Q2'), '/linear/cycles/cycle%20Q2.json');
  assert.equal(computeLinearPath('teams', 'team eng'), '/linear/teams/team%20eng.json');
  assert.equal(computeLinearPath('users', 'user@example.com'), '/linear/users/user%40example.com.json');
  assert.equal(computeLinearPath('ProjectMilestone', 'milestone/1'), '/linear/milestones/milestone%2F1.json');
  assert.equal(computeLinearPath('roadmaps', 'roadmap alpha'), '/linear/roadmaps/roadmap%20alpha.json');

  assert.equal(adapter.computePath('issues', 'issue 1/2'), '/linear/issues/issue%201%2F2.json');
  assert.equal(adapter.computePath('comment', 'comment:42'), '/linear/comments/comment%3A42/meta.json');
  assert.equal(adapter.computePath('projects', 'project#7'), '/linear/projects/project%237/meta.json');
  assert.equal(adapter.computePath('cycle', 'cycle Q2'), '/linear/cycles/cycle%20Q2.json');
  assert.equal(adapter.computePath('team', 'team eng'), '/linear/teams/team%20eng.json');
  assert.equal(adapter.computePath('user', 'user@example.com'), '/linear/users/user%40example.com.json');
  assert.equal(adapter.computePath('milestone', 'milestone/1'), '/linear/milestones/milestone%2F1.json');
  assert.equal(adapter.computePath('roadmap', 'roadmap alpha'), '/linear/roadmaps/roadmap%20alpha.json');
});

test('ingestWebhook writes identifier-aware issue and comment filenames at runtime', async () => {
  const { adapter, writes } = createRecordingAdapter();

  await adapter.ingestWebhook('workspace_123', {
    action: 'create',
    type: 'Issue',
    data: {
      id: 'issue_123',
      identifier: 'AGE-8',
      title: 'Ship Mixed Case path handling before Friday',
    },
  });

  await adapter.ingestWebhook('workspace_123', {
    action: 'create',
    type: 'Comment',
    data: {
      id: 'comment_123',
      body: 'This comment body should not win over the public identifier',
      issue: {
        id: 'issue_123',
        identifier: 'AGE-8',
        title: 'Ship Mixed Case path handling before Friday',
      },
    },
  });

  assert.deepEqual(
    writes.map((write) => write.path),
    [
      '/linear/issues/AGE-8__issue_123.json',
      '/linear/issues/_index.json',
      '/linear/issues/by-id/AGE-8.json',
      '/linear/issues/by-title/ship-mixed-case-path-handling-before-friday.json',
      '/linear/LAYOUT.md',
      '/linear/comments/AGE-8__comment_123/meta.json',
      '/linear/LAYOUT.md',
    ],
  );
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
      identifier: 'ENG-100',
      title: 'Parent issue',
    },
    children: [
      { id: 'issue_child_b', title: 'Child B' },
      { id: 'issue_child_a', identifier: 'ENG-125', title: 'Child A' },
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
    '/linear/issues/child-b__issue_child_b.json',
    '/linear/issues/ENG-100__issue_parent.json',
    '/linear/issues/ENG-125__issue_child_a.json',
    '/linear/issues/issue_child_a.json',
    '/linear/issues/issue_related_z.json',
    '/linear/labels/label_backend.json',
    '/linear/labels/label_blank.json',
    '/linear/labels/label_bug.json',
    '/linear/labels/label_ui.json',
    '/linear/projects/project_alpha/meta.json',
    '/linear/teams/team_eng.json',
  ]);
  assert.equal(semantics.comments, undefined);
});

test('computeSemantics uses identifier-aware relation paths for Linear comments', () => {
  const adapter = createAdapter();
  const semantics = adapter.computeSemantics('Comment', 'comment_123', {
    id: 'comment_123',
    body: 'Looks good to me.',
    issue: {
      id: 'issue_123',
      identifier: 'AGE-8',
      title: 'Ship Mixed Case path handling before Friday',
    },
  });

  assert.deepEqual(semantics.relations, ['/linear/issues/AGE-8__issue_123.json']);
  assert.deepEqual(semantics.comments, ['Looks good to me.']);
});

test('computeSemantics extracts synced Linear project, milestone, and roadmap relations', () => {
  const adapter = createAdapter();

  const projectSemantics = adapter.computeSemantics('LinearProject', 'project_alpha', {
    id: 'project_alpha',
    name: 'Alpha',
    description: 'Top priority work',
    team_ids: ['team_eng', 'team_platform'],
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-02T00:00:00.000Z',
  });

  assert.deepEqual(projectSemantics.properties, {
    provider: 'linear',
    'provider.object_id': 'project_alpha',
    'provider.object_type': 'project',
    'linear.id': 'project_alpha',
    'linear.object_type': 'project',
    'linear.name': 'Alpha',
    'linear.description': 'Top priority work',
    'linear.created_at': '2026-04-01T00:00:00.000Z',
    'linear.updated_at': '2026-04-02T00:00:00.000Z',
    'linear.team_ids': 'team_eng, team_platform',
    'linear.team_count': '2',
  });
  assert.deepEqual(projectSemantics.relations, [
    '/linear/teams/team_eng.json',
    '/linear/teams/team_platform.json',
  ]);

  const milestoneSemantics = adapter.computeSemantics('ProjectMilestone', 'milestone_beta', {
    id: 'milestone_beta',
    name: 'Beta',
    status: 'planned',
    progress: 0.4,
    project_id: 'project_alpha',
    project_name: 'Alpha',
  });

  assert.deepEqual(milestoneSemantics.properties, {
    provider: 'linear',
    'provider.object_id': 'milestone_beta',
    'provider.object_type': 'milestone',
    'linear.id': 'milestone_beta',
    'linear.object_type': 'milestone',
    'linear.name': 'Beta',
    'linear.status': 'planned',
    'linear.progress': '0.4',
    'linear.project_id': 'project_alpha',
    'linear.project_name': 'Alpha',
  });
  assert.deepEqual(milestoneSemantics.relations, ['/linear/projects/project_alpha/meta.json']);

  const roadmapSemantics = adapter.computeSemantics('roadmap', 'roadmap_2026', {
    id: 'roadmap_2026',
    name: '2026 Roadmap',
    project_ids: ['project_alpha', 'project_beta'],
    team_ids: ['team_eng'],
  });

  assert.deepEqual(roadmapSemantics.properties, {
    provider: 'linear',
    'provider.object_id': 'roadmap_2026',
    'provider.object_type': 'roadmap',
    'linear.id': 'roadmap_2026',
    'linear.object_type': 'roadmap',
    'linear.name': '2026 Roadmap',
    'linear.project_ids': 'project_alpha, project_beta',
    'linear.project_count': '2',
    'linear.team_ids': 'team_eng',
    'linear.team_count': '1',
  });
  assert.deepEqual(roadmapSemantics.relations, [
    '/linear/projects/project_alpha/meta.json',
    '/linear/projects/project_beta/meta.json',
    '/linear/teams/team_eng.json',
  ]);
});

test('barrel exports import cleanly for runtime and type-checked usage', async () => {
  const barrel = await import('../index.js');

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

test('ingestWebhook bootstraps the issue index on first ingest when no _index.json exists yet', async () => {
  // Empty client (readFile present, but no seed for the index path) — the
  // adapter must still write a fresh `_index.json` instead of skipping it.
  const client = createRecordingClient({});
  const adapter = createAdapter({}, client);

  const result = await adapter.ingestWebhook('workspace-1', {
    provider: 'linear',
    eventType: 'issue.create',
    objectType: 'issue',
    objectId: 'issue_first',
    payload: {
      id: 'issue_first',
      identifier: 'ENG-7',
      title: 'First ingest after fresh install',
      updatedAt: '2026-04-09T10:00:00.000Z',
      state_name: 'Backlog',
      state: { name: 'Backlog' },
    },
  });

  assert.deepEqual(result.errors, []);
  const indexBody = client.files.get('/linear/issues/_index.json');
  assert.ok(indexBody, 'expected the linear issue index to be bootstrapped on first ingest');
  assert.deepEqual(JSON.parse(indexBody), [
    {
      id: 'issue_first',
      title: 'First ingest after fresh install',
      updated: '2026-04-09T10:00:00.000Z',
      identifier: 'ENG-7',
      state: 'Backlog',
    },
  ]);
});
