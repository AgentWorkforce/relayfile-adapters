import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWrite } from '@relayfile/adapter-core';

import { resources } from '../resources.js';
import { resolveDeleteRequest, resolveWritebackRequest } from '../writeback.js';

test('clickup nested resources declare create-only operations', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.path, resource.operations])),
    {
      '/clickup/tasks/{taskId}/comments': ['create'],
      '/clickup/lists/{listId}/tasks': ['create'],
      '/clickup/folders/{folderId}/lists': ['create'],
      '/clickup/spaces/{spaceId}/lists': ['create'],
      '/clickup/spaces/{spaceId}/folders': ['create'],
    },
  );
});

test('clickup nested resources route creates but not canonical updates or deletes', () => {
  assert.equal(resolveWritebackRequest('/clickup/tasks/abc123/comments/new-comment.json', '{"comment_text":"Hi"}').action, 'task_comment');
  assert.equal(resolveWritebackRequest('/clickup/lists/L1/tasks/new-task.json', '{"name":"Task"}').action, 'create_task');
  assert.equal(resolveWritebackRequest('/clickup/folders/F1/lists/new-list.json', '{"name":"List"}').action, 'create_list');
  assert.equal(resolveWritebackRequest('/clickup/spaces/S1/lists/new-list.json', '{"name":"List"}').action, 'create_list');
  assert.equal(resolveWritebackRequest('/clickup/spaces/S1/folders/new-folder.json', '{"name":"Folder"}').action, 'create_folder');

  for (const path of [
    '/clickup/tasks/abc123/comments/c1.json',
    '/clickup/lists/L1/tasks/abc123.json',
    '/clickup/folders/F1/lists/L2.json',
    '/clickup/spaces/S1/lists/L2.json',
    '/clickup/spaces/S1/folders/F2.json',
  ]) {
    assert.equal(classifyWrite(path, resources), null, path);
    assert.equal(classifyWrite(path, resources, { fsEvent: 'delete' }), null, path);
    assert.throws(() => resolveWritebackRequest(path, '{"name":"Edited"}'), /No ClickUp writeback rule matched/);
    assert.throws(() => resolveDeleteRequest(path), /No ClickUp delete writeback rule matched/);
  }
});

test('clickup top-level record paths still route updates and deletes', () => {
  assert.equal(resolveWritebackRequest('/clickup/tasks/abc123.json', '{"name":"Renamed"}').action, 'update_task');
  assert.equal(resolveDeleteRequest('/clickup/tasks/abc123.json').action, 'delete_task');
  assert.equal(resolveWritebackRequest('/clickup/lists/L1.json', '{"name":"Renamed"}').action, 'update_list');
  assert.equal(resolveDeleteRequest('/clickup/lists/L1.json').action, 'delete_list');
  assert.equal(resolveWritebackRequest('/clickup/folders/F1.json', '{"name":"Renamed"}').action, 'update_folder');
  assert.equal(resolveDeleteRequest('/clickup/folders/F1.json').action, 'delete_folder');
  assert.equal(resolveWritebackRequest('/clickup/spaces/S1.json', '{"name":"Renamed"}').action, 'update_space');
});
