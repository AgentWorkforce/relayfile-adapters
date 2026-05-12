import {
  notionDatabasePageContentPath,
  notionDatabasePagePath,
  notionDatabasePagesCollectionPath,
  notionStandalonePageContentPath,
  notionStandalonePagePath,
  notionStandalonePagesCollectionPath,
} from '../path-mapper.js';
import { fetchBlockChildrenRecursively, buildBlockFiles } from '../content/blocks.js';
import { resolvePageMarkdown } from '../content/markdown.js';
import { buildCommentsFile, listComments } from '../comments/ingestion.js';
import { serializePropertyMap, richTextToPlainText } from './properties.js';
import type { FileSemantics } from '@relayfile/sdk';
import type { NotionApiClient } from '../client.js';
import type { NotionPage, NotionNormalizedPage, NotionVfsFile } from '../types.js';

export async function retrievePage(client: NotionApiClient, pageId: string): Promise<NotionPage> {
  return client.request<NotionPage>('GET', `/v1/pages/${encodeURIComponent(pageId)}`);
}

export function normalizePage(page: NotionPage): NotionNormalizedPage {
  const title = findPageTitle(page);
  return {
    object: 'page',
    id: page.id,
    title,
    parent: page.parent,
    databaseId: page.parent.type === 'database_id' ? page.parent.database_id : undefined,
    url: page.url,
    lastEditedTime: page.last_edited_time,
    createdTime: page.created_time,
    archived: page.archived,
    inTrash: page.in_trash,
    properties: serializePropertyMap(page.properties),
  };
}

export async function ingestPageArtifacts(
  client: NotionApiClient,
  page: NotionPage,
  context: { databaseId?: string; databaseTitle?: string } = {},
): Promise<NotionVfsFile[]> {
  const explicitTitle = readPageTitle(page);
  const normalized = normalizePage(page);
  const pageId = page.id;
  const path = context.databaseId
    ? notionDatabasePagePath(context.databaseId, pageId, normalized.title, context.databaseTitle)
    : notionStandalonePagePath(pageId, normalized.title);
  const contentPath = context.databaseId
    ? notionDatabasePageContentPath(context.databaseId, pageId, normalized.title, context.databaseTitle)
    : notionStandalonePageContentPath(pageId, normalized.title);

  const blocks = client.config.fetchBlockJson ? await fetchBlockChildrenRecursively(client, pageId) : [];
  const markdown = await resolvePageMarkdown(client, pageId, blocks);
  const files: NotionVfsFile[] = [
    {
      path,
      contentType: 'application/json; charset=utf-8',
      content: `${JSON.stringify(normalized, null, 2)}\n`,
      aliasMetadata: {
        scopePath: context.databaseId
          ? notionDatabasePagesCollectionPath(context.databaseId, context.databaseTitle)
          : notionStandalonePagesCollectionPath(),
        title: explicitTitle,
        id: pageId,
        aliasKind: 'page',
        databaseId: context.databaseId,
        databaseTitle: context.databaseTitle,
        ...resolveParentMetadata(page),
      },
      semantics: buildPageSemantics(page, context.databaseId),
    },
    {
      path: contentPath,
      contentType: 'text/markdown; charset=utf-8',
      content: markdown.markdown.endsWith('\n') ? markdown.markdown : `${markdown.markdown}\n`,
      semantics: buildContentSemantics(page, context.databaseId),
    },
  ];

  if (blocks.length > 0) {
    files.push(...buildBlockFiles(blocks, {
      databaseId: context.databaseId,
      databaseTitle: context.databaseTitle,
      pageId,
      pageTitle: normalized.title,
    }));
  }

  if (client.config.fetchComments) {
    const comments = await listComments(client, pageId);
    files.push(buildCommentsFile(comments, {
      databaseId: context.databaseId,
      databaseTitle: context.databaseTitle,
      pageId,
      pageTitle: normalized.title,
    }));
  }

  return files;
}

export function findPageTitle(page: NotionPage): string {
  return readPageTitle(page) ?? page.id;
}

function readPageTitle(page: NotionPage): string | undefined {
  for (const property of Object.values(page.properties)) {
    if (property.type === 'title') {
      const title = richTextToPlainText(property.title).trim();
      return title || undefined;
    }
  }
  return undefined;
}

/**
 * Translate a page's Notion `parent` discriminated union into the
 * `(parentType, parentId, parentTitle?)` triple consumed by the alias
 * writer. The page's `parent.type` directly maps to our alias `parentType`:
 *
 *   - `database_id` → `database` (alias landing: by-parent or by-database)
 *   - `page_id`     → `page`     (alias landing: by-parent)
 *   - `block_id`    → `page`     (blocks live on pages; treat as page parent)
 *   - `workspace`   → `workspace` (alias writer skips the by-parent emit)
 *
 * The parent's *title* isn't reachable from the page payload alone — the
 * Notion API would require a separate /v1/pages/<parent> fetch. For the
 * by-parent alias we accept that and fall back to the UUID slug, which
 * is sufficient because the by-parent path's primary navigational value
 * is grouping children under a single parent directory, not naming the
 * parent directory itself. Future work (issue #107) can hydrate parent
 * titles from a workspace-wide title cache built during bulk ingest.
 */
function resolveParentMetadata(page: NotionPage): {
  parentType: 'database' | 'page' | 'workspace';
  parentId?: string;
  parentTitle?: string;
} {
  const parent = page.parent;
  switch (parent.type) {
    case 'database_id':
      return { parentType: 'database', parentId: parent.database_id };
    case 'page_id':
      return { parentType: 'page', parentId: parent.page_id };
    case 'block_id':
      return { parentType: 'page', parentId: parent.block_id };
    default:
      return { parentType: 'workspace' };
  }
}

function buildPageSemantics(page: NotionPage, databaseId?: string): FileSemantics {
  const properties: Record<string, string> = {
    provider: 'notion',
    'provider.object_id': page.id,
    'provider.object_type': 'page',
    'notion.page_id': page.id,
  };
  const relations = new Set<string>();

  if (databaseId) {
    properties['notion.database_id'] = databaseId;
    relations.add(databaseId);
  }
  if (page.last_edited_time) {
    properties['notion.last_edited_time'] = page.last_edited_time;
  }

  for (const property of Object.values(page.properties)) {
    if (property.type === 'relation') {
      for (const relation of property.relation) {
        relations.add(relation.id);
      }
    }
  }

  return {
    properties,
    relations: [...relations],
  };
}

function buildContentSemantics(page: NotionPage, databaseId?: string): FileSemantics {
  const properties: Record<string, string> = {
    provider: 'notion',
    'provider.object_id': page.id,
    'provider.object_type': 'page_content',
    'notion.page_id': page.id,
  };
  if (databaseId) {
    properties['notion.database_id'] = databaseId;
  }
  return {
    properties,
    relations: [page.id],
  };
}
