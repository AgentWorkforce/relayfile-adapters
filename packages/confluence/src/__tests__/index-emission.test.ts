import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildConfluenceIndexFile } from '../index-emitter.js';
import {
  confluencePagePath,
  confluenceSpacePath,
} from '../path-mapper.js';
import { confluencePageIndexRow, confluenceSpaceIndexRow } from '../queries.js';

describe('confluence index emission', () => {
  it('emits deterministic page and space indexes sorted by updated DESC, then id ASC', () => {
    const pageRows = [
      confluencePageIndexRow({
        id: '98765',
        title: 'Release Plan',
        spaceId: '12345',
        status: 'current',
        createdAt: '2026-04-01T08:00:00.000Z',
      }),
      confluencePageIndexRow({
        id: '99999',
        title: 'Draft notes',
        spaceId: '12345',
        status: 'draft',
        createdAt: '2026-04-03T10:00:00.000Z',
      }),
    ];
    const spaceRows = [
      confluenceSpaceIndexRow({
        id: '12345',
        key: 'ENG',
        name: 'Engineering',
        createdAt: '2026-04-01T08:00:00.000Z',
      }),
      confluenceSpaceIndexRow({
        id: '67890',
        key: 'OPS',
        name: 'Operations',
        createdAt: '2026-04-03T10:00:00.000Z',
      }),
    ];

    const pageIndex = buildConfluenceIndexFile('pages', pageRows);
    const pageIndexAgain = buildConfluenceIndexFile('pages', [...pageRows].reverse());
    const spaceIndex = buildConfluenceIndexFile('spaces', spaceRows);

    assert.deepEqual(pageIndex, pageIndexAgain);
    assert.equal(pageIndex.path, '/confluence/pages/_index.json');
    assert.equal(spaceIndex.path, '/confluence/spaces/_index.json');
    assert.equal(pageIndex.contentType, 'application/json; charset=utf-8');

    assert.deepEqual(JSON.parse(pageIndex.content), [
      { id: '99999', title: 'Draft notes', updated: '2026-04-03T10:00:00.000Z', spaceId: '12345', status: 'draft' },
      { id: '98765', title: 'Release Plan', updated: '2026-04-01T08:00:00.000Z', spaceId: '12345', status: 'current' },
    ]);

    assert.deepEqual(JSON.parse(spaceIndex.content), [
      { id: '67890', title: 'Operations', updated: '2026-04-03T10:00:00.000Z', key: 'OPS' },
      { id: '12345', title: 'Engineering', updated: '2026-04-01T08:00:00.000Z', key: 'ENG' },
    ]);

    assert.equal(confluencePagePath('98765'), '/confluence/pages/98765.json');
    assert.equal(confluenceSpacePath('12345'), '/confluence/spaces/12345.json');
  });

  it('emits an empty index when a Confluence bucket has no records', () => {
    const file = buildConfluenceIndexFile('pages', []);
    assert.equal(file.path, '/confluence/pages/_index.json');
    assert.deepEqual(JSON.parse(file.content), []);
  });

  it('re-exports the index and layout helpers from the barrel', async () => {
    const barrel = await import('../index.js');

    assert.equal(barrel.buildConfluenceIndexFile, buildConfluenceIndexFile);
    assert.equal(typeof barrel.confluenceLayoutPromptFile, 'function');
  });
});
