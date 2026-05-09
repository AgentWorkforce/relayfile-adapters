import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AsanaAdapter,
  asanaProjectPath,
  asanaSectionPath,
  asanaTaskPath,
  asanaWorkspacePath,
  computeAsanaPath,
  resolveAsanaReadRequest,
  resolveAsanaDeleteRequest,
  resolveAsanaWritebackRequest,
  type AsanaAdapterConfig,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';
import { ReadOnlyFieldError } from '../writeback.js';

function createAdapter(config: AsanaAdapterConfig = {}, writes: WriteFileInput[] = []): AsanaAdapter {
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push(input);
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

  return new AsanaAdapter(client, provider, config);
}

test('AsanaAdapter exposes provider name and supported Asana webhook events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'asana');
  assert.deepEqual(adapter.supportedEvents(), [
    'task.added',
    'task.changed',
    'task.deleted',
    'task.removed',
    'project.added',
    'project.changed',
    'project.deleted',
    'project.removed',
    'section.added',
    'section.changed',
    'section.deleted',
    'section.removed',
    'workspace.added',
    'workspace.changed',
    'workspace.deleted',
    'workspace.removed',
  ]);
});

test('ingestWebhook writes task events with deterministic content and semantics', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({}, writes);

  const result = await adapter.ingestWebhook('ws_relay', {
    provider: 'asana',
    eventType: 'task.changed',
    objectType: 'task',
    objectId: '12001',
    payload: {
      gid: '12001',
      name: 'Ship Asana adapter',
      completed: false,
      assignee: { gid: 'user_1', name: 'Ada' },
      projects: [{ gid: 'project_1', name: 'Adapters' }],
      memberships: [{ section: { gid: 'section_1', name: 'In Progress' } }],
      workspace: { gid: 'workspace_1', name: 'Engineering' },
      notes: 'Implementation notes',
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/asana/tasks/12001.json']);
  assert.equal(writes[0]?.path, '/asana/tasks/12001.json');
  assert.equal(writes[0]?.semantics?.properties?.['asana.assignee_name'], 'Ada');
  assert.deepEqual(writes[0]?.semantics?.relations, [
    '/asana/projects/project_1.json',
    '/asana/sections/section_1.json',
    '/asana/workspaces/workspace_1.json',
  ]);
  assert.deepEqual(writes[0]?.semantics?.comments, ['Implementation notes']);
});

test('ingestWebhook writes project events and extracts project relations', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({}, writes);

  const result = await adapter.ingestWebhook('ws_relay', {
    provider: 'asana',
    eventType: 'project.changed',
    objectType: 'project',
    objectId: 'project_1',
    payload: {
      gid: 'project_1',
      name: 'Adapters',
      archived: false,
      owner: { gid: 'user_1', name: 'Ada' },
      workspace: { gid: 'workspace_1', name: 'Engineering' },
      current_status: { color: 'green', title: 'On track', text: 'Healthy' },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/asana/projects/project_1.json']);
  assert.equal(writes[0]?.semantics?.properties?.['asana.status_title'], 'On track');
  assert.deepEqual(writes[0]?.semantics?.relations, ['/asana/workspaces/workspace_1.json']);
});

test('ingestWebhook writes section events and extracts parent project relation', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({}, writes);

  const result = await adapter.ingestWebhook('ws_relay', {
    provider: 'asana',
    eventType: 'section.added',
    objectType: 'section',
    objectId: 'section_1',
    payload: {
      gid: 'section_1',
      name: 'Backlog',
      project: { gid: 'project_1', name: 'Adapters' },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/asana/sections/section_1.json']);
  assert.deepEqual(writes[0]?.semantics?.relations, ['/asana/projects/project_1.json']);
});

test('ingestWebhook writes workspace events and extracts organization fields', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({}, writes);

  const result = await adapter.ingestWebhook('ws_relay', {
    provider: 'asana',
    eventType: 'workspace.changed',
    objectType: 'workspace',
    objectId: 'workspace_1',
    payload: {
      gid: 'workspace_1',
      name: 'Engineering',
      is_organization: true,
      email_domains: ['example.com', 'relay.test'],
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/asana/workspaces/workspace_1.json']);
  assert.equal(writes[0]?.semantics?.properties?.['asana.email_domain_count'], '2');
  assert.equal(writes[0]?.semantics?.properties?.['asana.is_organization'], 'true');
});

test('ingestWebhook writes every event from raw Asana webhook batches', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({ connectionId: 'conn_asana_123' }, writes);

  const result = await adapter.ingestWebhook('ws_relay', {
    events: [
      {
        action: 'changed',
        resource: { gid: 'task_1', name: 'Task one', resource_type: 'task' },
      },
      {
        action: 'added',
        resource: { gid: 'project_1', name: 'Project one', resource_type: 'project' },
      },
    ],
  });

  assert.equal(result.filesWritten, 2);
  assert.deepEqual(result.paths, ['/asana/tasks/task_1.json', '/asana/projects/project_1.json']);
  assert.deepEqual(writes.map((write) => write.path), result.paths);
  assert.equal(JSON.parse(writes[0]?.content ?? '{}').connectionId, 'conn_asana_123');
});

test('computeSemantics extracts task custom fields and path relations deterministically', () => {
  const adapter = createAdapter();

  const semantics = adapter.computeSemantics('AsanaTask', 'task_1', {
    gid: 'task_1',
    name: 'Review launch list',
    completed: true,
    parent: { gid: 'task_parent', name: 'Launch' },
    project_ids: ['project_b', 'project_a'],
    section_ids: ['section_b', 'section_a'],
    custom_fields: [
      { gid: 'field_1', name: 'Priority', display_value: 'High' },
      { gid: 'field_2', name: 'Estimate', number_value: 3 },
    ],
    _webhook: {
      action: 'changed',
      createdAt: '2026-05-01T10:00:00.000Z',
      deliveryId: 'delivery_1',
    },
  });

  assert.equal(semantics.properties?.['asana.custom_field.priority'], 'High');
  assert.equal(semantics.properties?.['asana.custom_field.estimate'], '3');
  assert.equal(semantics.properties?.['asana.completed'], 'true');
  assert.deepEqual(semantics.relations, [
    '/asana/projects/project_a.json',
    '/asana/projects/project_b.json',
    '/asana/sections/section_a.json',
    '/asana/sections/section_b.json',
    '/asana/tasks/task_parent.json',
  ]);
});

test('path mapper, read routes, and writeback routes cover primary Asana objects', () => {
  const adapter = createAdapter();

  assert.equal(asanaTaskPath('task 1/2'), '/asana/tasks/task%201%2F2.json');
  assert.equal(asanaProjectPath('project#7'), '/asana/projects/project%237.json');
  assert.equal(asanaSectionPath('section:42'), '/asana/sections/section%3A42.json');
  assert.equal(asanaWorkspacePath('workspace alpha'), '/asana/workspaces/workspace%20alpha.json');
  assert.equal(computeAsanaPath('Tasks', '12001', 'Ship adapter'), '/asana/tasks/12001.json');
  assert.equal(adapter.computePath('projects', 'project_1', 'Adapters'), '/asana/projects/project_1.json');

  assert.deepEqual(resolveAsanaReadRequest('/asana/tasks/ship--12001.json').endpoint, '/api/1.0/tasks/12001');
  assert.deepEqual(resolveAsanaReadRequest('/asana/projects/adapters--project_1.json').endpoint, '/api/1.0/projects/project_1');

  assert.deepEqual(resolveAsanaWritebackRequest('/asana/tasks/draft-task.json', '{"name":"New task","workspace":"workspace_1"}'), {
    action: 'create_task',
    method: 'POST',
    endpoint: '/api/1.0/tasks',
    body: { data: { name: 'New task', workspace: 'workspace_1' } },
  });
  assert.deepEqual(resolveAsanaWritebackRequest('/asana/projects/12002.json', '{"name":"Renamed"}'), {
    action: 'update_project',
    method: 'PUT',
    endpoint: '/api/1.0/projects/12002',
    body: { data: { name: 'Renamed' } },
  });
  assert.throws(
    () => resolveAsanaWritebackRequest('/asana/tasks/12001.json', '{"id":"12001","name":"Renamed"}'),
    (error: unknown) => error instanceof ReadOnlyFieldError && error.field === 'id',
  );
  assert.throws(
    () => resolveAsanaWritebackRequest('/asana/tasks/draft-task.json', '{"workspace":"workspace_1"}'),
    /requires a non-empty `name`/,
  );
  assert.deepEqual(resolveAsanaDeleteRequest('/asana/tasks/12001.json'), {
    action: 'delete_task',
    method: 'DELETE',
    endpoint: '/api/1.0/tasks/12001',
  });
  assert.throws(
    () => resolveAsanaDeleteRequest('/asana/tasks/draft-task.json'),
    /No Asana delete writeback rule matched/,
  );
});
