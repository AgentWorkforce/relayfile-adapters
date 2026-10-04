import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWrite } from '@relayfile/adapter-core';

import { resources } from '../resources.js';
import { resolveJiraDeleteRequest, resolveJiraWritebackRequest } from '../writeback.js';

test('jira resources declare the operations the writeback resolver implements', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.name, resource.operations])),
    {
      comments: ['create', 'update', 'delete'],
      issues: ['create', 'update', 'delete'],
      transitions: ['create'],
      projects: ['create', 'update', 'delete'],
    },
  );
});

test('jira transitions only route creates', () => {
  assert.equal(
    resolveJiraWritebackRequest('/jira/issues/ENG-1/transitions/move.json', '{"transition":{"id":"31"}}').action,
    'transition_issue',
  );
  assert.equal(classifyWrite('/jira/issues/ENG-1/transitions/31.json', resources, { fsEvent: 'delete' }), null);
  assert.throws(
    () => resolveJiraDeleteRequest('/jira/issues/ENG-1/transitions/31.json'),
    /No Jira delete writeback rule matched/,
  );
});

test('jira comments, issues, and projects still route create, update, and delete', () => {
  assert.equal(resolveJiraWritebackRequest('/jira/issues/ENG-1/comments/reply.json', '{"body":"Hi"}').action, 'create_comment');
  assert.equal(resolveJiraWritebackRequest('/jira/issues/ENG-1/comments/10001.json', '{"body":"Edited"}').action, 'update_comment');
  assert.equal(resolveJiraDeleteRequest('/jira/issues/ENG-1/comments/10001.json').action, 'delete_comment');

  assert.equal(
    resolveJiraWritebackRequest(
      '/jira/issues/new-bug.json',
      '{"fields":{"project":{"key":"ENG"},"summary":"Bug","issuetype":{"name":"Bug"}}}',
    ).action,
    'create_issue',
  );
  assert.equal(resolveJiraWritebackRequest('/jira/issues/ENG-1.json', '{"fields":{"summary":"Renamed"}}').action, 'update_issue');
  assert.equal(resolveJiraDeleteRequest('/jira/issues/ENG-1.json').action, 'delete_issue');

  assert.equal(
    resolveJiraWritebackRequest(
      '/jira/projects/new-project.json',
      '{"key":"OPS","name":"Ops","projectTypeKey":"software","leadAccountId":"abc"}',
    ).action,
    'create_project',
  );
  assert.equal(resolveJiraWritebackRequest('/jira/projects/10000.json', '{"name":"Engineering"}').action, 'update_project');
  assert.equal(resolveJiraDeleteRequest('/jira/projects/10000.json').action, 'delete_project');
});
