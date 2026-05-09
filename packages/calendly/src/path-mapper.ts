export const CALENDLY_PATH_ROOT = '/calendly';

export const CALENDLY_OBJECT_TYPES = [
  'scheduled_event',
  'invitee',
  'event_type',
] as const;

export type CalendlyPathObjectType = (typeof CALENDLY_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, CalendlyPathObjectType>> = {
  calendlyeventtype: 'event_type',
  calendlyinvitee: 'invitee',
  calendlyscheduledevent: 'scheduled_event',
  event: 'scheduled_event',
  events: 'scheduled_event',
  eventtype: 'event_type',
  eventtypes: 'event_type',
  event_type: 'event_type',
  event_types: 'event_type',
  invitee: 'invitee',
  invitees: 'invitee',
  scheduledevent: 'scheduled_event',
  scheduledevents: 'scheduled_event',
  scheduled_event: 'scheduled_event',
  scheduled_events: 'scheduled_event',
};

const NANGO_MODEL_MAP: Readonly<Record<string, CalendlyPathObjectType>> = {
  CalendlyEventType: 'event_type',
  CalendlyInvitee: 'invitee',
  CalendlyScheduledEvent: 'scheduled_event',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Calendly ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeCalendlyPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

export function normalizeCalendlyObjectType(objectType: string): CalendlyPathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[^a-z0-9_]+/gu, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Calendly object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeCalendlyObjectType(objectType: string): CalendlyPathObjectType | undefined {
  try {
    return normalizeCalendlyObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoCalendlyModel(model: string): CalendlyPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeCalendlyObjectType(model);
}

export function calendlyScheduledEventPath(eventId: string): string {
  return `${CALENDLY_PATH_ROOT}/scheduled-events/${encodeCalendlyPathSegment(eventId)}.json`;
}

export function calendlyInviteePath(inviteeId: string): string {
  return `${CALENDLY_PATH_ROOT}/invitees/${encodeCalendlyPathSegment(inviteeId)}.json`;
}

export function calendlyEventTypePath(eventTypeId: string): string {
  return `${CALENDLY_PATH_ROOT}/event-types/${encodeCalendlyPathSegment(eventTypeId)}.json`;
}

export function computeCalendlyPath(objectType: string, objectId: string): string {
  const normalizedType = normalizeCalendlyObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'scheduled_event':
      return calendlyScheduledEventPath(normalizedId);
    case 'invitee':
      return calendlyInviteePath(normalizedId);
    case 'event_type':
      return calendlyEventTypePath(normalizedId);
  }
}

export function extractCalendlyIdFromPathSegment(segment: string): string {
  return decodeURIComponent(assertNonEmptySegment(segment, 'path segment'));
}
