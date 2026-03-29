import type { NotionApiClient } from './client.js';
import type { NotionDatabase, NotionListResponse, NotionPage, NotionSearchInput } from './types.js';

export type NotionSearchResult = NotionDatabase | NotionPage;

export async function searchNotion(
  client: NotionApiClient,
  input: NotionSearchInput = {},
): Promise<NotionListResponse<NotionSearchResult>> {
  const body: Record<string, unknown> = {
    filter: input.filter,
    sort: input.sort,
    page_size: input.pageSize ?? client.config.defaultPageSize,
    start_cursor: input.startCursor,
  };
  if (input.query !== undefined) body.query = input.query;
  return client.request<NotionListResponse<NotionSearchResult>>('POST', '/v1/search', { body });
}

export async function searchAllNotion(
  client: NotionApiClient,
  input: NotionSearchInput = {},
): Promise<NotionSearchResult[]> {
  const body: Record<string, unknown> = {
    filter: input.filter,
    sort: input.sort,
  };
  if (input.query !== undefined) body.query = input.query;
  return client.paginate<NotionSearchResult>('POST', '/v1/search', {
    pageSize: input.pageSize,
    startCursor: input.startCursor,
    body,
  });
}
