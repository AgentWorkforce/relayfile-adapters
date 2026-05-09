import {
  GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID,
  GOOGLE_CALENDAR_PATH_ROOT,
} from './types.js';

export const GOOGLE_CALENDAR_OBJECT_TYPES = ['calendar', 'event'] as const;
export type GoogleCalendarPathObjectType = (typeof GOOGLE_CALENDAR_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, GoogleCalendarPathObjectType>> = {
  calendar: 'calendar',
  calendars: 'calendar',
  event: 'event',
  events: 'event',
  googlecalendarevent: 'event',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Google Calendar ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeGoogleCalendarPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function normalizeGoogleCalendarObjectType(objectType: string): GoogleCalendarPathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Google Calendar object type: ${objectType}`);
  }
  return mapped;
}

export function googleCalendarCalendarPath(calendarId: string = GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID): string {
  return `${GOOGLE_CALENDAR_PATH_ROOT}/calendars/${encodeGoogleCalendarPathSegment(calendarId)}.json`;
}

export function googleCalendarEventPath(eventId: string, calendarId: string = GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID): string {
  return `${GOOGLE_CALENDAR_PATH_ROOT}/calendars/${encodeGoogleCalendarPathSegment(calendarId)}/events/${encodeGoogleCalendarPathSegment(eventId)}.json`;
}

export function computeGoogleCalendarPath(
  objectType: string,
  objectId: string,
  calendarId: string = GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID,
): string {
  const normalizedType = normalizeGoogleCalendarObjectType(objectType);
  switch (normalizedType) {
    case 'calendar':
      return googleCalendarCalendarPath(objectId || calendarId);
    case 'event':
      return googleCalendarEventPath(assertNonEmptySegment(objectId, 'object id'), calendarId);
  }
}

export function extractGoogleCalendarIdFromPathSegment(segment: string): string {
  return decodeURIComponent(segment);
}
