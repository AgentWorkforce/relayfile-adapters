import { aliasCollisionSuffix, slugifyAlias } from './alias-slug.js';
import { CONFLUENCE_PATH_ROOT } from './types.js';

export { CONFLUENCE_PATH_ROOT };

export const CONFLUENCE_OBJECT_TYPES = ['page', 'space'] as const;
export type ConfluencePathObjectType = (typeof CONFLUENCE_OBJECT_TYPES)[number];

/**
 * Confluence-canonical page statuses, used for the by-state alias scope. The
 * Confluence REST v2 schema (see `discovery/confluence/pages/.schema.json`)
 * pins this to `current | draft`, but real payloads also surface `archived`
 * and `trashed`. We accept any non-empty string and emit it lowercased; the
 * canonical-status list below is informational for downstream readers.
 */
export const CONFLUENCE_CANONICAL_PAGE_STATUSES = ['current', 'draft', 'archived', 'trashed'] as const;

const MAX_HUMAN_READABLE_LENGTH = 80;

const OBJECT_TYPE_ALIASES: Readonly<Record<string, ConfluencePathObjectType>> = {
  confluencepage: 'page',
  confluencespace: 'space',
  page: 'page',
  pages: 'page',
  space: 'space',
  spaces: 'space',
};

/**
 * Nango sync record `model` names → canonical Confluence object types. The
 * `confluence-relay` Nango integration emits records under these PascalCase
 * model names; resolving them here lets the cloud's record writer turn a
 * Nango payload into a relayfile path without hardcoding the mapping at the
 * dispatch site.
 */
const NANGO_MODEL_MAP: Readonly<Record<string, ConfluencePathObjectType>> = {
  ConfluencePage: 'page',
  ConfluenceSpace: 'space',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Confluence ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeConfluencePathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

function slugify(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]+/g, '');
  const slug = ascii
    .replace(/[{}]/g, '')
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

export interface NameWithIdOptions {
  existingNames?: Set<string>;
}

export interface ParseNameWithIdResult {
  humanReadable: string | null;
  id: string;
  ext: string | null;
}

export function nameWithId(humanReadable: string | undefined, id: string, opts: NameWithIdOptions = {}): string {
  const normalizedId = encodeConfluencePathSegment(id);
  const slug = humanReadable ? slugify(humanReadable) : '';
  if (!slug) {
    return normalizedId;
  }

  const existingNames = opts.existingNames;
  const baseName = existingNames?.has(slug)
    ? `${slug}-${aliasCollisionSuffix(normalizedId)}`
    : slug;
  existingNames?.add(baseName);
  return `${baseName}__${normalizedId}`;
}

// For Confluence `<humanReadable>__<id>` segments, `humanReadable` is the
// leading prefix and `id` is the trailing identifier.
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

export function normalizeConfluenceObjectType(objectType: string): ConfluencePathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Confluence object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeConfluenceObjectType(objectType: string): ConfluencePathObjectType | undefined {
  try {
    return normalizeConfluenceObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoConfluenceModel(model: string): ConfluencePathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeConfluenceObjectType(model);
}

export function slugifyStatusName(status: string): string {
  const trimmed = assertNonEmptySegment(status, 'status name');
  let slug = '';
  let previousWasSeparator = false;
  for (const character of trimmed.normalize('NFC').toLowerCase()) {
    if (/\s/u.test(character)) {
      if (!previousWasSeparator && slug.length > 0) {
        slug += '-';
      }
      previousWasSeparator = true;
      continue;
    }

    previousWasSeparator = false;
    if (/[a-z0-9]/u.test(character)) {
      slug += character;
      continue;
    }

    if (character === '-') {
      slug += '%2D';
      continue;
    }

    slug += encodeURIComponent(character);
  }
  return assertNonEmptySegment(slug, 'status slug');
}

export function confluenceSpacePath(spaceIdOrKey: string, name?: string, opts?: NameWithIdOptions): string {
  return `${CONFLUENCE_PATH_ROOT}/spaces/${nameWithId(name, spaceIdOrKey, opts)}.json`;
}

export function confluencePagePath(
  pageId: string,
  title?: string,
  spaceId?: string,
  opts?: NameWithIdOptions,
): string {
  const pageSegment = nameWithId(title, pageId, opts);
  if (spaceId) {
    return `${CONFLUENCE_PATH_ROOT}/spaces/${encodeConfluencePathSegment(spaceId)}/pages/${pageSegment}.json`;
  }
  return `${CONFLUENCE_PATH_ROOT}/pages/${pageSegment}.json`;
}

export function confluencePagesIndexPath(): string {
  return `${CONFLUENCE_PATH_ROOT}/pages/_index.json`;
}

export function confluenceSpacesIndexPath(): string {
  return `${CONFLUENCE_PATH_ROOT}/spaces/_index.json`;
}

export function confluenceProviderRootIndexPath(): string {
  return `${CONFLUENCE_PATH_ROOT}/_index.json`;
}

export function confluencePageByStatePath(status: string, pageId: string): string {
  return `${CONFLUENCE_PATH_ROOT}/pages/by-state/${slugifyStatusName(status)}/${encodeConfluencePathSegment(pageId)}.json`;
}

export function confluenceByTitleAliasPath(scope: string, title: string, id: string, colliding = false): string {
  const slug = slugifyAlias(title);
  if (!slug) {
    throw new Error('Confluence alias title must slug to a non-empty string');
  }
  const filename = colliding ? `${slug}-${aliasCollisionSuffix(id)}` : slug;
  return `${scope}/by-title/${encodeConfluencePathSegment(filename)}.json`;
}

export function confluenceByIdAliasPath(scope: string, identifier: string): string {
  return `${scope}/by-id/${encodeConfluencePathSegment(identifier)}.json`;
}

export function confluencePageByIdAliasPath(id: string): string {
  return confluenceByIdAliasPath(`${CONFLUENCE_PATH_ROOT}/pages`, id);
}

export function confluencePageByTitleAliasPath(title: string, id: string, colliding = false): string {
  return confluenceByTitleAliasPath(`${CONFLUENCE_PATH_ROOT}/pages`, title, id, colliding);
}

export function confluenceSpaceByIdAliasPath(id: string): string {
  return confluenceByIdAliasPath(`${CONFLUENCE_PATH_ROOT}/spaces`, id);
}

export function confluenceSpaceByTitleAliasPath(title: string, id: string, colliding = false): string {
  return confluenceByTitleAliasPath(`${CONFLUENCE_PATH_ROOT}/spaces`, title, id, colliding);
}

export function computeConfluencePath(
  objectType: string,
  objectId: string,
  options: { title?: string; spaceId?: string } = {},
): string {
  const normalizedType = normalizeConfluenceObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'page':
      return confluencePagePath(normalizedId, options.title, options.spaceId);
    case 'space':
      return confluenceSpacePath(normalizedId, options.title);
  }
}

/**
 * Decode a Confluence path segment back to its raw identifier. Supports both
 * the v2 `<slug>__<id>` convention (post-PR) and the legacy `<slug>--<id>`
 * convention so existing mounts written before the cutover keep resolving.
 */
export function extractConfluenceIdFromPathSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const v2Match = /__([^/]+)$/u.exec(decoded);
  if (v2Match?.[1]) {
    return v2Match[1];
  }
  const legacyMatch = /--([^/]+)$/u.exec(decoded);
  return legacyMatch?.[1] ? legacyMatch[1] : decoded;
}
