import { extractGoogleCalendarIdFromPathSegment } from './path-mapper.js';
import {
  GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID,
  type GoogleCalendarWritebackRequest,
  type JsonValue,
} from './types.js';

export function resolveGoogleCalendarWritebackRequest(path: string, content: string): GoogleCalendarWritebackRequest {
  const normalizedPath = normalizePath(path);

  const createMatch = normalizedPath.match(/^\/google-calendar\/calendars\/([^/]+)\/events\/new\.json$/u);
  if (createMatch?.[1]) {
    return buildCreateEvent(extractGoogleCalendarIdFromPathSegment(createMatch[1]), content);
  }

  const updateMatch = normalizedPath.match(/^\/google-calendar\/calendars\/([^/]+)\/events\/([^/]+)\.json$/u);
  if (updateMatch?.[1] && updateMatch[2]) {
    return buildUpdateEvent(
      extractGoogleCalendarIdFromPathSegment(updateMatch[1]),
      extractGoogleCalendarIdFromPathSegment(updateMatch[2]),
      content,
    );
  }

  const deleteMatch = normalizedPath.match(/^\/google-calendar\/calendars\/([^/]+)\/events\/([^/]+)\/delete\.json$/u);
  if (deleteMatch?.[1] && deleteMatch[2]) {
    return buildDeleteEvent(
      extractGoogleCalendarIdFromPathSegment(deleteMatch[1]),
      extractGoogleCalendarIdFromPathSegment(deleteMatch[2]),
    );
  }

  throw new Error(`No Google Calendar writeback rule matched ${path}`);
}

function buildCreateEvent(calendarId: string, content: string): GoogleCalendarWritebackRequest {
  const payload = parsePayload(content);
  const body = pickAllowed(payload, [
    'summary',
    'description',
    'location',
    'start',
    'end',
    'attendees',
    'status',
    'conferenceData',
  ]);
  if (!body.start || !body.end) {
    throw new Error('events/new.json writeback requires `start` and `end`');
  }
  return {
    action: 'create_event',
    method: 'POST',
    endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId || GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID)}/events`,
    body,
  };
}

function buildUpdateEvent(calendarId: string, eventId: string, content: string): GoogleCalendarWritebackRequest {
  const payload = parsePayload(content);
  const body = pickAllowed(payload, [
    'summary',
    'description',
    'location',
    'start',
    'end',
    'attendees',
    'status',
    'conferenceData',
  ]);
  if (Object.keys(body).length === 0) {
    throw new Error('events/<id>.json writeback requires at least one mutable event field');
  }
  return {
    action: 'update_event',
    method: 'PUT',
    endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    body,
  };
}

function buildDeleteEvent(calendarId: string, eventId: string): GoogleCalendarWritebackRequest {
  return {
    action: 'delete_event',
    method: 'DELETE',
    endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  };
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parsePayload(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Expected JSON object payload');
  }
  const parsed = safeParseJson(trimmed);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return isRecord(parsed.payload) ? parsed.payload : parsed;
}

function safeParseJson(content: string): JsonValue | string {
  try {
    return JSON.parse(content) as JsonValue;
  } catch {
    return content.trim();
  }
}

function pickAllowed(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
