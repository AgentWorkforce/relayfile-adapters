import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeDockerHubPath,
  dockerHubRepositoryByIdAliasPath,
  dockerHubRepositoryPath,
  dockerHubTagByIdAliasPath,
  dockerHubTagPath,
  dockerHubWebhookByIdAliasPath,
  dockerHubWebhookPath,
  parseDockerHubRepositoryByIdAliasPath,
  parseDockerHubTagByIdAliasPath,
  parseDockerHubWebhookByIdAliasPath,
} from '../path-mapper.js';

test('Docker Hub path mapper composes canonical paths from stable ids', () => {
  assert.equal(
    computeDockerHubPath('repository', 'acme/api'),
    '/docker-hub/repositories/acme/api.json',
  );
  assert.equal(
    computeDockerHubPath('tag', 'acme/api/latest'),
    '/docker-hub/repositories/acme/api/tags/latest.json',
  );
  assert.equal(
    computeDockerHubPath('webhook', 'acme/api/123'),
    '/docker-hub/repositories/acme/api/webhooks/123.json',
  );
});

test('Docker Hub computed paths ignore labels because object ids contain canonical path components', () => {
  assert.equal(
    computeDockerHubPath('repository', 'acme/api', 'wrong-name'),
    '/docker-hub/repositories/acme/api.json',
  );
  assert.equal(
    computeDockerHubPath('tag', 'acme/api/latest', 'wrong-tag'),
    '/docker-hub/repositories/acme/api/tags/latest.json',
  );
  assert.equal(
    computeDockerHubPath('webhook', 'acme/api/123', 'wrong-hook'),
    '/docker-hub/repositories/acme/api/webhooks/123.json',
  );
});

test('Docker Hub path mapper keeps path segments encoded', () => {
  assert.equal(
    dockerHubTagPath('team.name', 'api.server', '1.0.0'),
    '/docker-hub/repositories/team%2Ename/api%2Eserver/tags/1%2E0%2E0.json',
  );
});

test('Docker Hub repository by-id alias round-trips namespace and name', () => {
  const aliasPath = dockerHubRepositoryByIdAliasPath('team__name/api__server');
  assert.equal(aliasPath, '/docker-hub/repositories/by-id/team%5F%5Fname__api%5F%5Fserver.json');
  assert.deepEqual(parseDockerHubRepositoryByIdAliasPath(aliasPath), {
    namespace: 'team__name',
    name: 'api__server',
  });
  assert.equal(
    dockerHubRepositoryPath('team__name', 'api__server'),
    '/docker-hub/repositories/team__name/api__server.json',
  );
});

test('Docker Hub tag by-id alias round-trips repository and tag name', () => {
  const aliasPath = dockerHubTagByIdAliasPath('acme/api/release__candidate');
  assert.equal(aliasPath, '/docker-hub/tags/by-id/acme__api__release%5F%5Fcandidate.json');
  assert.deepEqual(parseDockerHubTagByIdAliasPath(aliasPath), {
    namespace: 'acme',
    repository: 'api',
    name: 'release__candidate',
  });
});

test('Docker Hub webhook by-id alias exposes the provider webhook id', () => {
  const aliasPath = dockerHubWebhookByIdAliasPath('acme/api/hook-123');
  assert.equal(aliasPath, '/docker-hub/webhooks/by-id/hook-123.json');
  assert.deepEqual(parseDockerHubWebhookByIdAliasPath(aliasPath), {
    namespace: '',
    repository: '',
    webhookId: 'hook-123',
  });
  assert.equal(
    dockerHubWebhookPath('acme', 'api', 'hook-123'),
    '/docker-hub/repositories/acme/api/webhooks/hook-123.json',
  );
});

test('Docker Hub path mapper rejects unsupported object types', () => {
  assert.throws(() => computeDockerHubPath('organization', 'acme'), /Unsupported Docker Hub object type/u);
});
