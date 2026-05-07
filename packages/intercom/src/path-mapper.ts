export const INTERCOM_PATH_ROOT = '/intercom';

export const INTERCOM_OBJECT_TYPES = [
  'conversation',
  'contact',
  'company',
] as const;

export type IntercomPathObjectType = (typeof INTERCOM_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, IntercomPathObjectType>> = {
  company: 'company',
  companies: 'company',
  intercomcompany: 'company',
  contact: 'contact',
  contacts: 'contact',
  customer: 'contact',
  customers: 'contact',
  lead: 'contact',
  leads: 'contact',
  user: 'contact',
  users: 'contact',
  visitor: 'contact',
  visitors: 'contact',
  intercomcontact: 'contact',
  conversation: 'conversation',
  conversations: 'conversation',
  conversationpart: 'conversation',
  conversationparts: 'conversation',
  intercomconversation: 'conversation',
};

const NANGO_MODEL_MAP: Readonly<Record<string, IntercomPathObjectType>> = {
  IntercomCompany: 'company',
  IntercomContact: 'contact',
  IntercomConversation: 'conversation',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Intercom ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeIntercomPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function normalizeIntercomObjectType(objectType: string): IntercomPathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[^a-z]+/g, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Intercom object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeIntercomObjectType(objectType: string): IntercomPathObjectType | undefined {
  try {
    return normalizeIntercomObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoIntercomModel(model: string): IntercomPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeIntercomObjectType(model);
}

export function intercomConversationPath(conversationId: string): string {
  return `${INTERCOM_PATH_ROOT}/conversations/${encodeIntercomPathSegment(conversationId)}.json`;
}

export function intercomContactPath(contactId: string): string {
  return `${INTERCOM_PATH_ROOT}/contacts/${encodeIntercomPathSegment(contactId)}.json`;
}

export function intercomCompanyPath(companyId: string): string {
  return `${INTERCOM_PATH_ROOT}/companies/${encodeIntercomPathSegment(companyId)}.json`;
}

export function computeIntercomPath(objectType: string, objectId: string): string {
  const normalizedType = normalizeIntercomObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'conversation':
      return intercomConversationPath(normalizedId);
    case 'contact':
      return intercomContactPath(normalizedId);
    case 'company':
      return intercomCompanyPath(normalizedId);
  }
}
