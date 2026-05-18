import assert from 'node:assert/strict';
import test from 'node:test';

import { aliasCollisionSuffix } from '../alias-slug.js';
import {
  computeXPath,
  extractXObjectIdFromPath,
  parseXRecordName,
  xPostByAuthorAliasPath,
  xPostByConversationAliasPath,
  xPostByIdAliasPath,
  xPostByQueryAliasPath,
  xPostPath,
  xPostsIndexPath,
  xRootIndexPath,
  xSearchByIdAliasPath,
  xSearchByQueryAliasPath,
  xSearchDirectoryPath,
  xSearchMetaPath,
  xSearchResultPath,
  xSearchResultsIndexPath,
  xSearchesIndexPath,
  xUserByIdAliasPath,
  xUserByUsernameAliasPath,
  xUserPath,
  xUsersIndexPath,
} from '../path-mapper.js';

function assertCanonicalRoundTrip(path: string, id: string) {
  assert.equal(extractXObjectIdFromPath(path), id);
}

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

test('X index helpers return stable provider roots', () => {
  assert.equal(xRootIndexPath(), '/x/_index.json');
  assert.equal(xSearchesIndexPath(), '/x/searches/_index.json');
  assert.equal(xPostsIndexPath(), '/x/posts/_index.json');
  assert.equal(xUsersIndexPath(), '/x/users/_index.json');
});

test('X canonical helpers round-trip ASCII-clean labels', () => {
  assert.equal(
    xSearchDirectoryPath('search123', 'Agent workflows'),
    '/x/searches/search123__agent-workflows',
  );
  assert.equal(
    xSearchResultsIndexPath('search123', 'Agent workflows'),
    '/x/searches/search123__agent-workflows/results/_index.json',
  );
  assertCanonicalRoundTrip(xSearchMetaPath('search123', 'Agent workflows'), 'search123');
  assertCanonicalRoundTrip(xPostPath('post123', 'Agent workflows'), 'post123');
  assertCanonicalRoundTrip(xUserPath('user123', 'X Developers'), 'user123');
  assert.equal(
    xSearchResultPath('search123', 'Agent workflows', 'post123'),
    '/x/searches/search123__agent-workflows/results/post123.json',
  );
});

test('X canonical helpers round-trip slug-collapsing and encoded ids', () => {
  assertCanonicalRoundTrip(
    xSearchMetaPath('search/123', '  Café!!! workflows — now  '),
    'search/123',
  );
  assertCanonicalRoundTrip(
    xPostPath('post/123', 'Need: workflow + automation!!!'),
    'post/123',
  );
  assertCanonicalRoundTrip(
    xUserPath('user.123', 'Mona Lisa!!!'),
    'user.123',
  );
  assert.equal(
    xPostPath('post/123', 'Need: workflow + automation!!!'),
    '/x/posts/need-workflow-automation__post%2F123.json',
  );
  assert.equal(
    xUserPath('user.123', 'Mona Lisa!!!'),
    '/x/users/mona-lisa__user%2E123.json',
  );
});

test('X search directory helpers round-trip provider ids containing the canonical joiner', () => {
  const path = xSearchMetaPath('search__custom', 'Title');
  assert.equal(path, '/x/searches/search%5F%5Fcustom__title/meta.json');
  assert.equal(extractXObjectIdFromPath(path), 'search__custom');
  assert.equal(
    xSearchResultsIndexPath('search__custom', 'Title'),
    '/x/searches/search%5F%5Fcustom__title/results/_index.json',
  );
  assert.equal(
    xSearchResultPath('search__custom', 'Title', 'post__1'),
    '/x/searches/search%5F%5Fcustom__title/results/post__1.json',
  );
  assert.equal(
    computeXPath('saved search', 'search__custom', 'Title'),
    '/x/searches/search%5F%5Fcustom__title/meta.json',
  );
  assert.equal(
    extractXObjectIdFromPath(computeXPath('saved search', 'search__custom', 'Title')),
    'search__custom',
  );
  assert.equal(extractXObjectIdFromPath(xSearchMetaPath('search__custom')), 'search__custom');
});

test('X canonical helpers fall back deterministically for missing or empty labels', () => {
  assertCanonicalRoundTrip(xSearchMetaPath('search123'), 'search123');
  assertCanonicalRoundTrip(xSearchMetaPath('search123', ''), 'search123');
  assertCanonicalRoundTrip(xPostPath('post123'), 'post123');
  assertCanonicalRoundTrip(xPostPath('post123', '!!!'), 'post123');
  assertCanonicalRoundTrip(xUserPath('user123'), 'user123');
  assertCanonicalRoundTrip(xUserPath('user123', null), 'user123');
  assert.equal(xSearchMetaPath('search123'), '/x/searches/search123/meta.json');
  assert.equal(xPostPath('post123', '!!!'), '/x/posts/post123.json');
  assert.equal(xUserPath('user123', null), '/x/users/user123.json');
});

test('X alias helpers cover by-id, by-query, by-author, by-conversation, and by-username shapes', () => {
  assert.equal(xSearchByIdAliasPath('search.123'), '/x/searches/by-id/search%2E123.json');
  assert.equal(xSearchByQueryAliasPath('Agent workflow?', 'search123'), '/x/searches/by-query/agent-workflow__search123.json');
  assert.equal(xPostByIdAliasPath('post.123'), '/x/posts/by-id/post%2E123.json');
  assert.equal(xPostByAuthorAliasPath('X Developers', 'post123'), '/x/posts/by-author/x-developers/post123.json');
  assert.equal(xPostByConversationAliasPath('conversation.123', 'post123'), '/x/posts/by-conversation/conversation%2E123/post123.json');
  assert.equal(xPostByQueryAliasPath('search.123', 'post.123'), '/x/posts/by-query/search%2E123/post%2E123.json');
  assert.equal(xUserByIdAliasPath('user.123'), '/x/users/by-id/user%2E123.json');
  assert.equal(xUserByUsernameAliasPath('X Developers', 'user123'), '/x/users/by-username/x-developers__user123.json');
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
  assert.equal(computeXPath('author', 'u1', 'Mona Lisa'), '/x/users/mona-lisa__u1.json');
  assert.equal(xPostByAuthorAliasPath('xdevelopers', '1880001'), '/x/posts/by-author/xdevelopers/1880001.json');
  assert.equal(xPostByConversationAliasPath('1880000', '1880001'), '/x/posts/by-conversation/1880000/1880001.json');
  assert.equal(xSearchByQueryAliasPath('"agent workflow"', 's1'), '/x/searches/by-query/agent-workflow__s1.json');
});

test('parseXRecordName handles flat, joined, encoded, and extensionless names', () => {
  assert.deepEqual(parseXRecordName('1880001.json'), { slug: null, id: '1880001', ext: 'json' });
  assert.deepEqual(parseXRecordName('agent-workflows__1880001.json'), {
    slug: 'agent-workflows',
    id: '1880001',
    ext: 'json',
  });
  assert.deepEqual(parseXRecordName('agent-workflows__post%2F123.json'), {
    slug: 'agent-workflows',
    id: 'post/123',
    ext: 'json',
  });
  assert.deepEqual(parseXRecordName('agent-workflows__post%2F123'), {
    slug: 'agent-workflows',
    id: 'post/123',
    ext: null,
  });
});

test('malformed percent escapes do not leak URIError from X path parsing', () => {
  assert.equal(extractXObjectIdFromPath('/x/posts/foo%bar.json'), 'foo%bar');
  assert.equal(extractXObjectIdFromPath('/x/searches/search%bad__saved-query/meta.json'), 'search%bad');
  assert.throws(
    () => extractXObjectIdFromPath('/x/posts/by-author/foo%bar/123.json'),
    /X path does not include a canonical object id:/u,
  );
});

test('grouped X aliases encode dot-only path-control segments', () => {
  const byQuery = xPostByQueryAliasPath('..', '1880001');
  const byConversation = xPostByConversationAliasPath('..', '1880001');

  assert.equal(byQuery, '/x/posts/by-query/%2E%2E/1880001.json');
  assert.equal(byConversation, '/x/posts/by-conversation/%2E%2E/1880001.json');
  assert.equal(byQuery.includes('/../'), false);
  assert.equal(byConversation.includes('/../'), false);
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

// Regression: C-001 — X search paths must round-trip ids that contain the
// canonical "__" joiner (e.g. a caller-provided id "search__custom").
test('C-001: X search path round-trips ids containing the __ joiner', () => {
  const id = 'search__custom';
  assert.equal(extractXObjectIdFromPath(xSearchMetaPath(id, 'My Title')), id);
  assert.equal(extractXObjectIdFromPath(xSearchMetaPath(id)), id);
  assert.equal(
    extractXObjectIdFromPath(computeXPath('saved search', id, 'My Title')),
    id,
  );
  // sanity: a plain id without the joiner still round-trips
  assert.equal(extractXObjectIdFromPath(xSearchMetaPath('plainid', 'T')), 'plainid');
});
