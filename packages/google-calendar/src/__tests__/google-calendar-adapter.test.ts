import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GoogleCalendarAdapter,
  computeGoogleCalendarPath,
  googleCalendarCalendarPath,
  googleCalendarEventPath,
  ingestGoogleCalendarEvents,
  listGoogleCalendarEventChanges,
  normalizeGoogleCalendarWebhook,
  registerGoogleCalendarWatch,
  renewGoogleCalendarWatch,
  resources as googleCalendarResources,
  resolveGoogleCalendarWritebackRequest,
  stopGoogleCalendarWatch,
  type ConnectionProvider,
  type GoogleCalendarAdapterConfig,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

function createAdapter(config: GoogleCalendarAdapterConfig = {}, writes: WriteFileInput[] = []): GoogleCalendarAdapter {
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push(input);
      return { created: true };
    },
    async deleteFile(input) {
      writes.push({ ...input, content: '', contentType: 'delete' });
      return undefined;
    },
  };

  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return {
        status: 200,
        headers: {},
        data: {
          items: [
            {
              id: 'evt_1',
              summary: 'Standup',
              status: 'confirmed',
              calendarId: 'primary',
              start: { dateTime: '2026-05-07T09:00:00Z' },
              end: { dateTime: '2026-05-07T09:15:00Z' },
              organizer: { email: 'team@example.com' },
              description: 'Daily sync',
              updated: '2026-05-07T08:55:00Z',
            },
          ],
          nextSyncToken: 'sync_2',
        } as T,
      };
    },
    async healthCheck() {
      return true;
    },
  };

  return new GoogleCalendarAdapter(client, provider, config);
}

test('GoogleCalendarAdapter exposes provider name and supported events', () => {
  const adapter = createAdapter();
  assert.equal(adapter.name, 'google-calendar');
  assert.deepEqual(adapter.supportedEvents(), ['calendar.exists', 'calendar.sync', 'calendar.not_exists']);
});

test('path mapper computes deterministic calendar and event paths', () => {
  assert.equal(googleCalendarCalendarPath('primary'), '/google-calendar/calendars/primary.json');
  assert.equal(googleCalendarEventPath('evt/1', 'team@example.com'), '/google-calendar/calendars/team%40example.com/events/evt%2F1.json');
  assert.equal(computeGoogleCalendarPath('event', 'evt_1', 'primary'), '/google-calendar/calendars/primary/events/evt_1.json');
});

test('webhook normalizer marks exists notifications as sync-worthy', () => {
  const normalized = normalizeGoogleCalendarWebhook({}, {
    'x-goog-resource-state': 'exists',
    'x-goog-resource-uri': 'https://www.googleapis.com/calendar/v3/calendars/primary/events?alt=json',
    'x-goog-channel-id': 'channel_1',
  }, {
    connectionId: 'conn_1',
    providerConfigKey: 'google-calendar',
  });

  assert.equal(normalized.provider, 'google-calendar');
  assert.equal(normalized.connectionId, 'conn_1');
  assert.equal(normalized.eventType, 'calendar.exists');
  assert.equal(normalized.objectId, 'primary');
  assert.equal(normalized.shouldSync, true);
});

test('webhook normalizer reads Nango forwarded Google Calendar headers', () => {
  const normalized = normalizeGoogleCalendarWebhook({
    from: 'google-calendar',
    providerConfigKey: 'google-calendar',
    type: 'forward',
    connectionId: 'conn_nango_1',
    payload: {
      'x-goog-resource-state': 'exists',
      'x-goog-resource-uri': 'https://www.googleapis.com/calendar/v3/calendars/user%40example.com/events?alt=json',
      'x-goog-channel-id': 'channel_1',
      'x-goog-message-number': '10',
    },
  }, {});

  assert.equal(normalized.connectionId, 'conn_nango_1');
  assert.equal(normalized.providerConfigKey, 'google-calendar');
  assert.equal(normalized.eventType, 'calendar.exists');
  assert.equal(normalized.objectId, 'user@example.com');
  assert.equal(normalized.shouldSync, true);
});

test('webhook normalizer prefers direct headers over forwarded payload headers', () => {
  const normalized = normalizeGoogleCalendarWebhook({
    payload: {
      'x-goog-resource-state': 'exists',
      'x-goog-resource-uri': 'https://www.googleapis.com/calendar/v3/calendars/forwarded/events?alt=json',
    },
  }, {
    'x-goog-resource-uri': 'https://www.googleapis.com/calendar/v3/calendars/direct/events?alt=json',
  });

  assert.equal(normalized.objectId, 'direct');
  assert.equal(normalized.headers['x-goog-resource-uri'], 'https://www.googleapis.com/calendar/v3/calendars/direct/events?alt=json');
});

test('webhook normalizer treats sync and not_exists states as reconciliation signals', () => {
  const syncEvent = normalizeGoogleCalendarWebhook({}, {
    'x-goog-resource-state': 'sync',
    'x-goog-resource-uri': 'https://www.googleapis.com/calendar/v3/calendars/primary/events?alt=json',
  });
  const deletedEvent = normalizeGoogleCalendarWebhook({}, {
    'x-goog-resource-state': 'not_exists',
    'x-goog-resource-uri': 'https://www.googleapis.com/calendar/v3/calendars/primary/events?alt=json',
  });

  assert.equal(syncEvent.shouldSync, true);
  assert.equal(syncEvent.objectType, 'calendar');
  assert.equal(deletedEvent.shouldSync, true);
});

test('sync ingests incremental events into relayfile paths', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({}, writes);

  const result = await adapter.sync('ws_1');

  assert.equal(result.filesWritten, 1);
  assert.equal(result.syncToken, 'sync_2');
  assert.deepEqual(result.paths, ['/google-calendar/calendars/primary/events/evt_1.json']);
  assert.equal(writes[0]?.semantics?.properties?.['google_calendar.organizer_email'], 'team@example.com');
});

test('event ingestion contains malformed paths and does not overcount void writes', async () => {
  const writes: WriteFileInput[] = [];
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push(input);
      return undefined;
    },
  };

  const result = await ingestGoogleCalendarEvents(client, 'ws_1', [
    {
      id: 'evt_1',
      summary: 'Valid',
      start: { dateTime: '2026-05-07T09:00:00Z' },
      end: { dateTime: '2026-05-07T09:15:00Z' },
    },
    {
      id: '',
      summary: 'Malformed',
    },
  ]);

  assert.equal(result.filesWritten, 0);
  assert.equal(result.filesUpdated, 0);
  assert.equal(writes.length, 1);
  assert.deepEqual(result.paths, ['/google-calendar/calendars/primary/events/evt_1.json']);
  assert.equal(result.errors.length, 1);
});

test('event ingestion preserves cancelled events as readable terminal records', async () => {
  const writes: WriteFileInput[] = [];
  const deletes: Array<{ path: string; workspaceId: string }> = [];
  const client: RelayFileClientLike = {
    async writeFile(input) {
      writes.push(input);
      return { updated: true };
    },
    async deleteFile(input) {
      deletes.push(input);
    },
  };

  const result = await ingestGoogleCalendarEvents(client, 'ws_1', [
    {
      id: 'evt_cancelled',
      calendarId: 'primary',
      status: 'cancelled',
      summary: 'Canceled sync',
      updated: '2026-05-12T09:00:00.000Z',
    },
  ]);

  assert.equal(result.filesUpdated, 1);
  assert.equal(result.filesDeleted, 0);
  assert.equal(deletes.length, 0);
  assert.equal(writes[0]?.path, '/google-calendar/calendars/primary/events/evt_cancelled.json');
  assert.equal(writes[0]?.semantics?.properties?.['google_calendar.status'], 'cancelled');
  const content = JSON.parse(writes[0]?.content ?? '{}') as {
    payload?: { status?: string };
  };
  assert.equal(content.payload?.status, 'cancelled');
});

test('sync resets expired Google Calendar sync tokens and retries full window', async () => {
  const requests: ProxyRequest[] = [];
  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
      requests.push(request);
      if (requests.length === 1) {
        throw Object.assign(new Error('Gone'), { status: 410 });
      }
      return {
        status: 200,
        headers: {},
        data: {
          items: [{ id: 'evt_2', summary: 'Recovered' }],
          nextSyncToken: 'sync_after_reset',
        } as T,
      };
    },
    async healthCheck() {
      return true;
    },
  };

  const result = await listGoogleCalendarEventChanges(provider, { syncToken: 'expired' });

  assert.equal(result.syncTokenReset, true);
  assert.equal(result.nextSyncToken, 'sync_after_reset');
  assert.equal(result.events[0]?.id, 'evt_2');
  assert.equal(requests[0]?.query?.syncToken, 'expired');
  assert.equal(requests[1]?.query?.syncToken, undefined);
  assert.ok(requests[1]?.query?.timeMin);
});

test('writeback resolves create, update, and delete event routes', () => {
  assert.deepEqual(resolveGoogleCalendarWritebackRequest(
    '/google-calendar/calendars/primary/events/draft-event.json',
    JSON.stringify({ summary: 'Launch review', start: { dateTime: '2026-05-08T10:00:00Z' }, end: { dateTime: '2026-05-08T10:30:00Z' } }),
  ), {
    action: 'create_event',
    method: 'POST',
    endpoint: '/calendar/v3/calendars/primary/events',
    body: {
      summary: 'Launch review',
      start: { dateTime: '2026-05-08T10:00:00Z' },
      end: { dateTime: '2026-05-08T10:30:00Z' },
    },
  });

  assert.deepEqual(resolveGoogleCalendarWritebackRequest(
    '/google-calendar/calendars/primary/events/evt_1.json',
    JSON.stringify({ summary: 'Updated summary' }),
  ), {
    action: 'update_event',
    method: 'PATCH',
    endpoint: '/calendar/v3/calendars/primary/events/evt_1',
    body: { summary: 'Updated summary' },
  });

  assert.deepEqual(resolveGoogleCalendarWritebackRequest(
    '/google-calendar/calendars/primary/events/evt_1.json',
    JSON.stringify({
      provider: 'google-calendar',
      objectType: 'event',
      objectId: 'evt_1',
      payload: {
        summary: 'Updated time',
        start: { dateTime: '2026-05-08T11:00:00Z' },
        end: { dateTime: '2026-05-08T11:30:00Z' },
      },
    }),
  ), {
    action: 'update_event',
    method: 'PATCH',
    endpoint: '/calendar/v3/calendars/primary/events/evt_1',
    body: {
      summary: 'Updated time',
      start: { dateTime: '2026-05-08T11:00:00Z' },
      end: { dateTime: '2026-05-08T11:30:00Z' },
    },
  });

  assert.deepEqual(resolveGoogleCalendarWritebackRequest(
    '/google-calendar/calendars/primary/events/evt_1/delete.json',
    '',
  ), {
    action: 'delete_event',
    method: 'DELETE',
    endpoint: '/calendar/v3/calendars/primary/events/evt_1',
  });
});

test('writeback rejects mismatched event ids before routing an update', () => {
  assert.throws(
    () => resolveGoogleCalendarWritebackRequest(
      '/google-calendar/calendars/primary/events/evt_1.json',
      JSON.stringify({ id: 'evt_2', summary: 'Wrong event' }),
    ),
    /payload id must match path event id/u,
  );
});

test('watch helpers register, renew, and stop channels via provider proxy', async () => {
  const requests: ProxyRequest[] = [];
  const provider: ConnectionProvider = {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>> {
      requests.push(request);
      return {
        status: 200,
        headers: {},
        data: { resourceId: 'resource_1', expiration: '123456' } as T,
      };
    },
    async healthCheck() {
      return true;
    },
  };

  const created = await registerGoogleCalendarWatch(provider, {
    webhookUrl: 'https://example.com/webhook',
    connectionId: 'conn_google_1',
  });
  assert.equal(created.googleCalendarConnectionId, 'conn_google_1');
  assert.equal(created.googleCalendarResourceId, 'resource_1');
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.connectionId, 'conn_google_1');

  const renewed = await renewGoogleCalendarWatch(provider, created, {
    webhookUrl: 'https://example.com/webhook',
    connectionId: 'conn_google_1',
  });
  assert.equal(renewed.googleCalendarResourceId, 'resource_1');

  await stopGoogleCalendarWatch(provider, renewed);
  assert.equal(requests.at(-1)?.baseUrl, 'https://www.googleapis.com');
  assert.equal(requests.at(-1)?.endpoint, '/calendar/v3/channels/stop');
  assert.equal(requests.at(-1)?.connectionId, 'conn_google_1');
});

test('resource discovery describes Google Calendar event writeback metadata', () => {
  const [events] = googleCalendarResources;
  assert.equal(events?.name, 'events');
  assert.equal(events?.path, '/google-calendar/calendars/{calendarId}/events');
  assert.equal(events?.schema, 'discovery/google-calendar/calendars/{calendarId}/events/.schema.json');
  assert.equal(events?.createExample, 'discovery/google-calendar/calendars/{calendarId}/events/.create.example.json');
  assert.equal(events?.idPattern.source, '^[a-v0-9]{5,1024}$');
  assert.equal(events?.pathPattern.test('/google-calendar/calendars/primary/events/abcde.json'), true);
});
