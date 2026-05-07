export const ZENDESK_PATH_ROOT = '/zendesk';

export const ZENDESK_OBJECT_TYPES = [
  'organization',
  'ticket',
  'user',
] as const;

export type ZendeskPathObjectType = (typeof ZENDESK_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, ZendeskPathObjectType>> = {
  organization: 'organization',
  organizations: 'organization',
  zendeskorganization: 'organization',
  ticket: 'ticket',
  tickets: 'ticket',
  zendeskticket: 'ticket',
  user: 'user',
  users: 'user',
  zendeskuser: 'user',
};

const NANGO_MODEL_MAP: Readonly<Record<string, ZendeskPathObjectType>> = {
  ZendeskOrganization: 'organization',
  ZendeskTicket: 'ticket',
  ZendeskUser: 'user',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Zendesk ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeZendeskPathSegment(value: string): string {
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
  return slug ? `${slug}--${encodeZendeskPathSegment(id)}` : encodeZendeskPathSegment(id);
}

export function normalizeZendeskObjectType(objectType: string): ZendeskPathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Zendesk object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeZendeskObjectType(objectType: string): ZendeskPathObjectType | undefined {
  try {
    return normalizeZendeskObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoZendeskModel(model: string): ZendeskPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeZendeskObjectType(model);
}

export function zendeskTicketPath(ticketId: string, subject?: string): string {
  return `${ZENDESK_PATH_ROOT}/tickets/${titleSegmentWithId(subject, ticketId)}.json`;
}

export function zendeskUserPath(userId: string): string {
  return `${ZENDESK_PATH_ROOT}/users/${encodeZendeskPathSegment(userId)}.json`;
}

export function zendeskOrganizationPath(organizationId: string): string {
  return `${ZENDESK_PATH_ROOT}/organizations/${encodeZendeskPathSegment(organizationId)}.json`;
}

export function computeZendeskPath(objectType: string, objectId: string, title?: string): string {
  const normalizedType = normalizeZendeskObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'ticket':
      return zendeskTicketPath(normalizedId, title);
    case 'user':
      return zendeskUserPath(normalizedId);
    case 'organization':
      return zendeskOrganizationPath(normalizedId);
  }
}
