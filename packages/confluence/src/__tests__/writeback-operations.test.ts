import assert from 'node:assert/strict';
import test from 'node:test';

import { resources } from '../resources.js';
import { resolveConfluenceDeleteRequest, resolveConfluenceWritebackRequest } from '../writeback.js';

const PAGE = JSON.stringify({ title: 'Runbook', spaceId: '98304', body: '<p>Hello</p>' });

test('confluence page resources declare create, update, and delete', () => {
  assert.deepEqual(
    Object.fromEntries(resources.map((resource) => [resource.path, resource.operations])),
    {
      '/confluence/pages': ['create', 'update', 'delete'],
      '/confluence/spaces/{spaceIdOrKey}/pages': ['create', 'update', 'delete'],
    },
  );
});

test('confluence flat and space-scoped pages route create, update, and delete', () => {
  for (const root of ['/confluence/pages', '/confluence/spaces/OPS/pages']) {
    assert.equal(resolveConfluenceWritebackRequest(`${root}/new-page.json`, PAGE).action, 'create_page', root);
    assert.equal(resolveConfluenceWritebackRequest(`${root}/runbook__12345.json`, PAGE).action, 'update_page', root);
    assert.equal(resolveConfluenceDeleteRequest(`${root}/runbook__12345.json`).action, 'delete_page', root);
  }
});
