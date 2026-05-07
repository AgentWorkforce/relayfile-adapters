import type { MailgunWritebackRequest } from './types.js';

export const MAILGUN_SEND_MESSAGE_ROUTE = '/v3/{domain}/messages';
export const MAILGUN_READ_EVENTS_ROUTE_ANCHOR = '/v3/{domain}/events';
export const MAILGUN_WRITEBACK_LISTS_ROUTE = '/v3/lists';

function encodeEndpointSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Mailgun endpoint segment must be a non-empty string');
  }
  return encodeURIComponent(trimmed);
}

function routeForDomain(route: string, domain: string): string {
  return route.replace('{domain}', encodeEndpointSegment(domain));
}

export function resolveWritebackRequest(path: string, content: string): MailgunWritebackRequest {
  const sendMatch = /^\/mailgun\/domains\/([^/]+)\/messages\/new\.json$/.exec(path);
  if (sendMatch?.[1]) {
    return buildSendMessage(decodeURIComponent(sendMatch[1]), content);
  }

  if (path === '/mailgun/lists/new.json') {
    return buildCreateList(content);
  }

  const listUpdateMatch = /^\/mailgun\/lists\/([^/]+)\.json$/.exec(path);
  if (listUpdateMatch?.[1]) {
    return buildUpdateList(decodeURIComponent(listUpdateMatch[1]), content);
  }

  const listMemberMatch = /^\/mailgun\/lists\/([^/]+)\/members\/([^/]+)\.json$/.exec(path);
  if (listMemberMatch?.[1] && listMemberMatch[2]) {
    return buildUpsertListMember(
      decodeURIComponent(listMemberMatch[1]),
      decodeURIComponent(listMemberMatch[2]),
      content,
    );
  }

  throw new Error(`No Mailgun writeback rule matched ${path}`);
}

function buildSendMessage(domain: string, content: string): MailgunWritebackRequest {
  const payload = parseJsonObject(content);
  const from = readString(payload, 'from');
  const to = readStringOrArray(payload, 'to');
  const subject = readString(payload, 'subject');
  const text = readString(payload, 'text');
  const html = readString(payload, 'html');

  if (!from) {
    throw new Error('messages/new.json writeback requires `from`');
  }
  if (!to) {
    throw new Error('messages/new.json writeback requires `to`');
  }
  if (!subject) {
    throw new Error('messages/new.json writeback requires `subject`');
  }
  if (!text && !html) {
    throw new Error('messages/new.json writeback requires `text` or `html`');
  }

  const body: Record<string, unknown> = { from, to, subject };
  if (text) body.text = text;
  if (html) body.html = html;
  copyOptionalString(payload, body, 'cc');
  copyOptionalString(payload, body, 'bcc');
  copyOptionalString(payload, body, 'reply-to');
  copyOptionalString(payload, body, 'o:tag');
  copyOptionalString(payload, body, 'o:campaign');
  copyOptionalString(payload, body, 'o:tracking');
  copyOptionalString(payload, body, 'o:tracking-clicks');
  copyOptionalString(payload, body, 'o:tracking-opens');
  copyOptionalRecord(payload, body, 'h:Reply-To');
  copyUserVariables(payload, body);

  return {
    action: 'send_message',
    method: 'POST',
    endpoint: routeForDomain(MAILGUN_SEND_MESSAGE_ROUTE, domain),
    body,
  };
}

function buildCreateList(content: string): MailgunWritebackRequest {
  const payload = parseJsonObject(content);
  const address = readString(payload, 'address');
  if (!address) {
    throw new Error('lists/new.json writeback requires `address`');
  }

  const body = buildListBody(payload);
  body.address = address;

  return {
    action: 'create_list',
    method: 'POST',
    endpoint: MAILGUN_WRITEBACK_LISTS_ROUTE,
    body,
  };
}

function buildUpdateList(address: string, content: string): MailgunWritebackRequest {
  const payload = parseJsonObject(content);
  const body = buildListBody(payload);

  return {
    action: 'update_list',
    method: 'PUT',
    endpoint: `${MAILGUN_WRITEBACK_LISTS_ROUTE}/${encodeEndpointSegment(address)}`,
    body,
  };
}

function buildUpsertListMember(address: string, memberAddress: string, content: string): MailgunWritebackRequest {
  const payload = parseJsonObject(content);
  const body: Record<string, unknown> = { address: memberAddress };
  const name = readString(payload, 'name');
  if (name) body.name = name;
  const vars = readRecord(payload, 'vars');
  if (vars) body.vars = vars;
  const subscribed = readBoolean(payload, 'subscribed');
  if (subscribed !== undefined) body.subscribed = subscribed;
  const upsert = readBoolean(payload, 'upsert');
  body.upsert = upsert ?? true;

  return {
    action: 'upsert_list_member',
    method: 'POST',
    endpoint: `${MAILGUN_WRITEBACK_LISTS_ROUTE}/${encodeEndpointSegment(address)}/members`,
    body,
  };
}

function buildListBody(payload: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyOptionalString(payload, body, 'name');
  copyOptionalString(payload, body, 'description');
  copyOptionalString(payload, body, 'access_level');
  copyOptionalString(payload, body, 'reply_preference');
  copyOptionalString(payload, body, 'address');
  return body;
}

function copyOptionalString(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  const value = readString(source, key);
  if (value) target[key] = value;
}

function copyOptionalRecord(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  const value = readRecord(source, key);
  if (value) target[key] = value;
}

function copyUserVariables(source: Record<string, unknown>, target: Record<string, unknown>): void {
  const variables = readRecord(source, 'v:variables') ?? readRecord(source, 'variables');
  if (!variables) return;

  for (const [key, value] of Object.entries(variables)) {
    target[`v:${key}`] = value;
  }
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Mailgun writeback expects a JSON object payload');
  }
  return parsed;
}

function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Mailgun writeback payload must be valid JSON: ${toErrorMessage(error)}`);
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringOrArray(record: Record<string, unknown>, key: string): string | string[] | undefined {
  const value = record[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
