import { NOTION_PATH_ROOT } from './types.js';

export type NotionPathObjectType =
  | 'block'
  | 'comment'
  | 'database'
  | 'database_page'
  | 'discovery_manifest'
  | 'page'
  | 'page_content';

export interface ComputePathInput {
  objectType: NotionPathObjectType;
  objectId: string;
  databaseId?: string;
  pageId?: string;
}

function assertSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Notion ${label} must be a non-empty string`);
  }
  return encodeURIComponent(trimmed);
}

export function notionDatabaseMetadataPath(databaseId: string): string {
  return `${NOTION_PATH_ROOT}/databases/${assertSegment(databaseId, 'database id')}/metadata.json`;
}

export function notionDatabasePagePath(databaseId: string, pageId: string): string {
  return `${NOTION_PATH_ROOT}/databases/${assertSegment(databaseId, 'database id')}/pages/${assertSegment(pageId, 'page id')}.json`;
}

export function notionDatabasePageContentPath(databaseId: string, pageId: string): string {
  return `${NOTION_PATH_ROOT}/databases/${assertSegment(databaseId, 'database id')}/pages/${assertSegment(pageId, 'page id')}/content.md`;
}

export function notionDatabasePageCommentsPath(databaseId: string, pageId: string): string {
  return `${NOTION_PATH_ROOT}/databases/${assertSegment(databaseId, 'database id')}/pages/${assertSegment(pageId, 'page id')}/comments.json`;
}

export function notionDatabaseBlockPath(databaseId: string, pageId: string, blockId: string): string {
  return `${NOTION_PATH_ROOT}/databases/${assertSegment(databaseId, 'database id')}/pages/${assertSegment(pageId, 'page id')}/blocks/${assertSegment(blockId, 'block id')}.json`;
}

export function notionStandalonePagePath(pageId: string): string {
  return `${NOTION_PATH_ROOT}/pages/${assertSegment(pageId, 'page id')}.json`;
}

export function notionStandalonePageContentPath(pageId: string): string {
  return `${NOTION_PATH_ROOT}/pages/${assertSegment(pageId, 'page id')}/content.md`;
}

export function notionStandalonePageCommentsPath(pageId: string): string {
  return `${NOTION_PATH_ROOT}/pages/${assertSegment(pageId, 'page id')}/comments.json`;
}

export function notionStandaloneBlockPath(pageId: string, blockId: string): string {
  return `${NOTION_PATH_ROOT}/pages/${assertSegment(pageId, 'page id')}/blocks/${assertSegment(blockId, 'block id')}.json`;
}

export function notionDatabasePagesCollectionPath(databaseId: string): string {
  return `${NOTION_PATH_ROOT}/databases/${assertSegment(databaseId, 'database id')}/pages`;
}

export function notionDiscoveryManifestPath(): string {
  return `${NOTION_PATH_ROOT}/discovery/manifest.json`;
}

export function computePath(input: ComputePathInput): string {
  switch (input.objectType) {
    case 'database':
      return notionDatabaseMetadataPath(input.objectId);
    case 'database_page':
      if (!input.databaseId) {
        throw new Error('database_page paths require databaseId');
      }
      return notionDatabasePagePath(input.databaseId, input.objectId);
    case 'discovery_manifest':
      return notionDiscoveryManifestPath();
    case 'page':
      return notionStandalonePagePath(input.objectId);
    case 'page_content':
      if (input.databaseId) {
        return notionDatabasePageContentPath(input.databaseId, input.objectId);
      }
      return notionStandalonePageContentPath(input.objectId);
    case 'comment':
      if (input.databaseId) {
        return notionDatabasePageCommentsPath(input.databaseId, input.objectId);
      }
      return notionStandalonePageCommentsPath(input.objectId);
    case 'block':
      if (!input.pageId) {
        throw new Error('block paths require pageId');
      }
      if (input.databaseId) {
        return notionDatabaseBlockPath(input.databaseId, input.pageId, input.objectId);
      }
      return notionStandaloneBlockPath(input.pageId, input.objectId);
  }
}
