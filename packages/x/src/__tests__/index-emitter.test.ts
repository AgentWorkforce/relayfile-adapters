import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildXPostsIndexFile,
  buildXSearchResultsIndexFile,
} from '../index-emitter.js';

test('X index tie-breaks use stable code point ordering', () => {
  const file = buildXPostsIndexFile([
    { id: 'a_1', title: 'lower', updated: '2026-05-12T00:00:00Z' },
    { id: 'A_1', title: 'upper', updated: '2026-05-12T00:00:00Z' },
  ]);

  const rows = JSON.parse(file.content) as Array<{ id: string }>;
  assert.deepEqual(rows.map((row) => row.id), ['A_1', 'a_1']);
});

test('X search result tie-breaks use stable code point ordering', () => {
  const file = buildXSearchResultsIndexFile('search_1', 'query', [
    {
      id: 'a_1',
      searchId: 'search_1',
      postId: 'a_1',
      rank: 1,
      matchedAt: '2026-05-12T00:00:00Z',
      query: 'query',
    },
    {
      id: 'A_1',
      searchId: 'search_1',
      postId: 'A_1',
      rank: 1,
      matchedAt: '2026-05-12T00:00:00Z',
      query: 'query',
    },
  ]);

  const rows = JSON.parse(file.content) as Array<{ postId: string }>;
  assert.deepEqual(rows.map((row) => row.postId), ['A_1', 'a_1']);
});
