import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { NOTION_PATH_ROOT } from './types.js';
import { aliasShortId, slugifyAlias } from './alias-slug.js';

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

const NOTION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `idSuffix` dehyphenates a canonical Notion UUID (8-4-4-4-12) into a
// 32-char hex string for use in `by-id` aliases. Non-UUID ids fall through
// unchanged so synthetic test ids and unusual fixtures still alias.
// `writeback.extractNotionId` reverses this when resolving alias paths.
function idSuffix(id: string): string {
  if (NOTION_UUID_PATTERN.test(id)) {
    return id.replace(/-/g, '').toLowerCase();
  }
  return id;
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
  return notionDatabasePageMetaPath(databaseId, pageId, pageTitle, databaseTitle);
}

export function notionDatabasePageMetaPath(
  databaseId: string,
  pageId: string,
  pageTitle?: string,
  databaseTitle?: string,
): string {
  return `${NOTION_PATH_ROOT}/databases/${databaseSegment(databaseId, databaseTitle)}/pages/${databasePageSegment(databaseId, pageId, pageTitle)}/meta.json`;
}

/** @deprecated Use `notionDatabasePageMetaPath`; page records own child files. */
export function notionDatabasePageLegacyJsonPath(
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
  return notionStandalonePageMetaPath(pageId, pageTitle);
}

export function notionStandalonePageMetaPath(pageId: string, pageTitle?: string): string {
  return `${NOTION_PATH_ROOT}/pages/${standalonePageSegment(pageId, pageTitle)}/meta.json`;
}

/** @deprecated Use `notionStandalonePageMetaPath`; page records own child files. */
export function notionStandalonePageLegacyJsonPath(pageId: string, pageTitle?: string): string {
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

/**
 * Compose an alias filename from a human-readable label and a Notion id.
 * The format is always `<slug>__<short_id>` — deterministic and
 * collision-safe regardless of duplicate titles. `short_id` is derived by
 * `aliasShortId`, which takes the last 8 hex characters of the canonical
 * UUID. Agents holding the UUID can recompute this filename without
 * round-tripping through an index.
 *
 * Use this for `by-title`, `by-name`, and any other title-keyed alias.
 */
export function notionAliasFilename(label: string, id: string): string {
  const slug = slugifyAlias(label);
  if (!slug) {
    throw new Error('Notion alias label must slug to a non-empty string');
  }
  return `${slug}__${aliasShortId(id)}`;
}

/**
 * `/notion/<scope>/by-title/<slug>__<short_id>.json` alias path.
 *
 * The `<short_id>` suffix is always included. Notion permits duplicate
 * page and database titles, so a bare `<slug>` filename would clobber
 * across pages with matching slugs. Including the deterministic short id
 * makes collisions impossible and lets agents construct the alias path
 * from a UUID alone.
 *
 * The legacy fourth `colliding` parameter is retained for backward
 * compatibility — it is now a no-op because the short id is always
 * emitted.
 */
export function notionByTitleAliasPath(
  parentScope: string,
  title: string,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _colliding = false,
): string {
  const filename = notionAliasFilename(title, id);
  return `${parentScope}/by-title/${assertSegment(filename, 'alias title')}.json`;
}

/**
 * `/notion/users/by-name/<slug>__<short_id>.json` alias. Notion user
 * display names can collide (bots and people share the same name space),
 * so the short-id suffix is critical here.
 */
export function notionByNameAliasPath(parentScope: string, name: string, id: string): string {
  const filename = notionAliasFilename(name, id);
  return `${parentScope}/by-name/${assertSegment(filename, 'alias name')}.json`;
}

export function notionByIdAliasPath(parentScope: string, id: string): string {
  return `${parentScope}/by-id/${assertSegment(idSuffix(id), 'alias id')}.json`;
}

export function notionByEditedAliasPath(parentScope: string, editedDate: string, id: string): string {
  return `${parentScope}/by-edited/${assertSegment(editedDate, 'alias edited date')}/${assertSegment(idSuffix(id), 'alias id')}.json`;
}

/**
 * `/notion/pages/by-database/<database-slug>__<db_short_id>/<page-slug>__<page_short_id>.json`.
 *
 * Critical for the "find the row in my Tasks database titled 'X'" use
 * case. The database scope segment is built with the same
 * `<slug>__<short_id>` convention as the by-title alias so an agent can
 * navigate `/notion/databases/by-title/tasks__abcd1234.json` to get the
 * database UUID, then list `/notion/pages/by-database/tasks__abcd1234/`
 * to see every page in that database addressable by title.
 */
export function notionPageByDatabaseAliasPath(
  databaseId: string,
  pageId: string,
  databaseTitle: string,
  pageTitle: string,
): string {
  const databaseSegmentValue = notionAliasFilename(databaseTitle, databaseId);
  const pageSegmentValue = notionAliasFilename(pageTitle, pageId);
  return `${NOTION_PATH_ROOT}/pages/by-database/${assertSegment(databaseSegmentValue, 'alias database segment')}/${assertSegment(pageSegmentValue, 'alias page segment')}.json`;
}

/**
 * `/notion/pages/by-parent/<parent-slug>__<short_id>/<page-slug>__<short_id>.json`.
 *
 * Mirrors Notion's hierarchical workspace model: a page's `parent` is
 * either another page, a database, or the workspace itself. This alias
 * lets agents list the direct children of a given parent page without
 * scanning the whole pages tree. The parent type is encoded into the
 * segment as `<page|database|workspace>:` so an agent can tell whether
 * `parent` is a page or database from the path alone.
 */
export function notionPageByParentAliasPath(
  parentType: 'page' | 'database' | 'workspace',
  parentId: string,
  pageId: string,
  parentTitle: string | undefined,
  pageTitle: string,
): string {
  const parentLabel = parentTitle && slugifyAlias(parentTitle) ? parentTitle : parentId;
  const parentSegmentValue = `${parentType}-${notionAliasFilename(parentLabel, parentId)}`;
  const pageSegmentValue = notionAliasFilename(pageTitle, pageId);
  return `${NOTION_PATH_ROOT}/pages/by-parent/${assertSegment(parentSegmentValue, 'alias parent segment')}/${assertSegment(pageSegmentValue, 'alias page segment')}.json`;
}

/**
 * Canonical and collection paths for the `/notion/users/` subtree. Users
 * are workspace-level records (no parent/child hierarchy) so we model
 * them as a flat collection mirroring the standalone-page shape.
 */
export function notionUsersCollectionPath(): string {
  return `${NOTION_PATH_ROOT}/users`;
}

export function notionUsersIndexPath(): string {
  return `${NOTION_PATH_ROOT}/users/_index.json`;
}

export function notionRootIndexPath(): string {
  return `${NOTION_PATH_ROOT}/_index.json`;
}

export function notionUserPath(userId: string, name?: string): string {
  return `${notionUsersCollectionPath()}/${nameWithId(name, userId)}.json`;
}

/**
 * Collection path for the databases tree — used as the `parentScope` for
 * `notionByTitleAliasPath` / `notionByIdAliasPath` when aliasing databases.
 */
export function notionDatabasesCollectionPath(): string {
  return `${NOTION_PATH_ROOT}/databases`;
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
