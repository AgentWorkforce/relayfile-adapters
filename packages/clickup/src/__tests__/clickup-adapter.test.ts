import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ClickUpAdapter,
  clickUpFolderPath,
  clickUpListPath,
  clickUpSpacePath,
  clickUpTaskPath,
  computeClickUpPath,
  normalizeClickUpWebhook,
  resolveReadRequest,
  resolveWritebackRequest,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

interface RecordingClient extends RelayFileClientLike {
  writes: WriteFileInput[];
}

function createAdapter(): { adapter: ClickUpAdapter; client: RecordingClient } {
  const client: RecordingClient = {
    writes: [],
    async writeFile(input) {
      this.writes.push(input);
      return { created: true };
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

  return { adapter: new ClickUpAdapter(client, provider), client };
}

test('ClickUpAdapter exposes provider metadata and supported events', () => {
  const { adapter } = createAdapter();

  assert.equal(adapter.name, 'clickup');
  assert.deepEqual(adapter.supportedEvents(), [
    'folder.created',
    'folder.updated',
    'folder.deleted',
    'list.created',
    'list.updated',
    'list.deleted',
    'space.created',
    'space.updated',
    'space.deleted',
    'task.created',
    'task.updated',
    'task.deleted',
  ]);
});

test('ingestWebhook writes task payloads with semantics and deterministic path', async () => {
  const { adapter, client } = createAdapter();
  const normalized = normalizeClickUpWebhook({
    event: 'taskCreated',
    task_id: 'task_123',
    data: {
      id: 'task_123',
      name: 'Ship ClickUp adapter',
      status: { status: 'in progress', type: 'custom' },
      priority: { priority: 'high' },
      list: { id: 'list_123', name: 'Adapters' },
      folder: { id: 'folder_123', name: 'Platform' },
      space: { id: 'space_123', name: 'Engineering' },
      tags: [{ name: 'adapter' }],
    },
  });

  const result = await adapter.ingestWebhook('workspace_1', normalized);

  assert.equal(result.filesWritten, 1);
  assert.equal(client.writes[0]?.path, '/clickup/tasks/ship-clickup-adapter--task_123.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['clickup.status'], 'in progress');
  assert.equal(client.writes[0]?.semantics?.properties?.['clickup.priority'], 'high');
  assert.deepEqual(client.writes[0]?.semantics?.relations, [
    '/clickup/folders/platform--folder_123.json',
    '/clickup/lists/adapters--list_123.json',
    '/clickup/spaces/engineering--space_123.json',
    'clickup:tag:adapter',
  ]);
});

test('ingestWebhook writes list payloads', async () => {
  const { adapter, client } = createAdapter();

  const result = await adapter.ingestWebhook('workspace_1', {
    provider: 'clickup',
    eventType: 'list.created',
    objectType: 'list',
    objectId: 'list_123',
    payload: {
      id: 'list_123',
      name: 'Adapter QA',
      folder: { id: 'folder_123', name: 'Engineering' },
      space: { id: 'space_123', name: 'Product' },
      task_count: 4,
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(client.writes[0]?.path, '/clickup/lists/adapter-qa--list_123.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['clickup.task_count'], '4');
});

test('ingestWebhook writes space payloads', async () => {
  const { adapter, client } = createAdapter();

  const result = await adapter.ingestWebhook('workspace_1', {
    event: 'spaceUpdated',
    space_id: 'space_123',
    data: {
      id: 'space_123',
      name: 'Engineering',
      private: true,
      statuses: [{ status: 'open' }, { status: 'closed' }],
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(client.writes[0]?.path, '/clickup/spaces/engineering--space_123.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['clickup.status_count'], '2');
  assert.deepEqual(client.writes[0]?.semantics?.permissions, ['scope:private']);
});

test('ingestWebhook writes folder payloads', async () => {
  const { adapter, client } = createAdapter();

  const result = await adapter.ingestWebhook('workspace_1', {
    event: 'folderCreated',
    folder_id: 'folder_123',
    data: {
      id: 'folder_123',
      name: 'Platform',
      hidden: true,
      space: { id: 'space_123', name: 'Engineering' },
      lists: [{ id: 'list_123' }, { id: 'list_456' }],
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(client.writes[0]?.path, '/clickup/folders/platform--folder_123.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['clickup.list_count'], '2');
  assert.deepEqual(client.writes[0]?.semantics?.permissions, ['visibility:hidden']);
});

test('computeSemantics extracts task relations, assignees, and custom fields', () => {
  const { adapter } = createAdapter();

  const semantics = adapter.computeSemantics('task', 'task_123', {
    id: 'task_123',
    name: 'Review launch plan',
    assignees: [{ id: 7, username: 'Ava' }],
    parent: 'task_parent',
    dependencies: [{ id: 'task_dep' }],
    linked_tasks: [{ id: 'task_linked' }],
    custom_fields: [{ name: 'Risk', value: 'medium' }],
  });

  assert.equal(semantics.properties?.['clickup.assignee_ids'], '7');
  assert.equal(semantics.properties?.['clickup.custom_fields'], 'Risk:medium');
  assert.deepEqual(semantics.relations, [
    '/clickup/tasks/task_dep.json',
    '/clickup/tasks/task_linked.json',
    '/clickup/tasks/task_parent.json',
    'clickup:user:7',
  ]);
  assert.deepEqual(semantics.comments, ['depends_on:task_dep', 'linked_task:task_linked']);
});

test('path mapper, read resolver, and writeback resolver cover ClickUp task and list routes', () => {
  const { adapter } = createAdapter();

  assert.equal(clickUpTaskPath('task 1/2', 'Fix prod bug'), '/clickup/tasks/fix-prod-bug--task%201%2F2.json');
  assert.equal(clickUpListPath('list:42', 'Sprint Backlog'), '/clickup/lists/sprint-backlog--list%3A42.json');
  assert.equal(clickUpFolderPath('folder#7', 'Product Area'), '/clickup/folders/product-area--folder%237.json');
  assert.equal(clickUpSpacePath('space 9', 'Engineering'), '/clickup/spaces/engineering--space%209.json');
  assert.equal(computeClickUpPath('Tasks', 'task_123', 'Hello World'), '/clickup/tasks/hello-world--task_123.json');
  assert.equal(adapter.computePath('list', 'list_123'), '/clickup/lists/list_123.json');

  assert.deepEqual(resolveReadRequest('/clickup/tasks/hello-world--task_123.json'), {
    action: 'get_task',
    method: 'GET',
    endpoint: '/api/v2/task/task_123',
  });
  assert.deepEqual(resolveReadRequest('/clickup/lists/list_123/tasks.json'), {
    action: 'list_tasks',
    method: 'GET',
    endpoint: '/api/v2/list/list_123/task',
    query: {
      include_closed: 'true',
      subtasks: 'true',
    },
  });
  assert.deepEqual(resolveWritebackRequest('/clickup/lists/list_123/tasks/new.json', '{"name":"New task"}'), {
    action: 'create_task',
    method: 'POST',
    endpoint: '/api/v2/list/list_123/task',
    body: { name: 'New task' },
  });
});
