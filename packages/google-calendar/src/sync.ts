import { computeGoogleCalendarPath } from './path-mapper.js';
import {
  GOOGLE_CALENDAR_DEFAULT_BASE_URL,
  GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID,
  GOOGLE_CALENDAR_DEFAULT_PAGE_SIZE,
  GOOGLE_CALENDAR_PROVIDER_NAME,
  type ConnectionProvider,
  type GoogleCalendarAdapterConfig,
  type GoogleCalendarEvent,
  type GoogleCalendarEventsListResponse,
  type GoogleCalendarIncrementalSyncResult,
  type GoogleCalendarSyncCheckpoint,
  type GoogleCalendarSyncPage,
  type RelayFileClientLike,
  type WriteFileResult,
} from './types.js';

export async function listGoogleCalendarEventChanges(
  provider: ConnectionProvider,
  checkpoint: GoogleCalendarSyncCheckpoint = {},
  config: GoogleCalendarAdapterConfig = {},
): Promise<GoogleCalendarIncrementalSyncResult> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken = checkpoint.syncToken;

  do {
    const page = await fetchGoogleCalendarSyncPage(provider, checkpoint, config, pageToken);
    events.push(...page.events);
    pageToken = page.nextPageToken;
    if (page.nextSyncToken) {
      nextSyncToken = page.nextSyncToken;
    }
  } while (pageToken);

  return nextSyncToken ? { events, nextSyncToken } : { events };
}

export async function fetchGoogleCalendarSyncPage(
  provider: ConnectionProvider,
  checkpoint: GoogleCalendarSyncCheckpoint = {},
  config: GoogleCalendarAdapterConfig = {},
  pageToken?: string,
): Promise<GoogleCalendarSyncPage> {
  const calendarId = config.calendarId ?? GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID;
  const params = new URLSearchParams();
  params.set('singleEvents', 'true');
  params.set('showDeleted', 'true');
  params.set('maxResults', String(config.pageSize ?? GOOGLE_CALENDAR_DEFAULT_PAGE_SIZE));

  if (checkpoint.syncToken) {
    params.set('syncToken', checkpoint.syncToken);
  } else {
    const start = new Date();
    start.setDate(start.getDate() - (config.syncWindowDays ?? 30));
    params.set('timeMin', start.toISOString());
  }

  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  const baseUrl = config.apiBaseUrl ?? GOOGLE_CALENDAR_DEFAULT_BASE_URL;
  const endpoint = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const connectionId = config.connectionId ?? GOOGLE_CALENDAR_PROVIDER_NAME;
  const response = await provider.proxy<GoogleCalendarEventsListResponse>({
    method: 'GET',
    baseUrl,
    endpoint,
    connectionId,
    query: Object.fromEntries(params.entries()),
  });
  const data = response.data ?? {};

  return {
    events: Array.isArray(data.items) ? data.items : [],
    ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
    ...(data.nextSyncToken ? { nextSyncToken: data.nextSyncToken } : {}),
  };
}

export async function ingestGoogleCalendarEvents(
  client: RelayFileClientLike,
  workspaceId: string,
  events: GoogleCalendarEvent[],
  config: GoogleCalendarAdapterConfig = {},
): Promise<{
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: Array<{ path: string; error: string }>;
}> {
  const result = {
    filesWritten: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [] as string[],
    errors: [] as Array<{ path: string; error: string }>,
  };

  for (const event of events) {
    const path = computeGoogleCalendarPath('event', event.id, event.calendarId ?? config.calendarId);
    try {
      if (event.status === 'cancelled' || event.deleted) {
        if (client.deleteFile) {
          await client.deleteFile({ workspaceId, path });
          result.filesDeleted += 1;
          result.paths.push(path);
          continue;
        }
      }

      const writeResult = await client.writeFile({
        workspaceId,
        path,
        content: JSON.stringify({
          provider: GOOGLE_CALENDAR_PROVIDER_NAME,
          objectType: 'event',
          objectId: event.id,
          calendarId: event.calendarId ?? config.calendarId ?? GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID,
          payload: event,
        }, null, 2),
        contentType: 'application/json; charset=utf-8',
        semantics: buildEventSemantics(event, config.calendarId),
      });

      applyWriteCounts(result, writeResult);
      result.paths.push(path);
    } catch (error) {
      result.errors.push({
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

function buildEventSemantics(event: GoogleCalendarEvent, fallbackCalendarId?: string) {
  const calendarId = event.calendarId ?? fallbackCalendarId ?? GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID;
  const properties: Record<string, string> = {
    provider: GOOGLE_CALENDAR_PROVIDER_NAME,
    'provider.object_id': event.id,
    'provider.object_type': 'event',
    'google_calendar.id': event.id,
    'google_calendar.calendar_id': calendarId,
  };

  if (event.status) properties['google_calendar.status'] = event.status;
  if (event.summary) properties['google_calendar.summary'] = event.summary;
  if (event.updated) properties['google_calendar.updated'] = event.updated;
  if (event.organizer?.email) properties['google_calendar.organizer_email'] = event.organizer.email;
  if (event.start?.dateTime ?? event.start?.date) properties['google_calendar.start'] = event.start?.dateTime ?? event.start?.date ?? '';
  if (event.end?.dateTime ?? event.end?.date) properties['google_calendar.end'] = event.end?.dateTime ?? event.end?.date ?? '';

  const relations = [computeGoogleCalendarPath('calendar', calendarId, calendarId)];
  const comments = [event.description].filter((value): value is string => Boolean(value));

  return { properties, relations, comments };
}

function applyWriteCounts(
  result: { filesWritten: number; filesUpdated: number },
  writeResult: WriteFileResult | void,
): void {
  if (writeResult?.created || writeResult?.status === 'created') {
    result.filesWritten += 1;
    return;
  }
  result.filesUpdated += 1;
}
