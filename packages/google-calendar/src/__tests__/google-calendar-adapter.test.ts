import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GoogleCalendarAdapter,
  computeGoogleCalendarPath,
  googleCalendarCalendarPath,
  googleCalendarEventPath,
  normalizeGoogleCalendarWebhook,
  registerGoogleCalendarWatch,
  renewGoogleCalendarWatch,
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

test('sync ingests incremental events into relayfile paths', async () => {
  const writes: WriteFileInput[] = [];
  const adapter = createAdapter({}, writes);

  const result = await adapter.sync('ws_1');

  assert.equal(result.filesWritten, 1);
  assert.equal(result.syncToken, 'sync_2');
  assert.deepEqual(result.paths, ['/google-calendar/calendars/primary/events/evt_1.json']);
  assert.equal(writes[0]?.semantics?.properties?.['google_calendar.organizer_email'], 'team@example.com');
});

test('writeback resolves create, update, and delete event routes', () => {
  assert.deepEqual(resolveGoogleCalendarWritebackRequest(
    '/google-calendar/calendars/primary/events/new.json',
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
    method: 'PUT',
    endpoint: '/calendar/v3/calendars/primary/events/evt_1',
    body: { summary: 'Updated summary' },
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

  const created = await registerGoogleCalendarWatch(provider, { webhookUrl: 'https://example.com/webhook' });
  assert.equal(created.googleCalendarResourceId, 'resource_1');
  assert.equal(requests[0]?.method, 'POST');

  const renewed = await renewGoogleCalendarWatch(provider, created, { webhookUrl: 'https://example.com/webhook' });
  assert.equal(renewed.googleCalendarResourceId, 'resource_1');

  await stopGoogleCalendarWatch(provider, renewed);
  assert.equal(requests.at(-1)?.baseUrl, 'https://www.googleapis.com');
  assert.equal(requests.at(-1)?.endpoint, '/calendar/v3/channels/stop');
});
