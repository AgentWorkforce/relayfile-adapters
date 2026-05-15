import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CalendlyAdapter,
  calendlyEventTypePath,
  calendlyInviteePath,
  calendlyScheduledEventPath,
  computeCalendlyPath,
  resolveCalendlyReadRequest,
  resolveCalendlyWritebackRequest,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClientLike,
  type WriteFileInput,
} from '../index.js';

interface CapturingClient extends RelayFileClientLike {
  deleted: Array<{ path: string; workspaceId: string }>;
  writes: WriteFileInput[];
}

function createClient(): CapturingClient {
  const client: CapturingClient = {
    deleted: [],
    writes: [],
    async writeFile(input) {
      client.writes.push(input);
      return { created: true };
    },
    async deleteFile(input) {
      client.deleted.push(input);
    },
  };
  return client;
}

function createProvider(): ConnectionProvider {
  return {
    name: 'relayfile-test-provider',
    async proxy<T = unknown>(_request: ProxyRequest): Promise<ProxyResponse<T>> {
      return {
        status: 200,
        headers: {},
        data: null as never,
      };
    },
    async healthCheck() {
      return true;
    },
  };
}

function createAdapter(client = createClient()): CalendlyAdapter {
  return new CalendlyAdapter(client, createProvider(), {
    connectionId: 'conn_calendly_123',
  });
}

test('CalendlyAdapter exposes provider name and supported webhook events', () => {
  const adapter = createAdapter();

  assert.equal(adapter.name, 'calendly');
  assert.deepEqual(adapter.supportedEvents(), [
    'scheduled_event.created',
    'scheduled_event.updated',
    'scheduled_event.canceled',
    'scheduled_event.deleted',
    'invitee.created',
    'invitee.updated',
    'invitee.canceled',
    'invitee.deleted',
    'event_type.created',
    'event_type.updated',
    'event_type.canceled',
    'event_type.deleted',
  ]);
});

test('ingestWebhook writes scheduled_event payloads with event type relations', async () => {
  const client = createClient();
  const adapter = createAdapter(client);

  const result = await adapter.ingestWebhook('ws_123', {
    event: 'scheduled_event.created',
    created_at: '2026-04-10T10:00:00.000Z',
    payload: {
      uri: 'https://api.calendly.com/scheduled_events/event_123',
      name: 'Discovery call',
      status: 'active',
      start_time: '2026-04-11T10:00:00.000Z',
      end_time: '2026-04-11T10:30:00.000Z',
      event_type: 'https://api.calendly.com/event_types/type_123',
      event_memberships: [
        {
          uri: 'https://api.calendly.com/users/user_123',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
        },
      ],
      location: {
        type: 'zoom',
        join_url: 'https://zoom.example/meeting',
      },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.deepEqual(result.paths, ['/calendly/scheduled-events/event_123.json']);
  assert.equal(client.writes.length, 1);
  assert.equal(client.writes[0]?.path, '/calendly/scheduled-events/event_123.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['calendly.name'], 'Discovery call');
  assert.equal(client.writes[0]?.semantics?.properties?.['calendly.event_type_id'], 'type_123');
  assert.deepEqual(client.writes[0]?.semantics?.relations, ['/calendly/event-types/type_123.json']);
});

test('ingestWebhook writes invitee payloads with scheduled event relations and answers', async () => {
  const client = createClient();
  const adapter = createAdapter(client);

  const result = await adapter.ingestWebhook('ws_123', {
    event: 'invitee.created',
    payload: {
      uri: 'https://api.calendly.com/scheduled_events/event_123/invitees/invitee_123',
      email: 'grace@example.com',
      name: 'Grace Hopper',
      status: 'active',
      timezone: 'America/New_York',
      event: 'https://api.calendly.com/scheduled_events/event_123',
      questions_and_answers: [
        {
          question: 'What should we cover?',
          answer: 'Implementation details',
        },
      ],
      tracking: {
        utm_source: 'newsletter',
      },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(client.writes[0]?.path, '/calendly/invitees/invitee_123.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['calendly.email'], 'grace@example.com');
  assert.equal(client.writes[0]?.semantics?.properties?.['calendly.utm_source'], 'newsletter');
  assert.deepEqual(client.writes[0]?.semantics?.relations, ['/calendly/scheduled-events/event_123.json']);
  assert.deepEqual(client.writes[0]?.semantics?.comments, ['What should we cover?: Implementation details']);
});

test('ingestWebhook writes event_type payloads with description semantics', async () => {
  const client = createClient();
  const adapter = createAdapter(client);

  const result = await adapter.ingestWebhook('ws_123', {
    event: 'event_type.created',
    payload: {
      uri: 'https://api.calendly.com/event_types/type_123',
      name: 'Technical interview',
      duration: 45,
      active: true,
      scheduling_url: 'https://calendly.com/acme/technical-interview',
      description_plain: 'Technical screen with the platform team.',
      profile: {
        type: 'User',
        name: 'Platform Team',
        owner: 'https://api.calendly.com/users/user_123',
      },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(client.writes[0]?.path, '/calendly/event-types/type_123.json');
  assert.equal(client.writes[0]?.semantics?.properties?.['calendly.duration_minutes'], '45');
  assert.equal(client.writes[0]?.semantics?.properties?.['calendly.active'], 'true');
  assert.deepEqual(client.writes[0]?.semantics?.comments, ['Technical screen with the platform team.']);
});

test('ingestWebhook preserves canceled scheduled events as updates, not deletes', async () => {
  const client = createClient();
  const adapter = createAdapter(client);

  const result = await adapter.ingestWebhook('ws_123', {
    event: 'scheduled_event.canceled',
    payload: {
      uri: 'https://api.calendly.com/scheduled_events/event_123',
      name: 'Canceled call',
      status: 'canceled',
      cancellation: {
        reason: 'Customer rescheduled',
      },
    },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(result.filesDeleted, 0);
  assert.equal(client.deleted.length, 0);
  assert.equal(client.writes.length, 1);
  assert.equal(client.writes[0]?.path, '/calendly/scheduled-events/event_123.json');
  const content = JSON.parse(client.writes[0]?.content ?? '{}');
  assert.equal(content.deleted, false);
  assert.equal(content.payload.status, 'canceled');
});

test('ingestWebhook deletes scheduled events only for deleted actions', async () => {
  const client = createClient();
  const adapter = createAdapter(client);

  const result = await adapter.ingestWebhook('ws_123', {
    event: 'scheduled_event.deleted',
    payload: {
      uri: 'https://api.calendly.com/scheduled_events/event_123',
      name: 'Deleted call',
      status: 'canceled',
    },
  });

  assert.equal(result.filesDeleted, 1);
  assert.equal(client.writes.length, 0);
  assert.deepEqual(client.deleted, [
    {
      workspaceId: 'ws_123',
      path: '/calendly/scheduled-events/event_123.json',
    },
  ]);
});

test('computePath and path helpers produce deterministic Calendly VFS paths', () => {
  const adapter = createAdapter();

  assert.equal(calendlyScheduledEventPath('event 1/2'), '/calendly/scheduled-events/event%201%2F2.json');
  assert.equal(calendlyInviteePath('invitee:42'), '/calendly/invitees/invitee%3A42.json');
  assert.equal(calendlyEventTypePath('type#7'), '/calendly/event-types/type%237.json');
  assert.equal(computeCalendlyPath('scheduled_events', 'event_123'), '/calendly/scheduled-events/event_123.json');
  assert.equal(computeCalendlyPath('invitees', 'invitee_123'), '/calendly/invitees/invitee_123.json');
  assert.equal(computeCalendlyPath('event-types', 'type_123'), '/calendly/event-types/type_123.json');
  assert.equal(adapter.computePath('CalendlyScheduledEvent', 'event_123'), '/calendly/scheduled-events/event_123.json');
});

test('computeSemantics extracts invitee relations, payment fields, and comments', () => {
  const adapter = createAdapter();

  const semantics = adapter.computeSemantics('invitee', 'invitee_123', {
    uri: 'https://api.calendly.com/scheduled_events/event_123/invitees/invitee_123',
    email: 'alan@example.com',
    name: 'Alan Turing',
    event: 'https://api.calendly.com/scheduled_events/event_123',
    payment: {
      provider: 'stripe',
      amount: 5000,
      currency: 'USD',
      successful: true,
    },
    questions_and_answers: [
      {
        question: 'Goal',
        answer: 'Discuss rollout',
      },
    ],
  });

  assert.equal(semantics.properties?.['calendly.payment_provider'], 'stripe');
  assert.equal(semantics.properties?.['calendly.payment_amount'], '5000');
  assert.equal(semantics.properties?.['calendly.payment_successful'], 'true');
  assert.deepEqual(semantics.relations, ['/calendly/scheduled-events/event_123.json']);
  assert.deepEqual(semantics.comments, ['Goal: Discuss rollout']);
});

test('queries resolve read paths to Calendly REST endpoints', () => {
  assert.deepEqual(resolveCalendlyReadRequest('/calendly/scheduled-events'), {
    method: 'GET',
    endpoint: '/scheduled_events',
    query: {
      count: '100',
    },
  });
  assert.deepEqual(resolveCalendlyReadRequest('/calendly/scheduled-events/event_123/invitees'), {
    method: 'GET',
    endpoint: '/scheduled_events/event_123/invitees',
    query: {
      count: '100',
    },
  });
  assert.deepEqual(resolveCalendlyReadRequest('/calendly/scheduled-events/event_123/invitees/invitee_123.json'), {
    method: 'GET',
    endpoint: '/scheduled_events/event_123/invitees/invitee_123',
  });
  assert.deepEqual(resolveCalendlyReadRequest('/calendly/event-types/type_123.json'), {
    method: 'GET',
    endpoint: '/event_types/type_123',
  });
  assert.throws(
    () => resolveCalendlyReadRequest('/calendly/invitees/invitee_123.json'),
    /No Calendly read route matched/,
  );
});

test('writeback resolves supported create, update, and cancellation paths', () => {
  assert.deepEqual(
    resolveCalendlyWritebackRequest(
      '/calendly/scheduled-events/new.json',
      '{"event_type":"https://api.calendly.com/event_types/type_123","start_time":"2026-04-11T10:00:00Z","invitee":{"email":"ada@example.com","name":"Ada"}}',
    ),
    {
      action: 'create_event_invitee',
      method: 'POST',
      endpoint: '/invitees',
      body: {
        event_type: 'https://api.calendly.com/event_types/type_123',
        start_time: '2026-04-11T10:00:00Z',
        invitee: {
          email: 'ada@example.com',
          name: 'Ada',
        },
      },
    },
  );
  assert.deepEqual(resolveCalendlyWritebackRequest('/calendly/event-types/type_123.json', '{"name":"Demo","duration":30}'), {
    action: 'update_event_type',
    method: 'PATCH',
    endpoint: '/event_types/type_123',
    body: {
      name: 'Demo',
      duration: 30,
    },
  });
  assert.deepEqual(resolveCalendlyWritebackRequest('/calendly/scheduled-events/event_123/cancel.json', '{"reason":"No longer needed"}'), {
    action: 'cancel_scheduled_event',
    method: 'POST',
    endpoint: '/scheduled_events/event_123/cancellation',
    body: {
      reason: 'No longer needed',
    },
  });
  assert.throws(
    () => resolveCalendlyWritebackRequest('/calendly/invitees/invitee_123.json', '{"name":"Ada"}'),
    /does not support updating invitees/,
  );
  assert.throws(
    () => resolveCalendlyWritebackRequest('/calendly/invitees/invitee_123/cancel.json', '{"reason":"No"}'),
    /does not support invitee-level cancellation/,
  );
});
