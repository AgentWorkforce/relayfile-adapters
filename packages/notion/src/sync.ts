import { buildDatabaseQuery, buildLastEditedSinceFilter } from './databases/query.js';
import { searchAllNotion } from './search.js';
import type { NotionApiClient } from './client.js';
import type { NotionPage, NotionSyncChangeSet } from './types.js';

export async function detectDatabaseChanges(
  client: NotionApiClient,
  databaseId: string,
  since: string,
): Promise<NotionSyncChangeSet> {
  const pages = await client.paginate<NotionPage>('POST', `/v1/databases/${encodeURIComponent(databaseId)}/query`, {
    body: buildDatabaseQuery({
      filter: {
        timestamp: 'last_edited_time',
        operator: 'after',
        value: since,
      },
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
    }),
  });
  return {
    pages,
    nextCursor: computeWatermark(pages, since),
  };
}

export async function detectStandalonePageChanges(client: NotionApiClient, since: string): Promise<NotionSyncChangeSet> {
  const results = await searchAllNotion(client, {
    filter: { value: 'page', property: 'object' },
    sort: { direction: 'ascending', timestamp: 'last_edited_time' },
    pageSize: client.config.defaultPageSize,
  });
  const pages = results.filter(isPage).filter((page) => (page.last_edited_time ?? '') > since);
  return {
    pages,
    nextCursor: computeWatermark(pages, since),
  };
}

export function computeWatermark(pages: Array<Pick<NotionPage, 'last_edited_time'>>, fallback: string): string {
  return pages.reduce((max, page) => {
    const candidate = page.last_edited_time ?? fallback;
    return candidate > max ? candidate : max;
  }, fallback);
}

export function buildSyncFilterPayload(since: string): Record<string, unknown> {
  return {
    filter: buildLastEditedSinceFilter(since),
    sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
  };
}

function isPage(value: unknown): value is NotionPage {
  return Boolean(value) && typeof value === 'object' && (value as NotionPage).object === 'page';
}
