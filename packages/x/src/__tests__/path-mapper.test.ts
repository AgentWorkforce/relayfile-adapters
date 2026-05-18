import assert from 'node:assert/strict';
import test from 'node:test';

import { aliasCollisionSuffix } from '../alias-slug.js';
import {
  computeXPath,
  extractXObjectIdFromPath,
  parseXRecordName,
  xPostByAuthorAliasPath,
  xPostByConversationAliasPath,
  xPostPath,
  xSearchByQueryAliasPath,
  xSearchMetaPath,
  xSearchResultPath,
  xUserByUsernameAliasPath,
} from '../path-mapper.js';

test('X path helpers compose directory and flat record paths with the shared joiner', () => {
  assert.equal(
    xSearchMetaPath('search_123', 'Looking for workflow automation'),
    '/x/searches/search_123__looking-for-workflow-automation/meta.json',
  );
  assert.equal(
    xSearchResultPath('search_123', 'Looking for workflow automation', '1880001'),
    '/x/searches/search_123__looking-for-workflow-automation/results/1880001.json',
  );
  assert.equal(
    xPostPath('1880001', 'Looking for a workflow automation tool'),
    '/x/posts/looking-for-a-workflow-automation-tool__1880001.json',
  );
  assert.equal(
    xUserByUsernameAliasPath('XDevelopers', '2244994945'),
    '/x/users/by-username/xdevelopers__2244994945.json',
  );
});

test('X path helpers parse ids back from canonical records', () => {
  const post = xPostPath('1880001', 'Need agent workflow help');
  assert.equal(extractXObjectIdFromPath(post), '1880001');
  assert.equal(extractXObjectIdFromPath('/x/users/xdevelopers__2244994945.json'), '2244994945');
  assert.equal(extractXObjectIdFromPath('/x/searches/search_123__agent-workflows/meta.json'), 'search_123');
  assert.deepEqual(parseXRecordName('agent-workflows__1880001.json'), {
    slug: 'agent-workflows',
    id: '1880001',
    ext: 'json',
  });
});

test('computeXPath and alias helpers are deterministic', () => {
  assert.equal(computeXPath('tweet', '1880001', 'Agent workflows'), '/x/posts/agent-workflows__1880001.json');
  assert.equal(computeXPath('saved search', 's1', 'Agent workflows'), '/x/searches/s1__agent-workflows/meta.json');
  assert.equal(xPostByAuthorAliasPath('xdevelopers', '1880001'), '/x/posts/by-author/xdevelopers/1880001.json');
  assert.equal(xPostByConversationAliasPath('1880000', '1880001'), '/x/posts/by-conversation/1880000/1880001.json');
  assert.equal(xSearchByQueryAliasPath('"agent workflow"', 's1'), '/x/searches/by-query/agent-workflow__s1.json');
});

test('collision-aware X aliases append deterministic id hashes', () => {
  assert.equal(
    xSearchByQueryAliasPath('same query', 'search-a', true),
    `/x/searches/by-query/same-query-${aliasCollisionSuffix('search-a')}__search-a.json`,
  );
  assert.equal(
    xUserByUsernameAliasPath('samehandle', 'user-a', true),
    `/x/users/by-username/samehandle-${aliasCollisionSuffix('user-a')}__user-a.json`,
  );
});
