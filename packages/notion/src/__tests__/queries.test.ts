import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDatabaseFilter,
  getBlockChildren,
  getPage,
  queryDatabase,
  searchDatabases,
  searchPages,
} from '../queries.js';
import type {
  NotionBlock,
  NotionDatabase,
  NotionListResponse,
  NotionPage,
} from '../queries.js';

describe('Notion query helpers', () => {
  it('builds a page search operation without undefined payload keys', () => {
    const operation = searchPages({ query: 'investors', page_size: 10 });

    assert.deepStrictEqual(operation, {
      method: 'POST',
      endpoint: '/v1/search',
      data: {
        query: 'investors',
        page_size: 10,
        filter: {
          property: 'object',
          value: 'page',
        },
      },
    });
    assertNoUndefinedDeep(operation);
  });

  it('builds a database search operation with pagination', () => {
    const operation = searchDatabases({ page_size: 5, start_cursor: 'cursor' });

    assert.deepStrictEqual(operation, {
      method: 'POST',
      endpoint: '/v1/search',
      data: {
        page_size: 5,
        start_cursor: 'cursor',
        filter: {
          property: 'object',
          value: 'database',
        },
      },
    });
  });

  it('builds a database query operation with encoded ids and preserves filters, sorts, and pagination', () => {
    const filter = {
      property: 'Status',
      select: { equals: 'Active' },
    };
    const sorts = [
      { property: 'Priority', direction: 'descending' },
      { timestamp: 'last_edited_time', direction: 'ascending' },
    ];
    const operation = queryDatabase('db id', {
      filter,
      sorts,
      page_size: 25,
      start_cursor: 'cursor-2',
    });

    assert.deepStrictEqual(operation, {
      method: 'POST',
      endpoint: '/v1/databases/db%20id/query',
      data: {
        filter,
        sorts,
        page_size: 25,
        start_cursor: 'cursor-2',
      },
    });
  });

  it('builds a page fetch operation without a payload', () => {
    const operation = getPage('page id');

    assert.deepStrictEqual(operation, {
      method: 'GET',
      endpoint: '/v1/pages/page%20id',
    });
    assert.ok(!('data' in operation));
  });

  it('builds a block children operation with pagination in the query string', () => {
    const operation = getBlockChildren('block id', {
      page_size: 50,
      start_cursor: 'abc',
    });

    assert.deepStrictEqual(operation, {
      method: 'GET',
      endpoint: '/v1/blocks/block%20id/children?page_size=50&start_cursor=abc',
    });
    assert.ok(!('data' in operation));
  });

  it('uses the expected default operators for common database filter types', () => {
    assert.deepStrictEqual(buildDatabaseFilter({
      property: 'Name',
      type: 'title',
      value: 'investors',
    }), {
      property: 'Name',
      title: { contains: 'investors' },
    });

    assert.deepStrictEqual(buildDatabaseFilter({
      property: 'Summary',
      type: 'rich_text',
      value: 'memo',
    }), {
      property: 'Summary',
      rich_text: { contains: 'memo' },
    });

    assert.deepStrictEqual(buildDatabaseFilter({
      property: 'Published',
      type: 'checkbox',
      value: true,
    }), {
      property: 'Published',
      checkbox: { equals: true },
    });

    assert.deepStrictEqual(buildDatabaseFilter({
      property: 'Stage',
      type: 'select',
      value: 'Seed',
    }), {
      property: 'Stage',
      select: { equals: 'Seed' },
    });

    assert.deepStrictEqual(buildDatabaseFilter({
      property: 'Tags',
      type: 'multi_select',
      value: 'finance',
    }), {
      property: 'Tags',
      multi_select: { contains: 'finance' },
    });

    assert.deepStrictEqual(buildDatabaseFilter({
      property: 'Launch date',
      type: 'date',
      value: '2026-04-01',
    }), {
      property: 'Launch date',
      date: { on_or_after: '2026-04-01' },
    });

    assert.deepStrictEqual(buildDatabaseFilter({
      property: 'Employees',
      type: 'number',
      value: 10,
    }), {
      property: 'Employees',
      number: { equals: 10 },
    });
  });

  it('lets an explicit operator override the default when supported', () => {
    const filter = buildDatabaseFilter({
      property: 'Name',
      type: 'title',
      value: 'inv',
      operator: 'starts_with',
    });

    assert.deepStrictEqual(filter, {
      property: 'Name',
      title: { starts_with: 'inv' },
    });
  });

  it('keeps exported response types assignable', () => {
    const pageList: NotionListResponse<NotionPage> = {
      object: 'list',
      results: [{ object: 'page', id: 'page-1', properties: {} }],
      has_more: false,
      next_cursor: null,
    };
    const database: NotionDatabase = {
      object: 'database',
      id: 'db-1',
      title: [],
      description: [],
      properties: {},
    };
    const block: NotionBlock = {
      object: 'block',
      id: 'block-1',
      type: 'paragraph',
      has_children: false,
    };

    expectType<NotionPage | undefined>(pageList.results?.[0]);
    expectType<NotionDatabase>(database);
    expectType<NotionBlock>(block);
    assert.strictEqual(pageList.results?.[0]?.id, 'page-1');
    assert.strictEqual(database.id, 'db-1');
    assert.strictEqual(block.id, 'block-1');
  });
});

function assertNoUndefinedDeep(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoUndefinedDeep(item);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    assert.notStrictEqual(entry, undefined, `Expected ${key} to be defined`);
    assertNoUndefinedDeep(entry);
  }
}

function expectType<T>(_value: T): void {}
