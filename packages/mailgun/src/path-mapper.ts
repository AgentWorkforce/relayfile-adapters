export const MAILGUN_PATH_ROOT = '/mailgun';

export const MAILGUN_OBJECT_TYPES = [
  'message',
  'event',
  'list',
] as const;

export type MailgunPathObjectType = (typeof MAILGUN_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, MailgunPathObjectType>> = {
  email: 'message',
  emails: 'message',
  event: 'event',
  events: 'event',
  list: 'list',
  lists: 'list',
  mailinglist: 'list',
  mailinglists: 'list',
  mailgunemail: 'message',
  mailgunevent: 'event',
  mailgunlist: 'list',
  mailgunmessage: 'message',
  message: 'message',
  messages: 'message',
};

const NANGO_MODEL_MAP: Readonly<Record<string, MailgunPathObjectType>> = {
  MailgunEvent: 'event',
  MailgunList: 'list',
  MailgunMessage: 'message',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Mailgun ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeMailgunPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function normalizeMailgunObjectType(objectType: string): MailgunPathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Mailgun object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeMailgunObjectType(objectType: string): MailgunPathObjectType | undefined {
  try {
    return normalizeMailgunObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoMailgunModel(model: string): MailgunPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeMailgunObjectType(model);
}

export function normalizeMailgunDomain(domain: string | undefined): string {
  return assertNonEmptySegment(domain ?? 'default', 'domain');
}

export function mailgunMessagePath(messageId: string, domain?: string): string {
  return `${MAILGUN_PATH_ROOT}/domains/${encodeMailgunPathSegment(normalizeMailgunDomain(domain))}/messages/${encodeMailgunPathSegment(messageId)}.json`;
}

export function mailgunEventPath(eventId: string, domain?: string): string {
  return `${MAILGUN_PATH_ROOT}/domains/${encodeMailgunPathSegment(normalizeMailgunDomain(domain))}/events/${encodeMailgunPathSegment(eventId)}.json`;
}

export function mailgunListPath(address: string): string {
  return `${MAILGUN_PATH_ROOT}/lists/${encodeMailgunPathSegment(address)}.json`;
}

export function computeMailgunPath(objectType: string, objectId: string, domain?: string): string {
  const normalizedType = normalizeMailgunObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'message':
      return mailgunMessagePath(normalizedId, domain);
    case 'event':
      return mailgunEventPath(normalizedId, domain);
    case 'list':
      return mailgunListPath(normalizedId);
  }
}

export function extractMailgunDomainFromPath(path: string): string | undefined {
  const match = /^\/mailgun\/domains\/([^/]+)\//.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function extractMailgunObjectIdFromPath(path: string): string | undefined {
  const match = /\/([^/.]+)\.json$/.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
