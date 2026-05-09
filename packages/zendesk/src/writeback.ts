import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import { resources } from './resources.js';
import type { ZendeskWritebackRequest } from './types.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

const ZENDESK_TICKETS_ROUTE = '/api/v2/tickets';
const ZENDESK_USERS_ROUTE = '/api/v2/users';
const ZENDESK_ORGANIZATIONS_ROUTE = '/api/v2/organizations';

export function resolveWritebackRequest(path: string, content: string): ZendeskWritebackRequest {
  const normalized = normalizePath(path);
  const route = classifyWrite(normalized, resources);

  if (route?.resource.name === 'comments' && route.kind === 'create') {
    const ticketCommentMatch = normalized.match(/^\/zendesk\/tickets\/([^/]+)\/comments\/([^/]+)\.json$/);
    if (ticketCommentMatch?.[1]) {
      return buildTicketCommentRequest(extractZendeskId(ticketCommentMatch[1]), content);
    }
  }

  if (route?.resource.name === 'tickets') {
    if (route.kind === 'create') {
      return buildTicketCreateRequest(content);
    }
    const ticketUpdateMatch = normalized.match(/^\/zendesk\/tickets\/([^/]+)\.json$/);
    if (route.kind === 'patch' && ticketUpdateMatch?.[1]) {
      return buildTicketUpdateRequest(extractZendeskId(ticketUpdateMatch[1]), content);
    }
  }

  if (route?.resource.name === 'users') {
    if (route.kind === 'create') {
      return buildUserCreateRequest(content);
    }
    const userUpdateMatch = normalized.match(/^\/zendesk\/users\/([^/]+)\.json$/);
    if (route.kind === 'patch' && userUpdateMatch?.[1]) {
      return buildUserUpdateRequest(decodeURIComponent(userUpdateMatch[1]), content);
    }
  }

  // Organizations are not yet declared as a resource; keep ad-hoc routing.
  const organizationUpdateMatch = normalized.match(/^\/zendesk\/organizations\/([^/]+)\.json$/);
  if (organizationUpdateMatch?.[1]) {
    return buildOrganizationUpdateRequest(decodeURIComponent(organizationUpdateMatch[1]), content);
  }

  throw new Error(`No Zendesk writeback rule matched ${path}`);
}

export function resolveDeleteRequest(path: string): ZendeskWritebackRequest {
  const normalized = normalizePath(path);
  const route = classifyWrite(normalized, resources, { fsEvent: 'delete' });

  if (route?.resource.name === 'tickets') {
    const ticketMatch = normalized.match(/^\/zendesk\/tickets\/([^/]+)\.json$/);
    if (ticketMatch?.[1]) {
      return {
        action: 'delete_ticket',
        method: 'DELETE',
        endpoint: `${ZENDESK_TICKETS_ROUTE}/${extractZendeskId(ticketMatch[1])}.json`,
      };
    }
  }

  if (route?.resource.name === 'users') {
    const userMatch = normalized.match(/^\/zendesk\/users\/([^/]+)\.json$/);
    if (userMatch?.[1]) {
      return {
        action: 'delete_user',
        method: 'DELETE',
        endpoint: `${ZENDESK_USERS_ROUTE}/${decodeURIComponent(userMatch[1])}.json`,
      };
    }
  }

  // Organizations are not yet declared as a resource; keep ad-hoc routing.
  const orgMatch = normalized.match(/^\/zendesk\/organizations\/([^/]+)\.json$/);
  if (orgMatch?.[1]) {
    return {
      action: 'delete_organization',
      method: 'DELETE',
      endpoint: `${ZENDESK_ORGANIZATIONS_ROUTE}/${decodeURIComponent(orgMatch[1])}.json`,
    };
  }

  throw new Error(`No Zendesk delete writeback rule matched ${path}`);
}

function buildTicketCommentRequest(ticketId: string, content: string): ZendeskWritebackRequest {
  const parsed = safeParseJson(content);
  const comment = typeof parsed === 'string'
    ? { body: parsed, public: true }
    : isRecord(parsed)
      ? readObject(parsed, 'comment') ?? parsed
      : parsed;
  if (!isRecord(comment)) {
    throw new Error('ticket comment create writeback expects a comment object or plain string');
  }
  const body = readString(comment, 'body') ?? readString(comment, 'html_body');
  if (!body) {
    throw new Error('ticket comment create writeback requires a non-empty comment body');
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
  // Unwrap the `{"ticket": {...}}` envelope (also emitted by sync-read flow)
  // before checking read-only fields, so caller-supplied envelopes can't
  // smuggle a stray `ticket.id` past the gate.
  const ticket = readObject(payload, 'ticket') ?? payload;
  rejectReadOnlyFields(ticket);
  const subject = readString(ticket, 'subject');
  if (!subject) {
    throw new Error('ticket create writeback requires a `subject`');
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
  rejectReadOnlyFields(source);
  const ticket = pickTicketFields(source, false);
  if (Object.keys(ticket).length === 0) {
    throw new Error('ticket update writeback requires at least one mutable ticket field');
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
  // Same envelope-first / reject-after order as ticket create — see
  // buildTicketCreateRequest.
  const user = readObject(payload, 'user') ?? payload;
  rejectReadOnlyFields(user);
  const name = readString(user, 'name');
  if (!name) {
    throw new Error('user create writeback requires a `name`');
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
  rejectReadOnlyFields(source);
  const user = pickUserFields(source, false);
  if (Object.keys(user).length === 0) {
    throw new Error('user update writeback requires at least one mutable user field');
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
  rejectReadOnlyFields(source);
  const organization = pickOrganizationFields(source);
  if (Object.keys(organization).length === 0) {
    throw new Error('organization update writeback requires at least one mutable organization field');
  }
  return {
    action: 'update_organization',
    method: 'PUT',
    endpoint: `${ZENDESK_ORGANIZATIONS_ROUTE}/${organizationId}.json`,
    body: { organization },
  };
}

const READ_ONLY_FIELDS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'url',
  'identifier',
  'provider',
  'objectType',
  'objectId',
  'workspaceId',
  'connectionId',
  '_webhook',
  '_connection',
]);

function rejectReadOnlyFields(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
  }
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('Zendesk writeback path must be a non-empty string');
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
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
