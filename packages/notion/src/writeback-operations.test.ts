import assert from 'node:assert/strict';
import test from 'node:test';

import { resources } from './resources.js';
import { resolveDeleteRequest, resolveWritebackRequest } from './writeback.js';

const PAGE = 'plan__0123456789abcdef0123456789abcdef';
const DB_PAGE = `/notion/databases/db1/pages/${PAGE}`;
const STANDALONE_PAGE = `/notion/pages/${PAGE}`;
const PROPERTIES = '{"properties":{"Status":{"type":"select","value":"In progress"}}}';

test('notion resources declare the operations the resolver implements', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.path, resource.operations])),
    {
      '/notion/databases/{databaseId}/pages': ['create', 'update', 'delete'],
      '/notion/databases/{databaseId}/pages/{pageId}/meta.json': ['update', 'delete'],
      '/notion/databases/{databaseId}/pages/{pageId}/properties.json': ['update'],
      '/notion/databases/{databaseId}/pages/{pageId}/content.md': ['update'],
      '/notion/databases/{databaseId}/pages/{pageId}/comments.json': ['update'],
      '/notion/pages/{pageId}/meta.json': ['update', 'delete'],
      '/notion/pages/{pageId}/properties.json': ['update'],
      '/notion/pages/{pageId}/content.md': ['update'],
      '/notion/pages/{pageId}/comments.json': ['update'],
    },
  );
});

test('notion database pages route create, update, and archive', () => {
  assert.equal(resolveWritebackRequest('/notion/databases/db1/pages/new.json', PROPERTIES).action, 'create_page');
  assert.equal(resolveWritebackRequest(`${DB_PAGE}.json`, PROPERTIES).action, 'update_page_properties');
  assert.equal(resolveDeleteRequest(`${DB_PAGE}.json`).action, 'delete_page');
});

test('notion page sidecars route writes, and only meta.json archives', () => {
  for (const page of [DB_PAGE, STANDALONE_PAGE]) {
    assert.equal(resolveWritebackRequest(`${page}/meta.json`, PROPERTIES).action, 'update_page_properties', page);
    assert.equal(resolveDeleteRequest(`${page}/meta.json`).action, 'delete_page', page);
    assert.equal(resolveWritebackRequest(`${page}/properties.json`, PROPERTIES).action, 'update_page_properties', page);
    assert.equal(resolveWritebackRequest(`${page}/content.md`, '# Replace page content').action, 'update_page_markdown', page);
    // comments.json is an exact sidecar file, so the router classifies the write as an update; the resolver posts a comment.
    assert.equal(resolveWritebackRequest(`${page}/comments.json`, '{"text":"Example"}').action, 'create_comment', page);
    for (const sidecar of ['properties.json', 'content.md', 'comments.json']) {
      assert.throws(() => resolveDeleteRequest(`${page}/${sidecar}`), /No Notion delete writeback rule matched/, `${page}/${sidecar}`);
    }
  }
});
