import { notionDatabasePageContentPath, notionDatabasePagePath, notionStandalonePageContentPath, notionStandalonePagePath } from '../path-mapper.js';
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
  context: { databaseId?: string } = {},
): Promise<NotionVfsFile[]> {
  const normalized = normalizePage(page);
  const pageId = page.id;
  const path = context.databaseId ? notionDatabasePagePath(context.databaseId, pageId) : notionStandalonePagePath(pageId);
  const contentPath = context.databaseId
    ? notionDatabasePageContentPath(context.databaseId, pageId)
    : notionStandalonePageContentPath(pageId);

  const blocks = client.config.fetchBlockJson ? await fetchBlockChildrenRecursively(client, pageId) : [];
  const markdown = await resolvePageMarkdown(client, pageId, blocks);
  const files: NotionVfsFile[] = [
    {
      path,
      contentType: 'application/json; charset=utf-8',
      content: `${JSON.stringify(normalized, null, 2)}\n`,
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
    files.push(...buildBlockFiles(blocks, { databaseId: context.databaseId, pageId }));
  }

  if (client.config.fetchComments) {
    const comments = await listComments(client, pageId);
    files.push(buildCommentsFile(comments, { databaseId: context.databaseId, pageId }));
  }

  return files;
}

export function findPageTitle(page: NotionPage): string {
  for (const property of Object.values(page.properties)) {
    if (property.type === 'title') {
      return richTextToPlainText(property.title);
    }
  }
  return page.id;
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
