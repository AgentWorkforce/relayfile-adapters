import assert from 'node:assert/strict';
import test from 'node:test';

import { computeDockerHubPath } from '../path-mapper.js';
import { dockerHubWebhookObjectPath, normalizeDockerHubWebhook } from '../webhook-normalizer.js';

test('normalizeDockerHubWebhook maps Docker Hub push payloads to tag records', () => {
  const normalized = normalizeDockerHubWebhook(
    {
      callback_url: 'https://registry.hub.docker.com/u/svendowideit/testhook/hook/2141b5/',
      push_data: {
        pushed_at: 1417566161,
        pusher: 'trustedbuilder',
        tag: 'latest',
      },
      repository: {
        is_private: true,
        name: 'testhook',
        namespace: 'svendowideit',
        owner: 'svendowideit',
        repo_name: 'svendowideit/testhook',
        repo_url: 'https://registry.hub.docker.com/u/svendowideit/testhook/',
        status: 'Active',
      },
    },
    {
      'x-docker-hub-delivery': 'delivery-123',
      'x-connection-id': 'conn_123',
    },
  );

  assert.equal(normalized.provider, 'docker-hub');
  assert.equal(normalized.eventType, 'push');
  assert.equal(normalized.objectType, 'tag');
  assert.equal(normalized.objectId, 'svendowideit/testhook/latest');
  assert.equal(normalized.namespace, 'svendowideit');
  assert.equal(normalized.repository, 'testhook');
  assert.equal(normalized.tag, 'latest');
  assert.equal(normalized.deliveryId, 'delivery-123');
  assert.equal(normalized.connectionId, 'conn_123');
  assert.equal(
    computeDockerHubPath(normalized.objectType, normalized.objectId),
    '/docker-hub/repositories/svendowideit/testhook/tags/latest.json',
  );
  assert.equal(
    dockerHubWebhookObjectPath(normalized),
    '/docker-hub/repositories/svendowideit/testhook/tags/latest.json',
  );
});

test('normalizeDockerHubWebhook accepts string payloads and repository-only events', () => {
  const normalized = normalizeDockerHubWebhook(JSON.stringify({
    event_type: 'webhook.ping',
    repository: {
      repo_name: 'acme/api',
    },
    connection_id: 'conn_payload',
  }));

  assert.equal(normalized.eventType, 'webhook.ping');
  assert.equal(normalized.objectType, 'repository');
  assert.equal(normalized.objectId, 'acme/api');
  assert.equal(normalized.connectionId, 'conn_payload');
  assert.equal(
    computeDockerHubPath(normalized.objectType, normalized.objectId),
    '/docker-hub/repositories/acme/api.json',
  );
});

test('normalizeDockerHubWebhook rejects payloads without repository identity', () => {
  assert.throws(
    () => normalizeDockerHubWebhook({ push_data: { tag: 'latest' } }),
    /repository namespace\/name/u,
  );
});
