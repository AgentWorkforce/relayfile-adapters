import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import type { RelayFileClient } from '@relayfile/sdk';
import { createWebhookServer } from '../src/server.js';
import type { WebhookEvent, WebhookServerOptions } from '../src/types.js';

interface IngestCall {
  workspaceId: string;
  provider: string;
  event_type: string;
  path: string;
  data: Record<string, unknown>;
  delivery_id?: string;
  timestamp?: string;
  headers?: Record<string, string>;
}

function makeClient(behavior?: { fail?: boolean }): { client: RelayFileClient; calls: IngestCall[] } {
  const calls: IngestCall[] = [];
  const client = {
    async ingestWebhook(input: IngestCall) {
      if (behavior?.fail) {
        throw new Error('relayfile unavailable');
      }
      calls.push(input);
      return { status: 'queued' as const, id: `op-${calls.length}` };
    },
  } as unknown as RelayFileClient;

  return { client, calls };
}

function makeServer(options: Partial<WebhookServerOptions> = {}, behavior?: { fail?: boolean }) {
  const { client, calls } = makeClient(behavior);
  const server = createWebhookServer({
    client,
    workspaceId: 'ws-1',
    ...options,
  });
  return { server, calls };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /:provider/webhook', () => {
  it('returns 404 with the registered provider list for unknown providers', async () => {
    const { server } = makeServer();
    server.register('github', {});

    const response = await server.fetch(post('/asana/webhook', {}));
    assert.strictEqual(response.status, 404);
    const body = (await response.json()) as { error: string; registeredProviders: string[] };
    assert.match(body.error, /Unknown provider "asana"/);
    assert.deepStrictEqual(body.registeredProviders, ['github']);
  });

  it('returns 400 for non-object JSON bodies', async () => {
    const { server, calls } = makeServer();
    server.register('github', {});

    const response = await server.fetch(post('/github/webhook', '[1,2,3]'));
    assert.strictEqual(response.status, 400);
    assert.strictEqual(calls.length, 0);
  });

  it('normalizes GitHub pull request webhooks and persists them', async () => {
    const { server, calls } = makeServer();
    server.register('github', {});

    const response = await server.fetch(
      post(
        '/github/webhook',
        { action: 'opened', pull_request: { number: 123 } },
        { 'x-github-event': 'pull_request', 'x-github-delivery': 'delivery-1' },
      ),
    );

    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as {
      ok: boolean;
      received: number;
      paths: string[];
      operations: Array<{ id: string; status: string; eventType: string }>;
    };
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.received, 1);
    assert.deepStrictEqual(body.paths, ['/github/pull_request/123.json']);
    assert.strictEqual(body.operations[0]?.eventType, 'pull_request.opened');

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.workspaceId, 'ws-1');
    assert.strictEqual(calls[0]?.provider, 'github');
    assert.strictEqual(calls[0]?.event_type, 'pull_request.opened');
    assert.strictEqual(calls[0]?.delivery_id, 'delivery-1');
  });

  it('enforces GitHub signatures when a secret is configured', async () => {
    const secret = 'gh-secret';
    const { server, calls } = makeServer({ secrets: { github: secret } });
    server.register('github', {});

    const payload = JSON.stringify({ action: 'opened', pull_request: { number: 1 } });
    const unsigned = await server.fetch(post('/github/webhook', payload, { 'x-github-event': 'pull_request' }));
    assert.strictEqual(unsigned.status, 401);
    assert.strictEqual(calls.length, 0);

    const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    const signed = await server.fetch(
      post('/github/webhook', payload, {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signature,
      }),
    );
    assert.strictEqual(signed.status, 200);
    assert.strictEqual(calls.length, 1);
  });

  it('answers Slack url_verification challenges without persisting', async () => {
    const { server, calls } = makeServer();
    server.register('slack', {});

    const response = await server.fetch(
      post('/slack/webhook', { type: 'url_verification', challenge: 'challenge-token' }),
    );

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { challenge: 'challenge-token' });
    assert.strictEqual(calls.length, 0);
  });

  it('normalizes Slack event_callback thread messages', async () => {
    const { server, calls } = makeServer();
    server.register('slack', {});

    const response = await server.fetch(
      post('/slack/webhook', {
        type: 'event_callback',
        event_id: 'Ev123',
        event: { type: 'message', channel: 'C1', ts: '111.222', thread_ts: '111.222', text: 'hi' },
      }),
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.event_type, 'message.created');
    assert.strictEqual(calls[0]?.path, '/slack/thread/C1_111_222.json');
  });

  it('falls back to generic normalization with connection headers', async () => {
    const { server, calls } = makeServer();
    server.register('asana', {});

    const response = await server.fetch(
      post(
        '/asana/webhook',
        { eventType: 'task.updated', objectType: 'task', objectId: 'task-9' },
        { 'x-connection-id': 'conn-asana' },
      ),
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(calls[0]?.event_type, 'task.updated');
    assert.strictEqual(calls[0]?.path, '/asana/task/task-9.json');
    assert.strictEqual((calls[0]?.data as { objectId?: string }).objectId, 'task-9');
  });

  it('uses adapter normalizeWebhook and computePath when provided, fanning out multiple events', async () => {
    const { server, calls } = makeServer();
    server.register('custom', {
      normalizeWebhook(payload): WebhookEvent[] {
        return [1, 2].map((index) => ({
          provider: 'custom',
          eventType: 'item.created',
          objectType: 'item',
          objectId: `item-${index}`,
          payload,
        }));
      },
      computePath(objectType, objectId) {
        return `/custom-root/${objectType}/${objectId}/record.json`;
      },
    });

    const response = await server.fetch(post('/custom/webhook', { batch: true }));
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as { received: number; paths: string[] };
    assert.strictEqual(body.received, 2);
    assert.deepStrictEqual(body.paths, [
      '/custom-root/item/item-1/record.json',
      '/custom-root/item/item-2/record.json',
    ]);
    assert.strictEqual(calls.length, 2);
  });

  it('returns 400 when adapter normalization fails', async () => {
    const { server, calls } = makeServer();
    server.register('custom', {
      normalizeWebhook() {
        throw new Error('cannot make sense of payload');
      },
    });

    const response = await server.fetch(post('/custom/webhook', {}));
    assert.strictEqual(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /cannot make sense of payload/);
    assert.strictEqual(calls.length, 0);
  });

  it('returns 502 when persistence fails', async () => {
    const { server } = makeServer({}, { fail: true });
    server.register('github', {});

    const response = await server.fetch(
      post('/github/webhook', { action: 'opened', issue: { number: 5 } }, { 'x-github-event': 'issues' }),
    );

    assert.strictEqual(response.status, 502);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /relayfile unavailable/);
  });

  it('treats provider names case-insensitively in the URL', async () => {
    const { server, calls } = makeServer();
    server.register('GitHub', {});

    const response = await server.fetch(
      post('/GITHUB/webhook', { action: 'opened', issue: { number: 7 } }, { 'x-github-event': 'issues' }),
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(calls[0]?.path, '/github/issue/7.json');
  });
});
