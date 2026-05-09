import { extractGoogleCalendarIdFromPathSegment } from './path-mapper.js';
import {
  GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID,
  type GoogleCalendarWritebackRequest,
  type JsonValue,
} from './types.js';

export function resolveGoogleCalendarWritebackRequest(path: string, content: string): GoogleCalendarWritebackRequest {
  const normalizedPath = normalizePath(path);

  const updateMatch = normalizedPath.match(/^\/google-calendar\/calendars\/([^/]+)\/events\/([^/]+)\.json$/u);
  if (updateMatch?.[1] && updateMatch[2]) {
    const calendarId = extractGoogleCalendarIdFromPathSegment(updateMatch[1]);
    const eventId = extractGoogleCalendarIdFromPathSegment(updateMatch[2]);
    const parsed = parsePayload(content);
    const eventPayload = isRecord(parsed.payload) ? parsed.payload : parsed;
    if (shouldCreateEvent(eventId, parsed, eventPayload)) {
      return buildCreateEvent(calendarId, eventPayload);
    }
    return buildUpdateEvent(calendarId, eventId, eventPayload);
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

function buildCreateEvent(calendarId: string, payload: Record<string, unknown>): GoogleCalendarWritebackRequest {
  const body = pickAllowed(payload, [
    'summary',
    'description',
    'location',
    'start',
    'end',
    'attendees',
    'status',
    'recurrence',
    'reminders',
    'conferenceData',
  ]);
  if (!body.start || !body.end) {
    throw new Error('event create writeback requires `start` and `end`');
  }
  return {
    action: 'create_event',
    method: 'POST',
    endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId || GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID)}/events`,
    body,
    ...(body.conferenceData ? { query: { conferenceDataVersion: '1' } } : {}),
  };
}

function buildUpdateEvent(calendarId: string, eventId: string, payload: Record<string, unknown>): GoogleCalendarWritebackRequest {
  const body = pickAllowed(payload, [
    'summary',
    'description',
    'location',
    'start',
    'end',
    'attendees',
    'status',
    'recurrence',
    'reminders',
    'conferenceData',
  ]);
  if (Object.keys(body).length === 0) {
    throw new Error('events/<id>.json writeback requires at least one mutable event field');
  }
  return {
    action: 'update_event',
    method: 'PATCH',
    endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    body,
    ...(body.conferenceData ? { query: { conferenceDataVersion: '1' } } : {}),
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
  return parsed;
}

function shouldCreateEvent(
  pathEventId: string,
  rawPayload: Record<string, unknown>,
  eventPayload: Record<string, unknown>,
): boolean {
  const payloadId = readString(eventPayload.id) ?? readString(rawPayload.objectId);
  if (payloadId && payloadId === pathEventId) return false;
  return Boolean(
    eventPayload.start &&
      eventPayload.end &&
      !rawPayload.provider &&
      !payloadId &&
      !looksCanonicalGoogleEventId(pathEventId),
  );
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
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function looksCanonicalGoogleEventId(value: string): boolean {
  return /^[a-v0-9]{5,1024}$/u.test(value);
}
