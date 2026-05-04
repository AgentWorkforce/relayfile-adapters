import { notionDatabaseBlockPath, notionStandaloneBlockPath } from '../path-mapper.js';
import { renderBlocksToMarkdown } from './renderer.js';
import type { NotionApiClient } from '../client.js';
import type { FileSemantics } from '@relayfile/sdk';
import type { NotionBlock, NotionNormalizedBlock, NotionVfsFile } from '../types.js';

export async function fetchBlockChildrenRecursively(client: NotionApiClient, blockId: string): Promise<NotionBlock[]> {
  const blocks = await client.paginate<NotionBlock>('GET', `/v1/blocks/${encodeURIComponent(blockId)}/children`);
  return Promise.all(
    blocks.map(async (block) => {
      if (block.has_children) {
        block.children = await fetchBlockChildrenRecursively(client, block.id);
      }
      return block;
    }),
  );
}

export function flattenBlocks(blocks: NotionBlock[]): NotionBlock[] {
  return blocks.flatMap((block) => [block, ...flattenBlocks(block.children ?? [])]);
}

export function normalizeBlock(block: NotionBlock): NotionNormalizedBlock {
  const childIds = (block.children ?? []).map((child) => child.id);
  const raw = isObject(block[block.type]) ? (block[block.type] as Record<string, unknown>) : {};
  return {
    object: 'block',
    id: block.id,
    type: block.type,
    hasChildren: block.has_children,
    parent: block.parent,
    lastEditedTime: block.last_edited_time,
    text: renderBlocksToMarkdown([{ ...block, children: undefined }]),
    data: raw as NotionNormalizedBlock['data'],
    childIds,
  };
}

export function buildBlockFiles(
  blocks: NotionBlock[],
  context: { databaseId?: string; databaseTitle?: string; pageId: string; pageTitle?: string },
): NotionVfsFile[] {
  return flattenBlocks(blocks).map((block) => {
    const path = context.databaseId
      ? notionDatabaseBlockPath(context.databaseId, context.pageId, block.id, context.pageTitle, context.databaseTitle)
      : notionStandaloneBlockPath(context.pageId, block.id, context.pageTitle);
    return {
      path,
      contentType: 'application/json; charset=utf-8',
      content: `${JSON.stringify(normalizeBlock(block), null, 2)}\n`,
      semantics: buildBlockSemantics(block, context),
    };
  });
}

function buildBlockSemantics(block: NotionBlock, context: { databaseId?: string; pageId: string }): FileSemantics {
  const properties: Record<string, string> = {
    provider: 'notion',
    'provider.object_id': block.id,
    'provider.object_type': 'block',
    'notion.page_id': context.pageId,
  };
  if (context.databaseId) {
    properties['notion.database_id'] = context.databaseId;
  }
  if (block.last_edited_time) {
    properties['notion.last_edited_time'] = block.last_edited_time;
  }
  return {
    properties,
    relations: [context.pageId],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
