import type { HubSpotObjectType } from './types.js';

export const HUBSPOT_PATH_ROOT = '/hubspot';

export const HUBSPOT_PATH_OBJECT_TYPES = ['contact', 'company', 'deal', 'ticket'] as const;

export type HubSpotPathObjectType = (typeof HUBSPOT_PATH_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, HubSpotPathObjectType>> = {
  companies: 'company',
  company: 'company',
  contact: 'contact',
  contacts: 'contact',
  crmcompany: 'company',
  crmcontact: 'contact',
  crmdeal: 'deal',
  crmticket: 'ticket',
  deal: 'deal',
  deals: 'deal',
  hubspotcompany: 'company',
  hubspotcontact: 'contact',
  hubspotdeal: 'deal',
  hubspotticket: 'ticket',
  ticket: 'ticket',
  tickets: 'ticket',
};

const NANGO_MODEL_MAP: Readonly<Record<string, HubSpotPathObjectType>> = {
  HubSpotCompany: 'company',
  HubSpotContact: 'contact',
  HubSpotDeal: 'deal',
  HubSpotTicket: 'ticket',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`HubSpot ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeHubSpotPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function normalizeHubSpotObjectType(objectType: string): HubSpotObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported HubSpot object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeHubSpotObjectType(objectType: string): HubSpotObjectType | undefined {
  try {
    return normalizeHubSpotObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoHubSpotModel(model: string): HubSpotObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeHubSpotObjectType(model);
}

export function hubSpotContactPath(contactId: string): string {
  return `${HUBSPOT_PATH_ROOT}/contacts/${encodeHubSpotPathSegment(contactId)}.json`;
}

export function hubSpotCompanyPath(companyId: string): string {
  return `${HUBSPOT_PATH_ROOT}/companies/${encodeHubSpotPathSegment(companyId)}.json`;
}

export function hubSpotDealPath(dealId: string): string {
  return `${HUBSPOT_PATH_ROOT}/deals/${encodeHubSpotPathSegment(dealId)}.json`;
}

export function hubSpotTicketPath(ticketId: string): string {
  return `${HUBSPOT_PATH_ROOT}/tickets/${encodeHubSpotPathSegment(ticketId)}.json`;
}

export function computeHubSpotPath(objectType: string, objectId: string): string {
  const normalizedType = normalizeHubSpotObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'company':
      return hubSpotCompanyPath(normalizedId);
    case 'contact':
      return hubSpotContactPath(normalizedId);
    case 'deal':
      return hubSpotDealPath(normalizedId);
    case 'ticket':
      return hubSpotTicketPath(normalizedId);
  }
}

export function decodeHubSpotPathObjectId(segment: string): string {
  const withoutJson = segment.endsWith('.json') ? segment.slice(0, -5) : segment;
  return decodeURIComponent(assertNonEmptySegment(withoutJson, 'path object id'));
}
