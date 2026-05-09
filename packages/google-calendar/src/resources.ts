export interface GoogleCalendarWritebackResource {
  readonly name: string;
  readonly resourcePath: string;
  readonly schemaPath: string;
  readonly createExamplePath: string;
  readonly idPattern: string;
  readonly operations: readonly GoogleCalendarWritebackOperation[];
}

export interface GoogleCalendarWritebackOperation {
  readonly action: 'create' | 'update' | 'delete';
  readonly method: 'POST' | 'PATCH' | 'DELETE';
  readonly endpoint: string;
  readonly description: string;
}

export const GOOGLE_CALENDAR_EVENT_ID_PATTERN = '^[a-v0-9]{5,1024}$';

export const googleCalendarWritebackResources = [
  {
    name: 'events',
    resourcePath: '/google-calendar/calendars/{calendarId}/events/{eventId}.json',
    schemaPath: 'discovery/events.schema.json',
    createExamplePath: 'discovery/events.create.example.json',
    idPattern: GOOGLE_CALENDAR_EVENT_ID_PATTERN,
    operations: [
      {
        action: 'create',
        method: 'POST',
        endpoint: '/calendar/v3/calendars/{calendarId}/events',
        description: 'Create an event by writing a valid event document to a non-canonical filename in an events directory.',
      },
      {
        action: 'update',
        method: 'PATCH',
        endpoint: '/calendar/v3/calendars/{calendarId}/events/{eventId}',
        description: 'Patch mutable event fields by editing a canonical event JSON file.',
      },
      {
        action: 'delete',
        method: 'DELETE',
        endpoint: '/calendar/v3/calendars/{calendarId}/events/{eventId}',
        description: 'Delete an event by removing a canonical event JSON file.',
      },
    ],
  },
] as const satisfies readonly GoogleCalendarWritebackResource[];
