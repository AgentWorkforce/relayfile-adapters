import { CONFLUENCE_PATH_ROOT } from './types.js';

export const CONFLUENCE_OBJECT_TYPES = ['page', 'space'] as const;
export type ConfluencePathObjectType = (typeof CONFLUENCE_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, ConfluencePathObjectType>> = {
  confluencepage: 'page',
  confluencespace: 'space',
  page: 'page',
  pages: 'page',
  space: 'space',
  spaces: 'space',
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
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function titleSegmentWithId(title: string | undefined, id: string): string {
  const slug = title ? slugify(title) : '';
  return slug ? `${slug}--${encodeConfluencePathSegment(id)}` : encodeConfluencePathSegment(id);
}

export function normalizeConfluenceObjectType(objectType: string): ConfluencePathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Confluence object type: ${objectType}`);
  }
  return mapped;
}

export function confluenceSpacePath(spaceIdOrKey: string, name?: string): string {
  return `${CONFLUENCE_PATH_ROOT}/spaces/${titleSegmentWithId(name, spaceIdOrKey)}.json`;
}

export function confluencePagePath(pageId: string, title?: string, spaceId?: string): string {
  const pageSegment = titleSegmentWithId(title, pageId);
  if (spaceId) {
    return `${CONFLUENCE_PATH_ROOT}/spaces/${encodeConfluencePathSegment(spaceId)}/pages/${pageSegment}.json`;
  }
  return `${CONFLUENCE_PATH_ROOT}/pages/${pageSegment}.json`;
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

export function extractConfluenceIdFromPathSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const suffix = /--([^/]+)$/u.exec(decoded);
  return suffix?.[1] ? suffix[1] : decoded;
}
