import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotionApiClient } from '../client.js';

describe('NotionApiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends Notion-Version on direct requests', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new NotionApiClient(undefined, { token: 'token-1', apiVersion: '2022-06-28' });

    await client.request('GET', '/v1/pages/page-1');

    expect(fetchMock).toHaveBeenCalledWith('https://api.notion.com/v1/pages/page-1', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer token-1',
        'Notion-Version': '2022-06-28',
      },
      body: undefined,
      signal: undefined,
    });
  });

  it('paginates with start_cursor on subsequent requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ id: 'page-1' }], has_more: true, next_cursor: 'cursor-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ id: 'page-2' }], has_more: false, next_cursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const client = new NotionApiClient(undefined, { token: 'token-1', defaultPageSize: 1 });

    const results = await client.paginate<{ id: string }>('POST', '/v1/search', {
      body: { filter: { property: 'object', value: 'page' } },
    });

    expect(results).toEqual([{ id: 'page-1' }, { id: 'page-2' }]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ 'Notion-Version': '2022-06-28' }),
      body: JSON.stringify({
        filter: { property: 'object', value: 'page' },
        page_size: 1,
        start_cursor: 'cursor-1',
      }),
    });
  });
});
