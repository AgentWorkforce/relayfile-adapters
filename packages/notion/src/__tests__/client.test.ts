import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NotionApiClient } from '../client.js';

describe('NotionApiClient', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('sends Notion-Version on direct requests', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const client = new NotionApiClient(undefined, { token: 'token-1', apiVersion: '2022-06-28' });

    await client.request('GET', '/v1/pages/page-1');

    assert.strictEqual(fetchMock.mock.calls.length, 1);
    assert.deepStrictEqual(fetchMock.mock.calls[0].arguments, ['https://api.notion.com/v1/pages/page-1', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer token-1',
        'Notion-Version': '2022-06-28',
      },
      body: undefined,
      signal: undefined,
    }]);
  });

  it('paginates with start_cursor on subsequent requests', async () => {
    let callCount = 0;
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ results: [{ id: 'page-1' }], has_more: true, next_cursor: 'cursor-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ results: [{ id: 'page-2' }], has_more: false, next_cursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = new NotionApiClient(undefined, { token: 'token-1', defaultPageSize: 1 });

    const results = await client.paginate<{ id: string }>('POST', '/v1/search', {
      body: { filter: { property: 'object', value: 'page' } },
    });

    assert.deepStrictEqual(results, [{ id: 'page-1' }, { id: 'page-2' }]);
    const secondCallArgs = fetchMock.mock.calls[1]?.arguments;
    assert.ok(secondCallArgs);
    const secondCallOptions = secondCallArgs[1] as Record<string, unknown>;
    const headers = secondCallOptions.headers as Record<string, string>;
    assert.strictEqual(headers['Notion-Version'], '2022-06-28');
    assert.strictEqual(secondCallOptions.body, JSON.stringify({
      filter: { property: 'object', value: 'page' },
      page_size: 1,
      start_cursor: 'cursor-1',
    }));
  });
});
