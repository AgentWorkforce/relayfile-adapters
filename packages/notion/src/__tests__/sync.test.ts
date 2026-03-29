import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncFilterPayload, computeWatermark, detectDatabaseChanges, detectStandalonePageChanges } from '../sync.js';

describe('sync change detection', () => {
  it('builds a last_edited_time filter payload', () => {
    assert.deepStrictEqual(buildSyncFilterPayload('2026-03-01T00:00:00.000Z'), {
      filter: {
        timestamp: 'last_edited_time',
        last_edited_time: { after: '2026-03-01T00:00:00.000Z' },
      },
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
    });
  });

  it('advances the watermark to the newest page edit time', () => {
    assert.strictEqual(
      computeWatermark(
        [
          { last_edited_time: '2026-03-02T00:00:00.000Z' },
          { last_edited_time: '2026-03-05T12:00:00.000Z' },
        ],
        '2026-03-01T00:00:00.000Z',
      ),
      '2026-03-05T12:00:00.000Z',
    );
  });

  it('queries database changes with a last_edited_time filter', async () => {
    const paginate = mock.fn(async () => [{ object: 'page', id: 'page-1', last_edited_time: '2026-03-02T00:00:00.000Z' }]);

    const result = await detectDatabaseChanges({ paginate } as never, 'db-1', '2026-03-01T00:00:00.000Z');

    assert.deepStrictEqual(paginate.mock.calls[0].arguments, ['POST', '/v1/databases/db-1/query', {
      body: {
        filter: {
          timestamp: 'last_edited_time',
          last_edited_time: { after: '2026-03-01T00:00:00.000Z' },
        },
        sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
      },
    }]);
    assert.strictEqual(result.nextCursor, '2026-03-02T00:00:00.000Z');
  });

  it('paginates standalone search results before filtering by watermark', async () => {
    const paginate = mock.fn(async () => [
      { object: 'page', id: 'page-1', last_edited_time: '2026-03-01T00:00:00.000Z' },
      { object: 'database', id: 'db-1' },
      { object: 'page', id: 'page-2', last_edited_time: '2026-03-06T00:00:00.000Z' },
    ]);

    const result = await detectStandalonePageChanges({ paginate, config: { defaultPageSize: 100 } } as never, '2026-03-03T00:00:00.000Z');

    assert.deepStrictEqual(paginate.mock.calls[0].arguments, ['POST', '/v1/search', {
      body: {
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'ascending', timestamp: 'last_edited_time' },
      },
      pageSize: 100,
      startCursor: undefined,
    }]);
    assert.deepStrictEqual(result.pages.map((page: any) => page.id), ['page-2']);
    assert.strictEqual(result.nextCursor, '2026-03-06T00:00:00.000Z');
  });
});
