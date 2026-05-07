import { extractCalendlyIdFromPathSegment } from './path-mapper.js';
import type { CalendlyWritebackRequest, JsonValue } from './types.js';

const CALENDLY_SCHEDULED_EVENTS_ROUTE = '/scheduled_events';
const CALENDLY_EVENT_TYPES_ROUTE = '/event_types';
const CALENDLY_INVITEES_ROUTE = '/invitees';

export function resolveCalendlyWritebackRequest(path: string, content: string): CalendlyWritebackRequest {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === '/calendly/scheduled-events/new.json' || normalizedPath === '/calendly/scheduled-events/') {
    return buildScheduledEventCreate(content);
  }

  const scheduledEventCancelMatch = normalizedPath.match(/^\/calendly\/scheduled-events\/([^/]+)\/cancel\.json$/u);
  if (scheduledEventCancelMatch?.[1]) {
    return buildScheduledEventCancel(extractCalendlyIdFromPathSegment(scheduledEventCancelMatch[1]), content);
  }

  const scheduledEventUpdateMatch = normalizedPath.match(/^\/calendly\/scheduled-events\/([^/]+)\.json$/u);
  if (scheduledEventUpdateMatch?.[1]) {
    throw new Error('Calendly does not support updating scheduled events through the public API; cancel the event and create a new invitee instead');
  }

  const inviteeCancelMatch = normalizedPath.match(/^\/calendly\/invitees\/([^/]+)\/cancel\.json$/u);
  if (inviteeCancelMatch?.[1]) {
    throw new Error('Calendly does not support invitee-level cancellation through the public API; cancel the scheduled event or use the invitee cancel_url');
  }

  const inviteeUpdateMatch = normalizedPath.match(/^\/calendly\/invitees\/([^/]+)\.json$/u);
  if (inviteeUpdateMatch?.[1]) {
    throw new Error('Calendly does not support updating invitees through the public API; use the invitee reschedule_url when available');
  }

  if (normalizedPath === '/calendly/event-types/new.json' || normalizedPath === '/calendly/event-types/') {
    return buildEventTypeCreate(content);
  }

  const eventTypeUpdateMatch = normalizedPath.match(/^\/calendly\/event-types\/([^/]+)\.json$/u);
  if (eventTypeUpdateMatch?.[1]) {
    return buildEventTypeUpdate(extractCalendlyIdFromPathSegment(eventTypeUpdateMatch[1]), content);
  }

  throw new Error(`No Calendly writeback rule matched ${path}`);
}

function buildScheduledEventCreate(content: string): CalendlyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const eventType = readString(payload, 'event_type');
  const startTime = readString(payload, 'start_time');
  const invitee = readRecord(payload, 'invitee');
  if (!eventType) {
    throw new Error('scheduled-events/new.json writeback requires `event_type`');
  }
  if (!startTime) {
    throw new Error('scheduled-events/new.json writeback requires `start_time`');
  }
  if (!invitee) {
    throw new Error('scheduled-events/new.json writeback requires `invitee`');
  }

  const body = pickAllowed(payload, [
    'event_type',
    'start_time',
    'invitee',
    'location',
    'timezone',
    'questions_and_answers',
    'tracking',
  ]);

  return {
    action: 'create_event_invitee',
    method: 'POST',
    endpoint: CALENDLY_INVITEES_ROUTE,
    body,
  };
}

function buildScheduledEventCancel(eventId: string, content: string): CalendlyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObjectOrEmpty(content));
  const body: Record<string, unknown> = {};
  copyString(payload, body, 'reason');

  return {
    action: 'cancel_scheduled_event',
    method: 'POST',
    endpoint: `${CALENDLY_SCHEDULED_EVENTS_ROUTE}/${encodeURIComponent(eventId)}/cancellation`,
    body,
  };
}

function buildEventTypeCreate(content: string): CalendlyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const name = readString(payload, 'name');
  if (!name) {
    throw new Error('event-types/new.json writeback requires a non-empty `name`');
  }

  const body = pickAllowed(payload, [
    'name',
    'duration',
    'slug',
    'active',
    'color',
    'description_plain',
    'internal_note',
  ]);

  return {
    action: 'create_event_type',
    method: 'POST',
    endpoint: CALENDLY_EVENT_TYPES_ROUTE,
    body,
  };
}

function buildEventTypeUpdate(eventTypeId: string, content: string): CalendlyWritebackRequest {
  const payload = unwrapEnvelope(parseJsonObject(content));
  const body = pickAllowed(payload, [
    'name',
    'duration',
    'slug',
    'active',
    'color',
    'description_plain',
    'internal_note',
  ]);
  if (Object.keys(body).length === 0) {
    throw new Error('event-types/<id>.json update writeback requires at least one mutable field');
  }

  return {
    action: 'update_event_type',
    method: 'PATCH',
    endpoint: `${CALENDLY_EVENT_TYPES_ROUTE}/${encodeURIComponent(eventTypeId)}`,
    body,
  };
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function parseJsonObjectOrEmpty(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed) return {};
  const parsed = safeParseJson(trimmed);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function safeParseJson(content: string): JsonValue | string {
  try {
    return JSON.parse(content) as JsonValue;
  } catch {
    return content.trim();
  }
}

function unwrapEnvelope(payload: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(payload.payload) && (payload.provider === 'calendly' || payload.objectType || payload.workspaceId)) {
    return payload.payload;
  }
  return payload;
}

function pickAllowed(payload: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (payload[key] !== undefined) {
      result[key] = payload[key];
    }
  }
  return result;
}

function copyString(source: Record<string, unknown>, target: Record<string, unknown>, key: string): void {
  const value = readString(source, key);
  if (value) {
    target[key] = value;
  }
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = payload[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
