import type { JsonValue, SendGridContact, SendGridMail } from './types.js';

export interface SendGridWritebackRequest {
  action: 'send_mail' | 'upsert_contact' | 'update_contact';
  method: 'PATCH' | 'POST' | 'PUT';
  endpoint: string;
  body: Record<string, unknown>;
}

const SENDGRID_MAIL_SEND_ENDPOINT = '/v3/mail/send';
const SENDGRID_CONTACTS_ENDPOINT = '/v3/marketing/contacts';

export function resolveSendGridWritebackRequest(path: string, content: string): SendGridWritebackRequest {
  const mailCreateMatch = path.match(/^\/sendgrid\/mail\/([^/]+)\.json$/);
  if (path === '/sendgrid/mail/' || (mailCreateMatch?.[1] && isDraftFilename(mailCreateMatch[1]))) {
    return buildMailSend(content);
  }

  const contactCreateMatch = path.match(/^\/sendgrid\/contacts\/([^/]+)\.json$/);
  if (path === '/sendgrid/contacts/' || (contactCreateMatch?.[1] && isDraftFilename(contactCreateMatch[1]))) {
    return buildContactUpsert(content);
  }

  const contactUpdateMatch = path.match(/^\/sendgrid\/contacts\/([^/]+)\.json$/);
  if (contactUpdateMatch?.[1]) {
    return buildContactUpdate(decodeURIComponent(contactUpdateMatch[1]), content);
  }

  throw new Error(`No SendGrid writeback rule matched ${path}`);
}

function buildMailSend(content: string): SendGridWritebackRequest {
  const payload = parseJsonObject(content) as Partial<SendGridMail> & Record<string, unknown>;
  const from = readAddress(payload.from);
  if (!from) {
    throw new Error('mail/new.json writeback requires a `from.email` address');
  }

  const personalizations = readPersonalizations(payload.personalizations);
  if (personalizations.length === 0) {
    throw new Error('mail/new.json writeback requires at least one personalization recipient');
  }

  const body: Record<string, unknown> = {
    from,
    personalizations,
  };
  copyOptionalString(payload, body, 'subject');
  copyOptionalString(payload, body, 'template_id');
  copyOptionalArray(payload, body, 'categories');
  copyOptionalRecord(payload, body, 'custom_args');
  copyOptionalRecord(payload, body, 'mail_settings');
  copyOptionalRecord(payload, body, 'tracking_settings');
  copyOptionalNumber(payload, body, 'send_at');
  if (Array.isArray(payload.content)) {
    body.content = payload.content;
  }
  const replyTo = readAddress(payload.reply_to);
  if (replyTo) {
    body.reply_to = replyTo;
  }

  return {
    action: 'send_mail',
    method: 'POST',
    endpoint: SENDGRID_MAIL_SEND_ENDPOINT,
    body,
  };
}

function buildContactUpsert(content: string): SendGridWritebackRequest {
  const payload = parseJsonObject(content);
  const contacts = readContacts(payload);
  if (contacts.length === 0) {
    throw new Error('contacts/new.json writeback requires at least one contact with an email');
  }

  const body: Record<string, unknown> = { contacts };
  const listIds = readStringArray(payload, 'list_ids');
  if (listIds.length > 0) {
    body.list_ids = listIds;
  }

  return {
    action: 'upsert_contact',
    method: 'PUT',
    endpoint: SENDGRID_CONTACTS_ENDPOINT,
    body,
  };
}

function buildContactUpdate(contactId: string, content: string): SendGridWritebackRequest {
  const payload = parseJsonObject(content) as Partial<SendGridContact> & Record<string, unknown>;
  const contact = normalizeContact({ ...payload, id: readString(payload, 'id') ?? contactId });
  if (!contact) {
    throw new Error('contacts/<id>.json writeback requires a contact email');
  }

  return {
    action: 'update_contact',
    method: 'PUT',
    endpoint: SENDGRID_CONTACTS_ENDPOINT,
    body: { contacts: [contact] },
  };
}

function readContacts(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const contactsValue = payload.contacts;
  if (Array.isArray(contactsValue)) {
    return contactsValue
      .map((entry) => (isRecord(entry) ? normalizeContact(entry) : undefined))
      .filter((entry): entry is Record<string, unknown> => entry !== undefined);
  }

  const contact = normalizeContact(payload);
  return contact ? [contact] : [];
}

function normalizeContact(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const email = readString(payload, 'email');
  if (!email) {
    return undefined;
  }

  const contact: Record<string, unknown> = { email };
  for (const key of [
    'id',
    'first_name',
    'last_name',
    'address_line_1',
    'address_line_2',
    'city',
    'state_province_region',
    'postal_code',
    'country',
    'phone_number',
    'whatsapp',
    'line',
    'facebook',
    'unique_name',
  ]) {
    copyOptionalString(payload, contact, key);
  }
  copyOptionalArray(payload, contact, 'alternate_emails');
  copyOptionalRecord(payload, contact, 'custom_fields');
  copyOptionalArray(payload, contact, 'list_ids');
  return contact;
}

function readPersonalizations(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return undefined;
      }
      const personalization: Record<string, unknown> = {};
      copyAddressArray(entry, personalization, 'to');
      copyAddressArray(entry, personalization, 'cc');
      copyAddressArray(entry, personalization, 'bcc');
      copyOptionalString(entry, personalization, 'subject');
      copyOptionalRecord(entry, personalization, 'headers');
      copyOptionalRecord(entry, personalization, 'substitutions');
      copyOptionalRecord(entry, personalization, 'dynamic_template_data');
      copyOptionalRecord(entry, personalization, 'custom_args');
      copyOptionalNumber(entry, personalization, 'send_at');
      return Object.keys(personalization).length > 0 ? personalization : undefined;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== undefined);
}

function copyAddressArray(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (!Array.isArray(value)) {
    return;
  }
  const addresses = value
    .map((entry) => readAddress(entry))
    .filter((entry): entry is Record<string, string> => entry !== undefined);
  if (addresses.length > 0) {
    target[key] = addresses;
  }
}

function readAddress(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const email = readString(value, 'email');
  if (!email) {
    return undefined;
  }
  const address: Record<string, string> = { email };
  const name = readString(value, 'name');
  if (name) {
    address.name = name;
  }
  return address;
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = JSON.parse(content) as JsonValue;
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function isDraftFilename(encodedFilename: string): boolean {
  const filename = decodeURIComponent(encodedFilename);
  return /^(new|create|draft|send)(?:[-_\s].*)?$/iu.test(filename);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function copyOptionalString(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = readString(source, key);
  if (value) {
    target[key] = value;
  }
}

function copyOptionalNumber(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[key] = value;
  }
}

function copyOptionalArray(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = source[key];
  if (Array.isArray(value)) {
    target[key] = value;
  }
}

function copyOptionalRecord(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = source[key];
  if (isRecord(value)) {
    target[key] = value;
  }
}
