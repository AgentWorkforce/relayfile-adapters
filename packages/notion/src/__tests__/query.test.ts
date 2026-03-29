import { describe, expect, it } from 'vitest';
import { buildDatabaseQuery } from '../databases/query.js';

describe('database query builder', () => {
  it('builds compound filters and sorts', () => {
    const query = buildDatabaseQuery({
      filter: {
        and: [
          { property: 'Status', type: 'status', operator: 'equals', value: 'Done' },
          {
            or: [
              { property: 'Priority', type: 'number', operator: 'greater_than', value: 2 },
              { timestamp: 'last_edited_time', operator: 'after', value: '2026-03-01T00:00:00.000Z' },
            ],
          },
        ],
      },
      sorts: [
        { property: 'Priority', direction: 'descending' },
        { timestamp: 'last_edited_time', direction: 'ascending' },
      ],
      pageSize: 50,
    });

    expect(query).toEqual({
      filter: {
        and: [
          { property: 'Status', status: { equals: 'Done' } },
          {
            or: [
              { property: 'Priority', number: { greater_than: 2 } },
              { timestamp: 'last_edited_time', last_edited_time: { after: '2026-03-01T00:00:00.000Z' } },
            ],
          },
        ],
      },
      sorts: [
        { property: 'Priority', direction: 'descending' },
        { timestamp: 'last_edited_time', direction: 'ascending' },
      ],
      page_size: 50,
    });
  });
});
