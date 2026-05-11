import { extractConfluenceIdFromPathSegment } from './path-mapper.js';
import { CONFLUENCE_API_PAGES_ROUTE, CONFLUENCE_DEFAULT_PAGE_SIZE, type ConfluencePage, type ConfluenceSpace, type ConfluenceReadRequest } from './types.js';

export const CONFLUENCE_API_SPACES_ROUTE = '/wiki/api/v2/spaces';

export interface ConfluenceBaseIndexRow {
  id: string;
  title: string;
  updated: string;
}

export interface ConfluencePageIndexRow extends ConfluenceBaseIndexRow {
  spaceId: string;
  status: string;
}

export interface ConfluenceSpaceIndexRow extends ConfluenceBaseIndexRow {
  key: string;
}

function normalizeString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIndexTitle(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
}

function normalizeUpdated(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string') return value;
  }
  return '';
}

export function getConfluencePageHumanReadable(page: { title?: string | null }): string | undefined {
  return normalizeString(page.title ?? undefined);
}

export function getConfluenceSpaceHumanReadable(space: { name?: string | null; key?: string | null }): string | undefined {
  return normalizeString(space.name ?? undefined) ?? normalizeString(space.key ?? undefined);
}

export function confluencePageIndexRow(page: ConfluencePage): ConfluencePageIndexRow {
  return {
    id: page.id,
    title: normalizeIndexTitle(page.title),
    updated: normalizeUpdated(page.version?.createdAt, page.createdAt),
    spaceId: normalizeIndexTitle(page.spaceId),
    status: normalizeIndexTitle(page.status),
  };
}

export function confluenceSpaceIndexRow(space: ConfluenceSpace): ConfluenceSpaceIndexRow {
  return {
    id: space.id,
    title: normalizeIndexTitle(space.name) || normalizeIndexTitle(space.key),
    updated: normalizeUpdated(space.createdAt),
    key: normalizeIndexTitle(space.key),
  };
}

export function resolveConfluenceReadRequest(path: string): ConfluenceReadRequest {
  const normalized = normalizePath(path);

  if (normalized === '/confluence/pages' || normalized === '/confluence/pages/') {
    return {
      action: 'list_pages',
      method: 'GET',
      endpoint: CONFLUENCE_API_PAGES_ROUTE,
      query: {
        limit: String(CONFLUENCE_DEFAULT_PAGE_SIZE),
        'body-format': 'storage',
      },
    };
  }

  if (normalized === '/confluence/spaces' || normalized === '/confluence/spaces/') {
    return {
      action: 'list_spaces',
      method: 'GET',
      endpoint: CONFLUENCE_API_SPACES_ROUTE,
      query: { limit: String(CONFLUENCE_DEFAULT_PAGE_SIZE) },
    };
  }

  const spacePagesMatch = normalized.match(/^\/confluence\/spaces\/([^/]+)\/pages\/?$/u);
  if (spacePagesMatch?.[1]) {
    return {
      action: 'list_space_pages',
      method: 'GET',
      endpoint: CONFLUENCE_API_PAGES_ROUTE,
      query: {
        limit: String(CONFLUENCE_DEFAULT_PAGE_SIZE),
        'body-format': 'storage',
        'space-id': extractConfluenceIdFromPathSegment(spacePagesMatch[1]),
      },
    };
  }

  const nestedPageMatch = normalized.match(/^\/confluence\/spaces\/[^/]+\/pages\/([^/]+)\.json$/u);
  if (nestedPageMatch?.[1]) {
    return getPageRequest(extractConfluenceIdFromPathSegment(nestedPageMatch[1]));
  }

  const flatPageMatch = normalized.match(/^\/confluence\/pages\/([^/]+)\.json$/u);
  if (flatPageMatch?.[1]) {
    return getPageRequest(extractConfluenceIdFromPathSegment(flatPageMatch[1]));
  }

  const spaceMatch = normalized.match(/^\/confluence\/spaces\/([^/]+)\.json$/u);
  if (spaceMatch?.[1]) {
    return {
      action: 'get_space',
      method: 'GET',
      endpoint: `${CONFLUENCE_API_SPACES_ROUTE}/${extractConfluenceIdFromPathSegment(spaceMatch[1])}`,
    };
  }

  throw new Error(`No Confluence read rule matched ${path}`);
}

function getPageRequest(pageId: string): ConfluenceReadRequest {
  return {
    action: 'get_page',
    method: 'GET',
    endpoint: `${CONFLUENCE_API_PAGES_ROUTE}/${pageId}`,
    query: {
      'body-format': 'storage',
      'get-draft': 'true',
    },
  };
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
