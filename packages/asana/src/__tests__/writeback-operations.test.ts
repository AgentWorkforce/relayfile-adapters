import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWrite } from '@relayfile/adapter-core';

import { resources } from '../resources.js';
import { resolveAsanaDeleteRequest, resolveAsanaWritebackRequest } from '../writeback.js';

test('asana resources declare the operations the writeback resolver implements', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.path, resource.operations])),
    {
      '/asana/tasks': ['create', 'update', 'delete'],
      '/asana/projects': ['create', 'update', 'delete'],
      '/asana/sections': ['create', 'update', 'delete'],
      '/asana/projects/{projectId}/sections': ['create'],
    },
  );
});

test('asana project-scoped sections only route creates', () => {
  assert.equal(
    resolveAsanaWritebackRequest('/asana/projects/1200/sections/new-section.json', '{"name":"Backlog"}').action,
    'create_section',
  );
  const canonical = '/asana/projects/1200/sections/1300.json';
  assert.equal(classifyWrite(canonical, resources), null);
  assert.equal(classifyWrite(canonical, resources, { fsEvent: 'delete' }), null);
  assert.throws(() => resolveAsanaWritebackRequest(canonical, '{"name":"Renamed"}'), /No Asana writeback rule matched/);
  assert.throws(() => resolveAsanaDeleteRequest(canonical), /No Asana delete writeback rule matched/);
});

test('asana tasks, projects, and sections still route create, update, and delete', () => {
  assert.equal(resolveAsanaWritebackRequest('/asana/tasks/new-task.json', '{"name":"Task"}').action, 'create_task');
  assert.equal(resolveAsanaWritebackRequest('/asana/tasks/1200.json', '{"name":"Renamed"}').action, 'update_task');
  assert.equal(resolveAsanaDeleteRequest('/asana/tasks/1200.json').action, 'delete_task');
  assert.equal(resolveAsanaWritebackRequest('/asana/projects/new-project.json', '{"name":"Project"}').action, 'create_project');
  assert.equal(resolveAsanaWritebackRequest('/asana/projects/1200.json', '{"name":"Renamed"}').action, 'update_project');
  assert.equal(resolveAsanaDeleteRequest('/asana/projects/1200.json').action, 'delete_project');
  assert.equal(
    resolveAsanaWritebackRequest('/asana/sections/new-section.json', '{"name":"Doing","project":"1200"}').action,
    'create_section',
  );
  assert.equal(resolveAsanaWritebackRequest('/asana/sections/1300.json', '{"name":"Renamed"}').action, 'update_section');
  assert.equal(resolveAsanaDeleteRequest('/asana/sections/1300.json').action, 'delete_section');
  assert.equal(resolveAsanaWritebackRequest('/asana/tasks/1200/projects/1300.json', '{}').action, 'add_task_to_project');
});
