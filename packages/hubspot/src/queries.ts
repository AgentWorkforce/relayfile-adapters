import type { HubSpotObjectType, HubSpotReadRequest } from './types.js';

export const HUBSPOT_CONTACTS_ROUTE = '/crm/v3/objects/contacts';
export const HUBSPOT_COMPANIES_ROUTE = '/crm/v3/objects/companies';
export const HUBSPOT_DEALS_ROUTE = '/crm/v3/objects/deals';
export const HUBSPOT_TICKETS_ROUTE = '/crm/v3/objects/tickets';

const OBJECT_ROUTE_BY_TYPE: Readonly<Record<HubSpotObjectType, string>> = {
  company: HUBSPOT_COMPANIES_ROUTE,
  contact: HUBSPOT_CONTACTS_ROUTE,
  deal: HUBSPOT_DEALS_ROUTE,
  ticket: HUBSPOT_TICKETS_ROUTE,
};

const LIST_ACTION_BY_TYPE: Readonly<Record<HubSpotObjectType, HubSpotReadRequest['action']>> = {
  company: 'list_companies',
  contact: 'list_contacts',
  deal: 'list_deals',
  ticket: 'list_tickets',
};

const GET_ACTION_BY_TYPE: Readonly<Record<HubSpotObjectType, HubSpotReadRequest['action']>> = {
  company: 'get_company',
  contact: 'get_contact',
  deal: 'get_deal',
  ticket: 'get_ticket',
};

const DEFAULT_PROPERTIES_BY_TYPE: Readonly<Record<HubSpotObjectType, readonly string[]>> = {
  company: [
    'name',
    'domain',
    'website',
    'industry',
    'lifecyclestage',
    'numberofemployees',
    'phone',
    'city',
    'state',
    'country',
    'createdate',
    'hs_lastmodifieddate',
  ],
  contact: [
    'email',
    'firstname',
    'lastname',
    'phone',
    'company',
    'jobtitle',
    'lifecyclestage',
    'website',
    'createdate',
    'lastmodifieddate',
  ],
  deal: [
    'dealname',
    'amount',
    'dealstage',
    'pipeline',
    'closedate',
    'hubspot_owner_id',
    'hs_priority',
    'createdate',
    'hs_lastmodifieddate',
  ],
  ticket: [
    'subject',
    'content',
    'hs_pipeline',
    'hs_pipeline_stage',
    'hs_ticket_priority',
    'hs_ticket_category',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
};

const DEFAULT_ASSOCIATIONS_BY_TYPE: Readonly<Record<HubSpotObjectType, readonly string[]>> = {
  company: ['contacts', 'deals', 'tickets'],
  contact: ['companies', 'deals', 'tickets'],
  deal: ['contacts', 'companies', 'tickets'],
  ticket: ['contacts', 'companies', 'deals'],
};

interface ParsedHubSpotReadPath {
  objectId?: string;
  objectType: HubSpotObjectType;
}

export function resolveHubSpotReadRequest(path: string): HubSpotReadRequest {
  const parsed = parseHubSpotReadPath(path);
  const endpoint = buildEndpoint(parsed);
  const query = buildQuery(parsed.objectType);

  if (parsed.objectId) {
    return {
      action: GET_ACTION_BY_TYPE[parsed.objectType],
      method: 'GET',
      endpoint,
      query,
    };
  }

  return {
    action: LIST_ACTION_BY_TYPE[parsed.objectType],
    method: 'GET',
    endpoint,
    query: {
      ...query,
      limit: '100',
    },
  };
}

function buildEndpoint(path: ParsedHubSpotReadPath): string {
  const route = OBJECT_ROUTE_BY_TYPE[path.objectType];
  if (!path.objectId) {
    return route;
  }
  return `${route}/${encodeURIComponent(path.objectId)}`;
}

function buildQuery(objectType: HubSpotObjectType): Record<string, string> {
  return {
    archived: 'false',
    associations: DEFAULT_ASSOCIATIONS_BY_TYPE[objectType].join(','),
    properties: DEFAULT_PROPERTIES_BY_TYPE[objectType].join(','),
  };
}

function parseHubSpotReadPath(path: string): ParsedHubSpotReadPath {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/hubspot/')) {
    throw new Error(`HubSpot read path must start with /hubspot/: ${path}`);
  }

  if (trimmed === '/hubspot/contacts' || trimmed === '/hubspot/contacts/') {
    return { objectType: 'contact' };
  }
  if (trimmed === '/hubspot/companies' || trimmed === '/hubspot/companies/') {
    return { objectType: 'company' };
  }
  if (trimmed === '/hubspot/deals' || trimmed === '/hubspot/deals/') {
    return { objectType: 'deal' };
  }
  if (trimmed === '/hubspot/tickets' || trimmed === '/hubspot/tickets/') {
    return { objectType: 'ticket' };
  }

  const match = /^\/hubspot\/(contacts|companies|deals|tickets)\/([^/]+)\.json$/u.exec(trimmed);
  if (!match?.[1] || !match[2]) {
    throw new Error(`No HubSpot read rule matched ${path}`);
  }

  return {
    objectId: decodeURIComponent(match[2]),
    objectType: objectTypeFromCollection(match[1]),
  };
}

function objectTypeFromCollection(collection: string): HubSpotObjectType {
  switch (collection) {
    case 'companies':
      return 'company';
    case 'contacts':
      return 'contact';
    case 'deals':
      return 'deal';
    case 'tickets':
      return 'ticket';
    default:
      throw new Error(`Unsupported HubSpot collection: ${collection}`);
  }
}
