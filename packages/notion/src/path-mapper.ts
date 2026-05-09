import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { NOTION_PATH_ROOT } from './types.js';
import { aliasCollisionSuffix, slugifyAlias } from './alias-slug.js';

/**
 * Canonical Notion filenames use `<slug>__<id>.<ext>` when a human-readable
 * title is available, and fall back to `<id>.<ext>` when it is not. Slugs are
 * ASCII-folded, lowercased, `-`-delimited, and capped at 80 chars. The inverse
 * parser treats non-conforming names as "no human-readable segment" and returns
 * the whole basename as the id stem.
 */
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

export interface NameWithIdOptions {
  existingNames?: Set<string>;
}

export interface ParseNameWithIdResult {
  humanReadable: string | null;
  id: string;
  ext: string | null;
}

interface NamingScope {
  readonly namesByCollection: Map<string, Map<string, string>>;
  readonly seenByCollection: Map<string, Set<string>>;
}

const MAX_HUMAN_READABLE_LENGTH = 80;
// AsyncLocalStorage isolates naming scopes per logical async chain so that
// concurrent `withNotionNamingScope` callers do not corrupt each other's
// dedupe maps. The previous module-level stack was unsafe across awaits.
const namingScopeStorage = new AsyncLocalStorage<NamingScope>();

function assertSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Notion ${label} must be a non-empty string`);
  }
  return encodeURIComponent(trimmed);
}

function slugify(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]+/g, '');
  const slug = ascii
    .replace(/^-+|-+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  if (slug.length <= MAX_HUMAN_READABLE_LENGTH) {
    return slug;
  }

  const truncated = slug.slice(0, MAX_HUMAN_READABLE_LENGTH);
  const cutIndex = truncated.lastIndexOf('-');
  const bounded = cutIndex > 0 ? truncated.slice(0, cutIndex) : truncated;
  return bounded.replace(/^-+|-+$/g, '');
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function currentNamingScope(): NamingScope | undefined {
  return namingScopeStorage.getStore();
}

function collectionNameWithId(collectionKey: string, humanReadable: string | undefined, id: string): string {
  const scope = currentNamingScope();
  if (!scope) {
    return nameWithId(humanReadable, id);
  }

  let namesById = scope.namesByCollection.get(collectionKey);
  if (!namesById) {
    namesById = new Map<string, string>();
    scope.namesByCollection.set(collectionKey, namesById);
  }

  const existing = namesById.get(id);
  if (existing) {
    return existing;
  }

  let seenNames = scope.seenByCollection.get(collectionKey);
  if (!seenNames) {
    seenNames = new Set<string>();
    scope.seenByCollection.set(collectionKey, seenNames);
  }

  const computed = nameWithId(humanReadable, id, { existingNames: seenNames });
  namesById.set(id, computed);
  return computed;
}

function databaseSegment(databaseId: string, databaseTitle?: string): string {
  return nameWithId(databaseTitle, databaseId);
}

function databasePageSegment(databaseId: string, pageId: string, pageTitle?: string): string {
  return collectionNameWithId(`database:${databaseId}:pages`, pageTitle, pageId);
}

function standalonePageSegment(pageId: string, pageTitle?: string): string {
  return collectionNameWithId('standalone:pages', pageTitle, pageId);
}

export function nameWithId(humanReadable: string | undefined, id: string, opts: NameWithIdOptions = {}): string {
  const normalizedId = assertSegment(id, 'id');
  const slug = humanReadable ? slugify(humanReadable) : '';
  if (!slug) {
    return normalizedId;
  }

  const existingNames = opts.existingNames;
  const baseName = existingNames?.has(slug) ? `${slug}-${shortHash(normalizedId)}` : slug;
  existingNames?.add(baseName);
  return `${baseName}__${normalizedId}`;
}

// For Notion `<humanReadable>__<id>` segments, `humanReadable` is the leading prefix and `id` is the trailing identifier.
export function parseNameWithId(filename: string): ParseNameWithIdResult {
  const extIndex = filename.lastIndexOf('.');
  const ext = extIndex > 0 && extIndex < filename.length - 1 ? filename.slice(extIndex + 1) : null;
  const basename = ext ? filename.slice(0, extIndex) : filename;
  const separatorIndex = basename.lastIndexOf('__');

  if (separatorIndex <= 0 || separatorIndex === basename.length - 2) {
    return {
      humanReadable: null,
      id: basename,
      ext,
    };
  }

  return {
    humanReadable: basename.slice(0, separatorIndex),
    id: basename.slice(separatorIndex + 2),
    ext,
  };
}

export async function withNotionNamingScope<T>(fn: () => Promise<T> | T): Promise<T> {
  const scope: NamingScope = {
    namesByCollection: new Map<string, Map<string, string>>(),
    seenByCollection: new Map<string, Set<string>>(),
  };
  return namingScopeStorage.run(scope, async () => fn());
}

export function notionDatabaseMetadataPath(databaseId: string, title?: string): string {
  return `${NOTION_PATH_ROOT}/databases/${databaseSegment(databaseId, title)}/metadata.json`;
}

export function notionDatabasesIndexPath(): string {
  return `${NOTION_PATH_ROOT}/databases/_index.json`;
}

export function notionDatabasePagePath(
  databaseId: string,
  pageId: string,
  pageTitle?: string,
  databaseTitle?: string,
): string {
  return `${NOTION_PATH_ROOT}/databases/${databaseSegment(databaseId, databaseTitle)}/pages/${databasePageSegment(databaseId, pageId, pageTitle)}.json`;
}

export function notionDatabasePageContentPath(
  databaseId: string,
  pageId: string,
  pageTitle?: string,
  databaseTitle?: string,
): string {
  return `${NOTION_PATH_ROOT}/databases/${databaseSegment(databaseId, databaseTitle)}/pages/${databasePageSegment(databaseId, pageId, pageTitle)}/content.md`;
}

export function notionDatabasePageCommentsPath(
  databaseId: string,
  pageId: string,
  pageTitle?: string,
  databaseTitle?: string,
): string {
  return `${NOTION_PATH_ROOT}/databases/${databaseSegment(databaseId, databaseTitle)}/pages/${databasePageSegment(databaseId, pageId, pageTitle)}/comments.json`;
}

export function notionDatabaseBlockPath(
  databaseId: string,
  pageId: string,
  blockId: string,
  pageTitle?: string,
  databaseTitle?: string,
): string {
  return `${NOTION_PATH_ROOT}/databases/${databaseSegment(databaseId, databaseTitle)}/pages/${databasePageSegment(databaseId, pageId, pageTitle)}/blocks/${assertSegment(blockId, 'block id')}.json`;
}

export function notionStandalonePagePath(pageId: string, pageTitle?: string): string {
  return `${NOTION_PATH_ROOT}/pages/${standalonePageSegment(pageId, pageTitle)}.json`;
}

export function notionPagesIndexPath(): string {
  return `${NOTION_PATH_ROOT}/pages/_index.json`;
}

export function notionStandalonePageContentPath(pageId: string, pageTitle?: string): string {
  return `${NOTION_PATH_ROOT}/pages/${standalonePageSegment(pageId, pageTitle)}/content.md`;
}

export function notionStandalonePageCommentsPath(pageId: string, pageTitle?: string): string {
  return `${NOTION_PATH_ROOT}/pages/${standalonePageSegment(pageId, pageTitle)}/comments.json`;
}

export function notionStandaloneBlockPath(pageId: string, blockId: string, pageTitle?: string): string {
  return `${NOTION_PATH_ROOT}/pages/${standalonePageSegment(pageId, pageTitle)}/blocks/${assertSegment(blockId, 'block id')}.json`;
}

export function notionDatabasePagesCollectionPath(databaseId: string, databaseTitle?: string): string {
  return `${NOTION_PATH_ROOT}/databases/${databaseSegment(databaseId, databaseTitle)}/pages`;
}

export function notionDatabasePagesIndexPath(databaseId: string, databaseTitle?: string): string {
  return `${notionDatabasePagesCollectionPath(databaseId, databaseTitle)}/_index.json`;
}

export function notionStandalonePagesCollectionPath(): string {
  return `${NOTION_PATH_ROOT}/pages`;
}

export function notionByTitleAliasPath(
  parentScope: string,
  title: string,
  id: string,
  colliding = false,
): string {
  const slug = slugifyAlias(title);
  if (!slug) {
    throw new Error('Notion alias title must slug to a non-empty string');
  }

  const filename = colliding ? `${slug}-${aliasCollisionSuffix(id)}` : slug;
  return `${parentScope}/by-title/${assertSegment(filename, 'alias title')}.json`;
}

export function notionByIdAliasPath(parentScope: string, id: string): string {
  return `${parentScope}/by-id/${assertSegment(idSuffix(id), 'alias id')}.json`;
}

export function notionDiscoveryManifestPath(): string {
  return `${NOTION_PATH_ROOT}/discovery/manifest.json`;
}

/**
 * Nango sync record `model` names → canonical Notion path object types. The
 * Nango `notion-relay` integration's `fetch-pages` sync emits records under
 * the `NotionPage` model (see
 * `cloud/nango-integrations/notion-relay/syncs/fetch-pages.ts`). Future
 * notion syncs (databases, blocks, comments) extend this map.
 */
const NANGO_MODEL_MAP: Readonly<Record<string, NotionPathObjectType>> = {
  NotionPage: 'page',
  NotionDatabase: 'database',
  NotionDatabasePage: 'database_page',
  NotionBlock: 'block',
  NotionComment: 'comment',
};

export function normalizeNangoNotionModel(model: string): NotionPathObjectType {
  const mapped = NANGO_MODEL_MAP[model];
  if (mapped) return mapped;
  throw new Error(`Unsupported Notion Nango model: ${model}`);
}

export function tryNormalizeNangoNotionModel(model: string): NotionPathObjectType | undefined {
  try {
    return normalizeNangoNotionModel(model);
  } catch {
    return undefined;
  }
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
