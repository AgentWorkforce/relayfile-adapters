import { extractConfluenceIdFromPathSegment } from './path-mapper.js';
import { CONFLUENCE_API_PAGES_ROUTE, CONFLUENCE_DEFAULT_PAGE_SIZE, type ConfluenceReadRequest } from './types.js';

export const CONFLUENCE_API_SPACES_ROUTE = '/wiki/api/v2/spaces';

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
