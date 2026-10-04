import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWrite } from '@relayfile/adapter-core';

import { resources } from '../resources.js';
import { resolveDeleteRequest, resolveWritebackRequest } from '../writeback.js';

const ISSUE = 'onboarding-bug__8f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const LABEL = 'bug__1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const PROJECT = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const SESSION = 'session-1';

test('linear resources declare the operations the writeback resolver implements', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.path, resource.operations])),
    {
      '/linear/issues': ['create', 'update', 'delete'],
      '/linear/issues/{issueId}/comments': ['create'],
      '/linear/labels': ['create', 'update', 'delete'],
      '/linear/projects': ['create', 'update'],
      '/linear/projects/{projectId}/meta.json': ['update'],
      '/linear/projects/{projectId}/add-issues.json': ['update'],
      '/linear/agent-sessions/{sessionId}/activities': ['create'],
    },
  );
});

test('linear create-only resources do not route updates or deletes', () => {
  assert.equal(resolveWritebackRequest(`/linear/issues/${ISSUE}/comments/reply.json`, '{"body":"Hi"}').action, 'create_comment');
  assert.equal(
    resolveWritebackRequest(`/linear/agent-sessions/${SESSION}/activities/note.json`, '{"type":"thought","body":"Thinking"}').action,
    'create_agent_activity',
  );
  for (const path of [
    `/linear/issues/${ISSUE}/comments/9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.json`,
    `/linear/agent-sessions/${SESSION}/activities/activity_abc123.json`,
  ]) {
    assert.throws(() => resolveWritebackRequest(path, '{"body":"Edited"}'), /No Linear writeback rule matched/);
    assert.throws(() => resolveDeleteRequest(path), /No Linear delete writeback rule matched/);
  }
});

test('linear projects support create and update but never delete', () => {
  assert.equal(
    resolveWritebackRequest('/linear/projects/factory-create-1.json', `{"name":"Launch","teamIds":["${PROJECT}"]}`).action,
    'create-project',
  );
  assert.equal(resolveWritebackRequest(`/linear/projects/${PROJECT}.json`, '{"name":"Renamed"}').action, 'update-project');
  assert.equal(resolveWritebackRequest(`/linear/projects/${PROJECT}/meta.json`, '{"state":"started"}').action, 'update-project');
  assert.equal(
    resolveWritebackRequest(`/linear/projects/${PROJECT}/add-issues.json`, `{"issueIds":["${PROJECT}"]}`).action,
    'add-issues-to-project',
  );
  for (const path of [
    `/linear/projects/${PROJECT}.json`,
    `/linear/projects/${PROJECT}/meta.json`,
    `/linear/projects/${PROJECT}/add-issues.json`,
  ]) {
    assert.equal(classifyWrite(path, resources, { fsEvent: 'delete' }), null);
    assert.throws(() => resolveDeleteRequest(path), /No Linear delete writeback rule matched/);
  }
});

test('linear issues and labels still route create, update, and delete', () => {
  assert.equal(
    resolveWritebackRequest('/linear/issues/new-bug.json', `{"title":"Bug","teamId":"${PROJECT}"}`).action,
    'create_issue',
  );
  assert.equal(resolveWritebackRequest(`/linear/issues/${ISSUE}.json`, '{"title":"Renamed"}').action, 'update_issue');
  assert.equal(resolveDeleteRequest(`/linear/issues/${ISSUE}.json`).action, 'delete_issue');
  assert.equal(resolveWritebackRequest('/linear/labels/new-label.json', '{"name":"bug"}').action, 'create_label');
  assert.equal(resolveWritebackRequest(`/linear/labels/${LABEL}.json`, '{"color":"#ff0000"}').action, 'update_label');
  assert.equal(resolveDeleteRequest(`/linear/labels/${LABEL}.json`).action, 'delete_label');
});
