import type { ZendeskWritebackRequest } from './types.js';

const ZENDESK_TICKETS_ROUTE = '/api/v2/tickets';
const ZENDESK_USERS_ROUTE = '/api/v2/users';
const ZENDESK_ORGANIZATIONS_ROUTE = '/api/v2/organizations';

export function resolveWritebackRequest(path: string, content: string): ZendeskWritebackRequest {
  const ticketCommentMatch = path.match(/^\/zendesk\/tickets\/([^/]+)\/comments\/new\.json$/);
  if (ticketCommentMatch?.[1]) {
    return buildTicketCommentRequest(extractZendeskId(ticketCommentMatch[1]), content);
  }

  if (path === '/zendesk/tickets/new.json' || path === '/zendesk/tickets/') {
    return buildTicketCreateRequest(content);
  }

  const ticketUpdateMatch = path.match(/^\/zendesk\/tickets\/([^/]+)\.json$/);
  if (ticketUpdateMatch?.[1]) {
    return buildTicketUpdateRequest(extractZendeskId(ticketUpdateMatch[1]), content);
  }

  if (path === '/zendesk/users/new.json' || path === '/zendesk/users/') {
    return buildUserCreateRequest(content);
  }

  const userUpdateMatch = path.match(/^\/zendesk\/users\/([^/]+)\.json$/);
  if (userUpdateMatch?.[1]) {
    return buildUserUpdateRequest(decodeURIComponent(userUpdateMatch[1]), content);
  }

  const organizationUpdateMatch = path.match(/^\/zendesk\/organizations\/([^/]+)\.json$/);
  if (organizationUpdateMatch?.[1]) {
    return buildOrganizationUpdateRequest(decodeURIComponent(organizationUpdateMatch[1]), content);
  }

  throw new Error(`No Zendesk writeback rule matched ${path}`);
}

function buildTicketCommentRequest(ticketId: string, content: string): ZendeskWritebackRequest {
  const parsed = safeParseJson(content);
  const comment = typeof parsed === 'string'
    ? { body: parsed, public: true }
    : isRecord(parsed)
      ? readObject(parsed, 'comment') ?? parsed
      : parsed;
  if (!isRecord(comment)) {
    throw new Error('tickets/<id>/comments/new.json writeback expects a comment object or plain string');
  }
  const body = readString(comment, 'body') ?? readString(comment, 'html_body');
  if (!body) {
    throw new Error('tickets/<id>/comments/new.json writeback requires a non-empty comment body');
  }
  return {
    action: 'add_ticket_comment',
    method: 'PUT',
    endpoint: `${ZENDESK_TICKETS_ROUTE}/${ticketId}.json`,
    body: {
      ticket: {
        comment: compactObject({
          body: readString(comment, 'body'),
          html_body: readString(comment, 'html_body'),
          public: readBoolean(comment, 'public') ?? true,
        }),
      },
    },
  };
}

function buildTicketCreateRequest(content: string): ZendeskWritebackRequest {
  const payload = parseJsonObject(content);
  const ticket = readObject(payload, 'ticket') ?? payload;
  const subject = readString(ticket, 'subject');
  if (!subject) {
    throw new Error('tickets/new.json writeback requires a `subject`');
  }
  return {
    action: 'create_ticket',
    method: 'POST',
    endpoint: `${ZENDESK_TICKETS_ROUTE}.json`,
    body: { ticket: pickTicketFields(ticket, true) },
  };
}

function buildTicketUpdateRequest(ticketId: string, content: string): ZendeskWritebackRequest {
  const payload = parseJsonObject(content);
  const source = looksLikeSyncedEnvelope(payload) ? readObject(payload, 'payload') ?? payload : readObject(payload, 'ticket') ?? payload;
  const ticket = pickTicketFields(source, false);
  if (Object.keys(ticket).length === 0) {
    throw new Error('tickets/<id>.json update writeback requires at least one mutable ticket field');
  }
  return {
    action: 'update_ticket',
    method: 'PUT',
    endpoint: `${ZENDESK_TICKETS_ROUTE}/${ticketId}.json`,
    body: { ticket },
  };
}

function buildUserCreateRequest(content: string): ZendeskWritebackRequest {
  const payload = parseJsonObject(content);
  const user = readObject(payload, 'user') ?? payload;
  const name = readString(user, 'name');
  if (!name) {
    throw new Error('users/new.json writeback requires a `name`');
  }
  return {
    action: 'create_user',
    method: 'POST',
    endpoint: `${ZENDESK_USERS_ROUTE}.json`,
    body: { user: pickUserFields(user, true) },
  };
}

function buildUserUpdateRequest(userId: string, content: string): ZendeskWritebackRequest {
  const payload = parseJsonObject(content);
  const source = looksLikeSyncedEnvelope(payload) ? readObject(payload, 'payload') ?? payload : readObject(payload, 'user') ?? payload;
  const user = pickUserFields(source, false);
  if (Object.keys(user).length === 0) {
    throw new Error('users/<id>.json update writeback requires at least one mutable user field');
  }
  return {
    action: 'update_user',
    method: 'PUT',
    endpoint: `${ZENDESK_USERS_ROUTE}/${userId}.json`,
    body: { user },
  };
}

function buildOrganizationUpdateRequest(organizationId: string, content: string): ZendeskWritebackRequest {
  const payload = parseJsonObject(content);
  const source = looksLikeSyncedEnvelope(payload)
    ? readObject(payload, 'payload') ?? payload
    : readObject(payload, 'organization') ?? payload;
  const organization = pickOrganizationFields(source);
  if (Object.keys(organization).length === 0) {
    throw new Error('organizations/<id>.json update writeback requires at least one mutable organization field');
  }
  return {
    action: 'update_organization',
    method: 'PUT',
    endpoint: `${ZENDESK_ORGANIZATIONS_ROUTE}/${organizationId}.json`,
    body: { organization },
  };
}

const TICKET_FIELDS = new Set([
  'assignee_id',
  'brand_id',
  'comment',
  'custom_fields',
  'description',
  'due_at',
  'external_id',
  'group_id',
  'organization_id',
  'priority',
  'recipient',
  'requester_id',
  'status',
  'subject',
  'submitter_id',
  'tags',
  'type',
]);

const USER_FIELDS = new Set([
  'active',
  'alias',
  'details',
  'email',
  'external_id',
  'locale',
  'name',
  'notes',
  'organization_id',
  'phone',
  'role',
  'suspended',
  'tags',
  'time_zone',
  'user_fields',
  'verified',
]);

const ORGANIZATION_FIELDS = new Set([
  'details',
  'domain_names',
  'external_id',
  'group_id',
  'name',
  'notes',
  'organization_fields',
  'shared_comments',
  'shared_tickets',
  'tags',
]);

function pickTicketFields(source: Record<string, unknown>, includeRequired: boolean): Record<string, unknown> {
  return pickAllowedFields(source, TICKET_FIELDS, includeRequired ? ['subject'] : []);
}

function pickUserFields(source: Record<string, unknown>, includeRequired: boolean): Record<string, unknown> {
  return pickAllowedFields(source, USER_FIELDS, includeRequired ? ['name'] : []);
}

function pickOrganizationFields(source: Record<string, unknown>): Record<string, unknown> {
  return pickAllowedFields(source, ORGANIZATION_FIELDS, []);
}

function pickAllowedFields(
  source: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key) && value !== undefined) {
      result[key] = value;
    }
  }
  for (const key of required) {
    if (!(key in result)) {
      const value = source[key];
      if (value !== undefined) result[key] = value;
    }
  }
  return result;
}

function extractZendeskId(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const slugged = /--(.+)$/u.exec(decoded);
  return slugged?.[1] ?? decoded;
}

const ENVELOPE_MARKER_KEYS = ['provider', 'objectType', 'objectId', 'workspaceId'] as const;

function looksLikeSyncedEnvelope(payload: Record<string, unknown>): boolean {
  if (!isRecord(payload.payload)) return false;
  return ENVELOPE_MARKER_KEYS.some((key) => key in payload);
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content.trim();
  }
}

function readObject(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === 'boolean' ? (record[key] as boolean) : undefined;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
