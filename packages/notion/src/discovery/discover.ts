import { processConcurrently } from '../concurrency.js';
import { NotionApiError, type NotionApiClient } from '../client.js';
import { ingestDatabaseArtifacts } from '../databases/ingestion.js';
import { findPageTitle, ingestPageArtifacts, retrievePage } from '../pages/ingestion.js';
import { richTextToPlainText } from '../pages/properties.js';
import { searchAllNotion } from '../search.js';
import type { NotionBlock, NotionDatabase, NotionPage, NotionVfsFile } from '../types.js';
import type { ContentMetadataItem, DiscoverOptions, DiscoverResult } from './types.js';

type SearchResult = NotionDatabase | NotionPage;
type OrphanPage = Omit<NotionPage, 'parent'> & {
  parent: { type: 'page_id'; page_id: string | null };
};
type DiscoverablePage = NotionPage | OrphanPage;
type BlockTraversalTarget = {
  id: string;
  parentId: string;
};

export async function discoverContentMetadata(
  client: NotionApiClient,
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const concurrency = resolveConcurrency(options.concurrency);

  throwIfAborted(options.signal);
  const results = await searchAllNotion(client);
  throwIfAborted(options.signal);

  const databases = results.filter(isDiscoverableDatabase);
  const childPages = results.filter(isChildPage);
  const nonChildPages = results.filter(isDiscoverableRootPage);

  const validChildPages = await processConcurrently(
    childPages,
    async (page): Promise<DiscoverablePage | null> => validateChildPageParent(client, page, options.signal),
    concurrency,
  );

  const items = [
    ...nonChildPages.map(mapPageToMetadataItem),
    ...validChildPages.filter((page): page is DiscoverablePage => page !== null).map(mapPageToMetadataItem),
    ...databases.map(mapDatabaseToMetadataItem),
  ];

  const visited = new Set(items.map((item) => item.id));
  const discoveredPages = await discoverSubPages(
    client,
    items.filter(isPageItem),
    concurrency,
    visited,
    options.signal,
  );
  const manifestItems = [...items, ...discoveredPages];
  const ingestedFiles = await discoverIngestedFiles(client, manifestItems, concurrency, options);

  return {
    manifest: {
      generatedAt: new Date().toISOString(),
      itemCount: manifestItems.length,
      items: manifestItems,
    },
    ingestedFiles,
  };
}

async function discoverSubPages(
  client: NotionApiClient,
  pages: ContentMetadataItem[],
  concurrency: number,
  visited: Set<string>,
  signal?: AbortSignal,
): Promise<ContentMetadataItem[]> {
  const discovered: ContentMetadataItem[] = [];
  let frontier = pages.map<BlockTraversalTarget>((page) => ({
    id: page.id,
    parentId: page.id,
  }));

  while (frontier.length > 0) {
    throwIfAborted(signal);
    const levelResults = await processConcurrently(
      frontier,
      async (target) => {
        try {
          const blocks = await client.paginate<NotionBlock>('GET', `/v1/blocks/${encodeURIComponent(target.id)}/children`, {
            signal,
          });
          const subPages: ContentMetadataItem[] = [];
          const nextTargets: BlockTraversalTarget[] = [];

          for (const block of blocks) {
            if (block.type === 'child_page' && !visited.has(block.id)) {
              visited.add(block.id);
              subPages.push({
                id: block.id,
                type: 'page',
                title: readChildPageTitle(block),
                lastModified: block.last_edited_time,
                parentId: target.parentId,
              });
            }

            if (block.has_children) {
              nextTargets.push({
                id: block.id,
                parentId: target.parentId,
              });
            }
          }

          return { nextTargets, subPages };
        } catch (error) {
          if (signal?.aborted) {
            throw signal.reason;
          }
          if (error instanceof NotionApiError && error.status === 404) {
            return { nextTargets: [], subPages: [] };
          }
          return { nextTargets: [], subPages: [] };
        }
      },
      concurrency,
    );

    discovered.push(...levelResults.flatMap((result) => result.subPages));
    frontier = levelResults.flatMap((result) => result.nextTargets);
  }

  return discovered;
}

async function discoverIngestedFiles(
  client: NotionApiClient,
  items: ContentMetadataItem[],
  concurrency: number,
  options: DiscoverOptions,
): Promise<NotionVfsFile[]> {
  const shouldIngestDatabases = options.depth === 'full' || options.ingestDatabases === true;
  const shouldIngestPages = options.depth === 'full' || options.ingestPages === true;

  if (!shouldIngestDatabases && !shouldIngestPages) {
    return [];
  }

  const ingestedFiles: NotionVfsFile[] = [];

  if (shouldIngestDatabases) {
    throwIfAborted(options.signal);
    const databaseFiles = await processConcurrently(
      items.filter(isDatabaseItem),
      async (item) => ingestDatabaseArtifacts(client, item.id),
      concurrency,
    );
    ingestedFiles.push(...databaseFiles.flat());
  }

  if (shouldIngestPages) {
    throwIfAborted(options.signal);
    const pageFiles = await processConcurrently(
      items.filter(isPageItem),
      async (item) => {
        const page = await retrievePage(client, item.id);
        return ingestPageArtifacts(client, page);
      },
      concurrency,
    );
    ingestedFiles.push(...pageFiles.flat());
  }

  return ingestedFiles;
}

async function validateChildPageParent(
  client: NotionApiClient,
  page: NotionPage,
  signal?: AbortSignal,
): Promise<DiscoverablePage | null> {
  if (page.parent.type !== 'page_id') {
    return page;
  }

  try {
    await client.request('GET', `/v1/pages/${encodeURIComponent(page.parent.page_id)}`, { signal });
    return null;
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason;
    }
    if (error instanceof NotionApiError && error.status === 404) {
      return {
        ...page,
        parent: { type: 'page_id', page_id: null },
      };
    }
    return null;
  }
}

function mapPageToMetadataItem(page: DiscoverablePage): ContentMetadataItem {
  return {
    id: page.id,
    type: 'page',
    title: findPageTitle(page as NotionPage),
    path: page.url,
    lastModified: page.last_edited_time,
    parentId: readParentId(page.parent),
  };
}

function mapDatabaseToMetadataItem(database: NotionDatabase): ContentMetadataItem {
  return {
    id: database.id,
    type: 'database',
    title: richTextToPlainText(database.title),
    path: database.url,
    lastModified: database.last_edited_time,
    parentId: readParentId(database.parent),
  };
}

function isDiscoverableDatabase(result: SearchResult): result is NotionDatabase {
  return result.object === 'database' && result.parent?.type !== 'database_id';
}

function isChildPage(result: SearchResult): result is NotionPage {
  return result.object === 'page' && result.parent.type === 'page_id';
}

function isDiscoverableRootPage(result: SearchResult): result is NotionPage {
  return result.object === 'page' && result.parent.type !== 'page_id' && result.parent.type !== 'database_id';
}

function isDatabaseItem(item: ContentMetadataItem): boolean {
  return item.type === 'database';
}

function isPageItem(item: ContentMetadataItem): boolean {
  return item.type === 'page';
}

function readParentId(parent: NotionPage['parent'] | NotionDatabase['parent'] | OrphanPage['parent'] | undefined): string | undefined {
  if (!parent) {
    return undefined;
  }
  if ('page_id' in parent) {
    return parent.page_id ?? undefined;
  }
  if ('database_id' in parent) {
    return parent.database_id;
  }
  if ('block_id' in parent) {
    return parent.block_id;
  }
  return undefined;
}

function readChildPageTitle(block: NotionBlock): string | undefined {
  const childPage = block.child_page;
  return isRecord(childPage) && typeof childPage.title === 'string' ? childPage.title : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 8;
  }
  return Math.max(1, Math.trunc(value));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}
