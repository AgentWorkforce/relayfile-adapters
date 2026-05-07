import { extractPipedriveIdFromPathSegment } from './path-mapper.js';

export type PipedriveQueryMethod = 'GET';

export interface PipedriveQueryRequest {
  method: PipedriveQueryMethod;
  endpoint: string;
  query?: Record<string, string>;
}

export const PIPEDRIVE_DEALS_GET_ROUTE = '/v1/deals';
export const PIPEDRIVE_PERSONS_GET_ROUTE = '/v1/persons';
export const PIPEDRIVE_ORGANIZATIONS_GET_ROUTE = '/v1/organizations';
export const PIPEDRIVE_ACTIVITY_GET_ROUTE = '/v1/activities';

const PAGE_DEFAULT_LIMIT = '100';

export function resolvePipedriveQueryRequest(path: string): PipedriveQueryRequest {
  const normalized = normalizePath(path);

  if (normalized === '/pipedrive/deals' || normalized === '/pipedrive/deals/') {
    return listRequest(PIPEDRIVE_DEALS_GET_ROUTE);
  }

  if (normalized === '/pipedrive/persons' || normalized === '/pipedrive/persons/') {
    return listRequest(PIPEDRIVE_PERSONS_GET_ROUTE);
  }

  if (normalized === '/pipedrive/organizations' || normalized === '/pipedrive/organizations/') {
    return listRequest(PIPEDRIVE_ORGANIZATIONS_GET_ROUTE);
  }

  if (normalized === '/pipedrive/activities' || normalized === '/pipedrive/activities/') {
    return listRequest(PIPEDRIVE_ACTIVITY_GET_ROUTE);
  }

  const dealMatch = normalized.match(/^\/pipedrive\/deals\/([^/]+)\.json$/u);
  if (dealMatch?.[1]) {
    return getRequest(`${PIPEDRIVE_DEALS_GET_ROUTE}/${extractPipedriveIdFromPathSegment(dealMatch[1])}`);
  }

  const personMatch = normalized.match(/^\/pipedrive\/persons\/([^/]+)\.json$/u);
  if (personMatch?.[1]) {
    return getRequest(`${PIPEDRIVE_PERSONS_GET_ROUTE}/${extractPipedriveIdFromPathSegment(personMatch[1])}`);
  }

  const organizationMatch = normalized.match(/^\/pipedrive\/organizations\/([^/]+)\.json$/u);
  if (organizationMatch?.[1]) {
    return getRequest(
      `${PIPEDRIVE_ORGANIZATIONS_GET_ROUTE}/${extractPipedriveIdFromPathSegment(organizationMatch[1])}`,
    );
  }

  const activityMatch = normalized.match(/^\/pipedrive\/activities\/([^/]+)\.json$/u);
  if (activityMatch?.[1]) {
    return getRequest(`${PIPEDRIVE_ACTIVITY_GET_ROUTE}/${extractPipedriveIdFromPathSegment(activityMatch[1])}`);
  }

  throw new Error(`No Pipedrive query rule matched ${path}`);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed;
}

function listRequest(endpoint: string): PipedriveQueryRequest {
  return {
    method: 'GET',
    endpoint,
    query: {
      limit: PAGE_DEFAULT_LIMIT,
      start: '0',
    },
  };
}

function getRequest(endpoint: string): PipedriveQueryRequest {
  return {
    method: 'GET',
    endpoint,
  };
}
