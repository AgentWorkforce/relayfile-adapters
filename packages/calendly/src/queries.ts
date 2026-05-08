import { extractCalendlyIdFromPathSegment } from './path-mapper.js';
import type { CalendlyRestRequest } from './types.js';

export const CALENDLY_SCHEDULED_EVENTS_ROUTE = '/scheduled_events';
export const CALENDLY_EVENT_TYPES_ROUTE = '/event_types';

export const CALENDLY_SCHEDULED_EVENT_FIELDS = [
  'uri',
  'name',
  'status',
  'start_time',
  'end_time',
  'event_type',
  'location',
  'created_at',
  'updated_at',
] as const;

export const CALENDLY_INVITEE_FIELDS = [
  'uri',
  'email',
  'name',
  'first_name',
  'last_name',
  'status',
  'timezone',
  'event',
  'created_at',
  'updated_at',
  'questions_and_answers',
  'tracking',
] as const;

export const CALENDLY_EVENT_TYPE_FIELDS = [
  'uri',
  'name',
  'slug',
  'active',
  'color',
  'duration',
  'kind',
  'type',
  'scheduling_url',
  'created_at',
  'updated_at',
] as const;

export function resolveCalendlyReadRequest(path: string): CalendlyRestRequest {
  const normalizedPath = normalizePath(path);

  if (normalizedPath === '/calendly/scheduled-events' || normalizedPath === '/calendly/scheduled-events/') {
    return {
      method: 'GET',
      endpoint: CALENDLY_SCHEDULED_EVENTS_ROUTE,
      query: {
        count: '100',
      },
    };
  }

  const scheduledEventInviteesMatch = normalizedPath.match(/^\/calendly\/scheduled-events\/([^/]+)\/invitees\/?$/u);
  if (scheduledEventInviteesMatch?.[1]) {
    const eventId = extractCalendlyIdFromPathSegment(scheduledEventInviteesMatch[1]);
    return {
      method: 'GET',
      endpoint: `${CALENDLY_SCHEDULED_EVENTS_ROUTE}/${encodeURIComponent(eventId)}/invitees`,
      query: {
        count: '100',
      },
    };
  }

  const scheduledEventInviteeMatch = normalizedPath.match(/^\/calendly\/scheduled-events\/([^/]+)\/invitees\/([^/]+)\.json$/u);
  if (scheduledEventInviteeMatch?.[1] && scheduledEventInviteeMatch[2]) {
    const eventId = extractCalendlyIdFromPathSegment(scheduledEventInviteeMatch[1]);
    const inviteeId = extractCalendlyIdFromPathSegment(scheduledEventInviteeMatch[2]);
    return {
      method: 'GET',
      endpoint: `${CALENDLY_SCHEDULED_EVENTS_ROUTE}/${encodeURIComponent(eventId)}/invitees/${encodeURIComponent(inviteeId)}`,
    };
  }

  const scheduledEventMatch = normalizedPath.match(/^\/calendly\/scheduled-events\/([^/]+)\.json$/u);
  if (scheduledEventMatch?.[1]) {
    const eventId = extractCalendlyIdFromPathSegment(scheduledEventMatch[1]);
    return {
      method: 'GET',
      endpoint: `${CALENDLY_SCHEDULED_EVENTS_ROUTE}/${encodeURIComponent(eventId)}`,
    };
  }

  if (normalizedPath === '/calendly/event-types' || normalizedPath === '/calendly/event-types/') {
    return {
      method: 'GET',
      endpoint: CALENDLY_EVENT_TYPES_ROUTE,
      query: {
        count: '100',
      },
    };
  }

  const eventTypeMatch = normalizedPath.match(/^\/calendly\/event-types\/([^/]+)\.json$/u);
  if (eventTypeMatch?.[1]) {
    const eventTypeId = extractCalendlyIdFromPathSegment(eventTypeMatch[1]);
    return {
      method: 'GET',
      endpoint: `${CALENDLY_EVENT_TYPES_ROUTE}/${encodeURIComponent(eventTypeId)}`,
    };
  }

  throw new Error(`No Calendly read route matched ${path}`);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
