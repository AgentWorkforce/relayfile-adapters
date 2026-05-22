import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuxiliaryEmitterClient, EmitReadResult, EmitWriteInput } from '@relayfile/adapter-core';

import { emitDockerHubAuxiliaryFiles } from '../emit-auxiliary-files.js';
import {
  dockerHubRepositoriesIndexPath,
  dockerHubRepositoryByIdAliasPath,
  dockerHubRepositoryByNamespaceIndexPath,
  dockerHubRepositoryPath,
  dockerHubRepositoryTagsIndexPath,
  dockerHubRepositoryWebhooksIndexPath,
  dockerHubTagByIdAliasPath,
  dockerHubTagPath,
  dockerHubTagsIndexPath,
  dockerHubWebhookByIdAliasPath,
  dockerHubWebhookByRepositoryIndexPath,
  dockerHubWebhookPath,
  dockerHubWebhooksIndexPath,
} from '../path-mapper.js';
import type { DockerHubRepository, DockerHubTag, DockerHubWebhook } from '../types.js';

test('Docker Hub auxiliary emitter writes canonical records, indexes, and alias mirrors', async () => {
  const files = new Map<string, string>();
  const client: AuxiliaryEmitterClient = {
    async writeFile(input: EmitWriteInput) {
      files.set(input.path, input.content);
    },
    async readFile(input): Promise<EmitReadResult | null> {
      const content = files.get(input.path);
      return content ? { content } : null;
    },
  };

  const repository: DockerHubRepository = {
    id: 'acme/api',
    namespace: 'acme',
    name: 'api',
    repository_type: 'image',
    status: 1,
    is_private: false,
    star_count: 12,
    pull_count: 5000,
    last_updated: '2026-05-21T18:00:00Z',
  };
  const tag: DockerHubTag = {
    id: 'acme/api/latest',
    namespace: 'acme',
    repository: 'api',
    name: 'latest',
    digest: 'sha256:abc',
    tag_status: 'active',
    architecture: 'amd64',
    os: 'linux',
    last_updated: '2026-05-21T18:05:00Z',
  };
  const webhook: DockerHubWebhook = {
    id: 'acme/api/123',
    webhook_id: '123',
    namespace: 'acme',
    repository: 'api',
    name: 'deploy',
    active: true,
    creator: 'mona',
    last_called: '2026-05-21T18:30:00Z',
    date_added: '2026-05-21T18:10:00Z',
  };

  const result = await emitDockerHubAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    records: [repository, tag, webhook],
    connectionId: 'conn-1',
  });

  assert.deepEqual(result.errors, []);
  assert.ok(result.written >= 12);

  const canonicalRepository = files.get(dockerHubRepositoryPath('acme', 'api'));
  assert.ok(canonicalRepository);
  assert.equal(files.get(dockerHubRepositoryByIdAliasPath('acme/api')), canonicalRepository);
  const canonicalTag = files.get(dockerHubTagPath('acme', 'api', 'latest'));
  assert.ok(canonicalTag);
  assert.equal(files.get(dockerHubTagByIdAliasPath('acme/api/latest')), canonicalTag);
  const canonicalWebhook = files.get(dockerHubWebhookPath('acme', 'api', '123'));
  assert.ok(canonicalWebhook);
  assert.equal(files.get(dockerHubWebhookByIdAliasPath('acme/api/123')), canonicalWebhook);

  assert.deepEqual(JSON.parse(files.get(dockerHubRepositoriesIndexPath()) ?? '[]').map((row: { id: string }) => row.id), ['acme/api']);
  assert.deepEqual(JSON.parse(files.get(dockerHubRepositoryByNamespaceIndexPath('acme')) ?? '[]').map((row: { id: string }) => row.id), ['acme/api']);
  assert.deepEqual(JSON.parse(files.get(dockerHubTagsIndexPath()) ?? '[]').map((row: { id: string }) => row.id), ['acme/api/latest']);
  assert.deepEqual(JSON.parse(files.get(dockerHubRepositoryTagsIndexPath('acme', 'api')) ?? '[]').map((row: { id: string }) => row.id), ['acme/api/latest']);
  assert.deepEqual(JSON.parse(files.get(dockerHubWebhooksIndexPath()) ?? '[]').map((row: { id: string }) => row.id), ['acme/api/123']);
  assert.deepEqual(JSON.parse(files.get(dockerHubRepositoryWebhooksIndexPath('acme', 'api')) ?? '[]').map((row: { id: string }) => row.id), ['acme/api/123']);
  assert.deepEqual(JSON.parse(files.get(dockerHubWebhookByRepositoryIndexPath('acme', 'api')) ?? '[]').map((row: { id: string }) => row.id), ['acme/api/123']);
});

test('Docker Hub auxiliary emitter classifies valid minimal tag and webhook records', async () => {
  const files = new Map<string, string>();
  const client: AuxiliaryEmitterClient = {
    async writeFile(input: EmitWriteInput) {
      files.set(input.path, input.content);
    },
    async readFile(input): Promise<EmitReadResult | null> {
      const content = files.get(input.path);
      return content ? { content } : null;
    },
  };

  await emitDockerHubAuxiliaryFiles(client, {
    workspaceId: 'ws-1',
    records: [
      {
        id: 'acme/api/minimal',
        namespace: 'acme',
        repository: 'api',
        name: 'minimal',
        last_updated: null,
      },
      {
        id: 'acme/api/hook-minimal',
        namespace: 'acme',
        repository: 'api',
      },
    ],
  });

  assert.ok(files.get(dockerHubTagPath('acme', 'api', 'minimal')));
  assert.ok(files.get(dockerHubWebhookPath('acme', 'api', 'hook-minimal')));
  assert.deepEqual(JSON.parse(files.get(dockerHubTagsIndexPath()) ?? '[]').map((row: { id: string }) => row.id), ['acme/api/minimal']);
  assert.deepEqual(JSON.parse(files.get(dockerHubWebhooksIndexPath()) ?? '[]').map((row: { id: string }) => row.id), ['acme/api/hook-minimal']);
});
