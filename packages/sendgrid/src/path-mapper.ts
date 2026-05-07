export const SENDGRID_PATH_ROOT = '/sendgrid';

export const SENDGRID_OBJECT_TYPES = ['mail', 'event', 'contact'] as const;

export type SendGridPathObjectType = (typeof SENDGRID_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, SendGridPathObjectType>> = {
  contact: 'contact',
  contacts: 'contact',
  marketingcontact: 'contact',
  marketingcontacts: 'contact',
  recipient: 'contact',
  recipients: 'contact',
  email: 'mail',
  emails: 'mail',
  mail: 'mail',
  mails: 'mail',
  message: 'mail',
  messages: 'mail',
  sendgridmail: 'mail',
  event: 'event',
  events: 'event',
  sendgridevent: 'event',
  webhookevent: 'event',
  webhookevents: 'event',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`SendGrid ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeSendGridPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function normalizeSendGridObjectType(objectType: string): SendGridPathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported SendGrid object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeSendGridObjectType(objectType: string): SendGridPathObjectType | undefined {
  try {
    return normalizeSendGridObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function sendGridMailPath(mailId: string): string {
  return `${SENDGRID_PATH_ROOT}/mail/${encodeSendGridPathSegment(mailId)}.json`;
}

export function sendGridEventPath(eventId: string): string {
  return `${SENDGRID_PATH_ROOT}/events/${encodeSendGridPathSegment(eventId)}.json`;
}

export function sendGridContactPath(contactId: string): string {
  return `${SENDGRID_PATH_ROOT}/contacts/${encodeSendGridPathSegment(contactId)}.json`;
}

export function computeSendGridPath(objectType: string, objectId: string): string {
  const normalizedType = normalizeSendGridObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'mail':
      return sendGridMailPath(normalizedId);
    case 'event':
      return sendGridEventPath(normalizedId);
    case 'contact':
      return sendGridContactPath(normalizedId);
  }
}
