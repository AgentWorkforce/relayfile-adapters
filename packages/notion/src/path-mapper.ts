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

function slugify(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}

function titleSegment(title: string | undefined, id: string, label: string): string {
  const slug = title ? slugify(title) : '';
  return slug ? slug : assertSegment(id, label);
}

function titleSegmentWithId(title: string | undefined, id: string, label: string): string {
  const slug = title ? slugify(title) : '';
  return slug ? `${slug}--${shortId(id)}` : assertSegment(id, label);
}

export function notionDatabaseMetadataPath(databaseId: string, title?: string): string {
  return `${NOTION_PATH_ROOT}/databases/${titleSegment(title, databaseId, 'database id')}/metadata.json`;
}

export function notionDatabasePagePath(
  databaseId: string,
  pageId: string,
  pageTitle?: string,
  databaseTitle?: string,
): string {
  return `${NOTION_PATH_ROOT}/databases/${titleSegment(databaseTitle, databaseId, 'database id')}/pages/${titleSegmentWithId(pageTitle, pageId, 'page id')}.json`;
}

export function notionDatabasePageContentPath(
  databaseId: string,
  pageId: string,
  pageTitle?: string,
  databaseTitle?: string,
): string {
  return `${NOTION_PATH_ROOT}/databases/${titleSegment(databaseTitle, databaseId, 'database id')}/pages/${titleSegmentWithId(pageTitle, pageId, 'page id')}/content.md`;
}

export function notionDatabasePageCommentsPath(
  databaseId: string,
  pageId: string,
  pageTitle?: string,
  databaseTitle?: string,
): string {
  return `${NOTION_PATH_ROOT}/databases/${titleSegment(databaseTitle, databaseId, 'database id')}/pages/${titleSegmentWithId(pageTitle, pageId, 'page id')}/comments.json`;
}

export function notionDatabaseBlockPath(
  databaseId: string,
  pageId: string,
  blockId: string,
  pageTitle?: string,
  databaseTitle?: string,
): string {
  return `${NOTION_PATH_ROOT}/databases/${titleSegment(databaseTitle, databaseId, 'database id')}/pages/${titleSegmentWithId(pageTitle, pageId, 'page id')}/blocks/${assertSegment(blockId, 'block id')}.json`;
}

export function notionStandalonePagePath(pageId: string, pageTitle?: string): string {
  return `${NOTION_PATH_ROOT}/pages/${titleSegmentWithId(pageTitle, pageId, 'page id')}.json`;
}

export function notionStandalonePageContentPath(pageId: string, pageTitle?: string): string {
  return `${NOTION_PATH_ROOT}/pages/${titleSegmentWithId(pageTitle, pageId, 'page id')}/content.md`;
}

export function notionStandalonePageCommentsPath(pageId: string, pageTitle?: string): string {
  return `${NOTION_PATH_ROOT}/pages/${titleSegmentWithId(pageTitle, pageId, 'page id')}/comments.json`;
}

export function notionStandaloneBlockPath(pageId: string, blockId: string, pageTitle?: string): string {
  return `${NOTION_PATH_ROOT}/pages/${titleSegmentWithId(pageTitle, pageId, 'page id')}/blocks/${assertSegment(blockId, 'block id')}.json`;
}

export function notionDatabasePagesCollectionPath(databaseId: string, databaseTitle?: string): string {
  return `${NOTION_PATH_ROOT}/databases/${titleSegment(databaseTitle, databaseId, 'database id')}/pages`;
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
