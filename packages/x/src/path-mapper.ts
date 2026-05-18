import { aliasCollisionSuffix, slugifyAlias } from './alias-slug.js';

export const X_PATH_ROOT = '/x';

export const X_SEARCH_MODES = ['recent', 'archive'] as const;
export type XSearchMode = (typeof X_SEARCH_MODES)[number];

export const X_OBJECT_TYPES = ['search', 'post', 'user'] as const;
export type XPathObjectType = (typeof X_OBJECT_TYPES)[number];

export interface ParsedXRecordName {
  slug: string | null;
  id: string;
  ext: string | null;
}

const OBJECT_TYPE_ALIASES: Readonly<Record<string, XPathObjectType>> = {
  post: 'post',
  posts: 'post',
  tweet: 'post',
  tweets: 'post',
  xpost: 'post',
  search: 'search',
  searches: 'search',
  savedsearch: 'search',
  savedsearches: 'search',
  xsearch: 'search',
  user: 'user',
  users: 'user',
  author: 'user',
  authors: 'user',
  xuser: 'user',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`X ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeXPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment')).replace(/\./gu, '%2E');
}

export function xRootIndexPath(): string {
  return `${X_PATH_ROOT}/_index.json`;
}

export function xLayoutPath(): string {
  return `${X_PATH_ROOT}/LAYOUT.md`;
}

export function xSearchesIndexPath(): string {
  return `${X_PATH_ROOT}/searches/_index.json`;
}

export function xPostsIndexPath(): string {
  return `${X_PATH_ROOT}/posts/_index.json`;
}

export function xUsersIndexPath(): string {
  return `${X_PATH_ROOT}/users/_index.json`;
}

export function xRecordDirectorySegment(objectId: string | number, title?: string | null): string {
  const id = String(objectId).trim();
  const slug = title ? slugifyAlias(title) : '';
  const encodedId = encodeXDirectoryRecordId(id);
  return slug ? `${encodedId}__${encodeXPathSegment(slug)}` : encodedId;
}

export function xFlatRecordFilename(objectId: string | number, title?: string | null): string {
  const id = String(objectId).trim().replace(/\.json$/u, '');
  const slug = title ? slugifyAlias(title) : slugifyAlias(id);
  if (!slug || slug === 'untitled' || slug === id) {
    return `${encodeXPathSegment(id)}.json`;
  }
  return `${encodeXPathSegment(slug)}__${encodeXPathSegment(id)}.json`;
}

export function xSearchDirectoryPath(searchId: string, titleOrQuery?: string | null): string {
  return `${X_PATH_ROOT}/searches/${xRecordDirectorySegment(searchId, titleOrQuery)}`;
}

export function xSearchMetaPath(searchId: string, titleOrQuery?: string | null): string {
  return `${xSearchDirectoryPath(searchId, titleOrQuery)}/meta.json`;
}

export function xSearchResultsIndexPath(searchId: string, titleOrQuery?: string | null): string {
  return `${xSearchDirectoryPath(searchId, titleOrQuery)}/results/_index.json`;
}

export function xSearchResultPath(searchId: string, titleOrQuery: string | null | undefined, postId: string): string {
  return `${xSearchDirectoryPath(searchId, titleOrQuery)}/results/${encodeXPathSegment(postId)}.json`;
}

export function xPostPath(postId: string, textOrTitle?: string | null): string {
  return `${X_PATH_ROOT}/posts/${xFlatRecordFilename(postId, textOrTitle)}`;
}

export function xUserPath(userId: string, usernameOrName?: string | null): string {
  return `${X_PATH_ROOT}/users/${xFlatRecordFilename(userId, usernameOrName)}`;
}

export function xSearchByIdAliasPath(searchId: string): string {
  return `${X_PATH_ROOT}/searches/by-id/${encodeXPathSegment(searchId)}.json`;
}

export function xSearchByQueryAliasPath(query: string, searchId: string, colliding = false): string {
  const suffix = colliding ? `-${aliasCollisionSuffix(searchId)}` : '';
  return `${X_PATH_ROOT}/searches/by-query/${encodeXPathSegment(`${slugifyAlias(query)}${suffix}__${searchId}`)}.json`;
}

export function xPostByIdAliasPath(postId: string): string {
  return `${X_PATH_ROOT}/posts/by-id/${encodeXPathSegment(postId)}.json`;
}

export function xPostByAuthorAliasPath(authorIdOrUsername: string, postId: string): string {
  return `${X_PATH_ROOT}/posts/by-author/${encodeXPathSegment(slugifyAlias(authorIdOrUsername))}/${encodeXPathSegment(postId)}.json`;
}

export function xPostByConversationAliasPath(conversationId: string, postId: string): string {
  return `${X_PATH_ROOT}/posts/by-conversation/${encodeXPathSegment(conversationId)}/${encodeXPathSegment(postId)}.json`;
}

export function xPostByQueryAliasPath(searchId: string, postId: string): string {
  return `${X_PATH_ROOT}/posts/by-query/${encodeXPathSegment(searchId)}/${encodeXPathSegment(postId)}.json`;
}

export function xUserByIdAliasPath(userId: string): string {
  return `${X_PATH_ROOT}/users/by-id/${encodeXPathSegment(userId)}.json`;
}

export function xUserByUsernameAliasPath(username: string, userId: string, colliding = false): string {
  const suffix = colliding ? `-${aliasCollisionSuffix(userId)}` : '';
  return `${X_PATH_ROOT}/users/by-username/${encodeXPathSegment(`${slugifyAlias(username)}${suffix}__${userId}`)}.json`;
}

export function normalizeXObjectType(objectType: string): XPathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[-_\s]/gu, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized] ?? OBJECT_TYPE_ALIASES[objectType.trim().toLowerCase()];
  if (!mapped) {
    throw new Error(`Unsupported X object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeXObjectType(objectType: string): XPathObjectType | undefined {
  try {
    return normalizeXObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function computeXPath(objectType: string, objectId: string, label?: string | null): string {
  switch (normalizeXObjectType(objectType)) {
    case 'search':
      return xSearchMetaPath(objectId, label);
    case 'post':
      return xPostPath(objectId, label);
    case 'user':
      return xUserPath(objectId, label);
  }
}

export function parseXRecordName(filename: string): ParsedXRecordName {
  const extIndex = filename.lastIndexOf('.');
  const ext = extIndex > 0 && extIndex < filename.length - 1 ? filename.slice(extIndex + 1) : null;
  const basename = ext ? filename.slice(0, extIndex) : filename;
  const separatorIndex = basename.lastIndexOf('__');
  if (separatorIndex <= 0 || separatorIndex === basename.length - 2) {
    return { slug: null, id: safeDecodeURIComponent(basename), ext };
  }
  return {
    slug: safeDecodeURIComponent(basename.slice(0, separatorIndex)),
    id: safeDecodeURIComponent(basename.slice(separatorIndex + 2)),
    ext,
  };
}

export function extractXObjectIdFromPath(path: string): string {
  const normalized = path.replace(/^\/+/u, '/');
  const postMatch = /^\/x\/posts\/(?:by-id\/)?([^/]+?)(?:\.json)?$/u.exec(normalized);
  if (postMatch?.[1]) {
    return parseXRecordName(postMatch[1]).id;
  }
  const userMatch = /^\/x\/users\/(?:by-id\/)?([^/]+?)(?:\.json)?$/u.exec(normalized);
  if (userMatch?.[1]) {
    return parseXRecordName(userMatch[1]).id;
  }
  const searchMatch = /^\/x\/searches\/([^/]+)\/meta\.json$/u.exec(normalized);
  if (searchMatch?.[1]) {
    return parseXDirectoryRecordSegment(searchMatch[1]);
  }
  throw new Error(`X path does not include a canonical object id: ${path}`);
}

function encodeXDirectoryRecordId(id: string): string {
  const encoded = encodeXPathSegment(id);
  return id.includes('__') ? encoded.replace(/_/gu, '%5F') : encoded;
}

function parseXDirectoryRecordSegment(segment: string): string {
  const separatorIndex = segment.indexOf('__');
  const encodedId = separatorIndex > 0 ? segment.slice(0, separatorIndex) : segment;
  return safeDecodeURIComponent(encodedId);
}

function safeDecodeURIComponent(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
