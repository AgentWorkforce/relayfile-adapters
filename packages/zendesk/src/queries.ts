export const ZENDESK_TICKETS_ENDPOINT = '/api/v2/tickets';
export const ZENDESK_USERS_ENDPOINT = '/api/v2/users';
export const ZENDESK_ORGANIZATIONS_ENDPOINT = '/api/v2/organizations';

export type ZendeskQueryObjectType = 'organization' | 'ticket' | 'user';

export interface ZendeskReadRequest {
  action:
    | 'get_organization'
    | 'get_ticket'
    | 'get_user'
    | 'list_organizations'
    | 'list_tickets'
    | 'list_users';
  method: 'GET';
  endpoint: string;
  query?: Record<string, string> | undefined;
}

export interface ZendeskListOptions {
  page?: number;
  perPage?: number;
  query?: string;
  updatedAfter?: string;
}

export function buildZendeskListTicketsRequest(options: ZendeskListOptions = {}): ZendeskReadRequest {
  const request: ZendeskReadRequest = {
    action: 'list_tickets',
    method: 'GET',
    endpoint: `${ZENDESK_TICKETS_ENDPOINT}.json`,
  };
  request.query = compactQuery({
    page: numberString(options.page),
    per_page: numberString(options.perPage),
    query: options.query,
    updated_since: options.updatedAfter,
  });
  return request;
}

export function buildZendeskListUsersRequest(options: ZendeskListOptions = {}): ZendeskReadRequest {
  const request: ZendeskReadRequest = {
    action: 'list_users',
    method: 'GET',
    endpoint: `${ZENDESK_USERS_ENDPOINT}.json`,
  };
  request.query = compactQuery({
    page: numberString(options.page),
    per_page: numberString(options.perPage),
    query: options.query,
    updated_since: options.updatedAfter,
  });
  return request;
}

export function buildZendeskListOrganizationsRequest(options: ZendeskListOptions = {}): ZendeskReadRequest {
  const request: ZendeskReadRequest = {
    action: 'list_organizations',
    method: 'GET',
    endpoint: `${ZENDESK_ORGANIZATIONS_ENDPOINT}.json`,
  };
  request.query = compactQuery({
    page: numberString(options.page),
    per_page: numberString(options.perPage),
    query: options.query,
    updated_since: options.updatedAfter,
  });
  return request;
}

export function resolveZendeskReadRequest(path: string): ZendeskReadRequest {
  if (path === '/zendesk/tickets' || path === '/zendesk/tickets/') {
    return buildZendeskListTicketsRequest();
  }

  if (path === '/zendesk/users' || path === '/zendesk/users/') {
    return buildZendeskListUsersRequest();
  }

  if (path === '/zendesk/organizations' || path === '/zendesk/organizations/') {
    return buildZendeskListOrganizationsRequest();
  }

  const ticketMatch = path.match(/^\/zendesk\/tickets\/([^/]+)\.json$/);
  if (ticketMatch?.[1]) {
    return {
      action: 'get_ticket',
      method: 'GET',
      endpoint: `${ZENDESK_TICKETS_ENDPOINT}/${extractZendeskId(ticketMatch[1])}.json`,
    };
  }

  const userMatch = path.match(/^\/zendesk\/users\/([^/]+)\.json$/);
  if (userMatch?.[1]) {
    return {
      action: 'get_user',
      method: 'GET',
      endpoint: `${ZENDESK_USERS_ENDPOINT}/${decodeURIComponent(userMatch[1])}.json`,
    };
  }

  const organizationMatch = path.match(/^\/zendesk\/organizations\/([^/]+)\.json$/);
  if (organizationMatch?.[1]) {
    return {
      action: 'get_organization',
      method: 'GET',
      endpoint: `${ZENDESK_ORGANIZATIONS_ENDPOINT}/${decodeURIComponent(organizationMatch[1])}.json`,
    };
  }

  throw new Error(`No Zendesk read rule matched ${path}`);
}

function extractZendeskId(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const slugged = /--(.+)$/u.exec(decoded);
  return slugged?.[1] ?? decoded;
}

function compactQuery(query: Record<string, string | undefined>): Record<string, string> | undefined {
  const entries = Object.entries(query).filter((entry): entry is [string, string] => {
    const value = entry[1];
    return typeof value === 'string' && value.trim().length > 0;
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function numberString(value: number | undefined): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}
